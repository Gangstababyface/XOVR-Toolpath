import { BrowserWindow, desktopCapturer, dialog, ipcMain, screen } from 'electron'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { mkdirSync } from 'fs'
import { writeFile, rm, readFile } from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'
import { IpcChannels } from '../shared/ipc-channels'
import type { Rect, Step } from '../shared/types'
import * as stateBus from './state-bus'
import { startMouseHook, stopMouseHook } from './mouse-hook'
import { transcribeAllSteps } from './transcription'
import { generateQuestions, rewriteStep, batchRewriteAll, documentReview, documentRewrite } from './claude'
import { loadClaudeMemory, saveClaudeMemory } from './claude-memory'
import * as settings from './settings'
import { saveProject, loadProject, exportMarkdown, exportHtml, exportPdf } from './export'
import { checkForRecoverableAutosave, discardAutosave, markClean } from './autosave'

let toolbarWindow: BrowserWindow | null = null
let pendingSessionDir: string | null = null

// ── Capture queue ──

let captureInProgress = false
const captureQueue: Array<{ x: number; y: number }> = []

function broadcastQueueSize(): void {
  stateBus.setCaptureQueueSize(captureQueue.length)
}

// ── Helpers ──

function createSessionDir(): string {
  const sessionDir = join(tmpdir(), 'xovr-toolpath', uuidv4())
  mkdirSync(sessionDir, { recursive: true })
  return sessionDir
}

async function writeMediaFile(
  sessionDir: string,
  filename: string,
  data: ArrayBuffer
): Promise<string> {
  const filePath = join(sessionDir, filename)
  await writeFile(filePath, Buffer.from(data))
  return filePath
}

/**
 * Find the Electron Display that corresponds to a desktopCapturer source.
 * Uses source.display_id → display.id matching.
 * Falls back to primary display if no match is found.
 */
function findDisplayForSource(
  source: Electron.DesktopCapturerSource
): Electron.Display {
  const displays = screen.getAllDisplays()

  if (source.display_id) {
    const match = displays.find(
      (d) => d.id.toString() === source.display_id
    )
    if (match) return match
  }

  // Fallback: primary display
  console.warn(
    '[capture] Could not match source display_id=%s to any display, using primary',
    source.display_id
  )
  return screen.getPrimaryDisplay()
}

// ── Window management ──

function createToolbarWindow(): void {
  if (toolbarWindow && !toolbarWindow.isDestroyed()) return

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize
  const toolbarW = 520
  const toolbarH = 56

  toolbarWindow = new BrowserWindow({
    width: toolbarW,
    height: toolbarH,
    x: Math.round((screenW - toolbarW) / 2),
    y: screenH - toolbarH - 20,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Stay above fullscreen windows on Windows
  toolbarWindow.setAlwaysOnTop(true, 'screen-saver')

  if (process.env.ELECTRON_RENDERER_URL) {
    toolbarWindow.loadURL(process.env.ELECTRON_RENDERER_URL + '#toolbar')
  } else {
    toolbarWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: 'toolbar'
    })
  }

  toolbarWindow.on('closed', () => {
    toolbarWindow = null
  })
}

function closeToolbarWindow(): void {
  if (toolbarWindow && !toolbarWindow.isDestroyed()) {
    toolbarWindow.close()
    toolbarWindow = null
  }
}

// ── Step capture flow ──

function handleStepMarker(cursor: { x: number; y: number }): void {
  const state = stateBus.getState()
  if (!state.isRecording || state.isPaused) return

  if (captureInProgress) {
    captureQueue.push(cursor)
    broadcastQueueSize()
    console.log('[capture] Queued step marker (backlog: %d)', captureQueue.length)
    return
  }

  processCaptureRequest(cursor)
}

async function processCaptureRequest(cursor: { x: number; y: number }): Promise<void> {
  captureInProgress = true

  try {
    const state = stateBus.getState()
    if (!state.isRecording || !state.sessionDir || !state.sessionStartTime) {
      console.warn('[capture] Not recording, skipping capture')
      return
    }

    // Step 1 — compute effective timestamp
    let effectiveTimestamp: number
    if (state.isPaused && state.pauseStartedAt !== null) {
      effectiveTimestamp = state.pauseStartedAt - state.sessionStartTime - state.totalPausedDuration
    } else {
      effectiveTimestamp = Date.now() - state.sessionStartTime - state.totalPausedDuration
    }
    console.log('[capture] Effective timestamp: %d ms', effectiveTimestamp)

    // Step 2 — capture screenshot from the recorded source at native resolution
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 7680, height: 4320 }
    })

    let source = sources.find((s) => s.id === state.selectedSourceId)
    if (!source && sources.length > 0) {
      console.warn('[capture] selectedSourceId %s not found, using first source', state.selectedSourceId)
      source = sources[0]
    }
    if (!source) {
      console.error('[capture] No screen sources available')
      return
    }

    // Resolve the display that the source belongs to
    const sourceDisplay = findDisplayForSource(source)
    const scaleFactor = sourceDisplay.scaleFactor
    console.log(
      '[capture] Source display: id=%d bounds=%dx%d at (%d,%d) scale=%s',
      sourceDisplay.id,
      sourceDisplay.bounds.width, sourceDisplay.bounds.height,
      sourceDisplay.bounds.x, sourceDisplay.bounds.y,
      scaleFactor
    )

    const screenshot = source.thumbnail
    const imgWidth = screenshot.getSize().width
    const imgHeight = screenshot.getSize().height

    // Step 3 — save JPEG at quality 80
    const stepIndex = state.steps.length
    const capturesDir = join(state.sessionDir, 'captures')
    mkdirSync(capturesDir, { recursive: true })
    const screenshotFilename = `step-${stepIndex}.jpg`
    const screenshotPath = join(capturesDir, screenshotFilename)
    const jpegBuffer = screenshot.toJPEG(80)
    await writeFile(screenshotPath, jpegBuffer)
    console.log('[capture] Screenshot saved: %s (%d bytes, %dx%d)', screenshotPath, jpegBuffer.length, imgWidth, imgHeight)

    // Step 4 — auto-seed selectionRect centered on click position
    // Map cursor from absolute screen coords to screenshot pixel coords
    let relCursorX = cursor.x - sourceDisplay.bounds.x
    let relCursorY = cursor.y - sourceDisplay.bounds.y

    const inBounds =
      relCursorX >= 0 &&
      relCursorX < sourceDisplay.bounds.width &&
      relCursorY >= 0 &&
      relCursorY < sourceDisplay.bounds.height

    if (!inBounds) {
      relCursorX = Math.round(sourceDisplay.bounds.width / 2)
      relCursorY = Math.round(sourceDisplay.bounds.height / 2)
    }

    // Convert display-relative coords to screenshot pixel coords
    const pixelX = Math.round(relCursorX * scaleFactor)
    const pixelY = Math.round(relCursorY * scaleFactor)

    // Default selection box: 200x150 in screenshot pixels, centered on click
    const boxW = Math.min(200, imgWidth)
    const boxH = Math.min(150, imgHeight)
    const selectionRect: Rect = {
      x: Math.max(0, Math.min(pixelX - Math.round(boxW / 2), imgWidth - boxW)),
      y: Math.max(0, Math.min(pixelY - Math.round(boxH / 2), imgHeight - boxH)),
      width: boxW,
      height: boxH,
      displayScale: scaleFactor
    }

    // Step 5 — create Step record
    const step: Step = {
      id: uuidv4(),
      index: stepIndex,
      timestamp: effectiveTimestamp,
      screenshot: screenshotPath,
      clickX: cursor.x,
      clickY: cursor.y,
      displayId: sourceDisplay.id,
      displayScale: scaleFactor,
      selectionRect,
      rawTranscript: '',
      editedText: '',
      claudeQuestions: [],
      rewriteStatus: 'raw',
      rewriteSource: 'none',
      title: `Step ${stepIndex + 1}`,
      titleManuallyEdited: false
    }

    stateBus.addStep(step)
    console.log('[capture] Step %d created at (%d,%d)', stepIndex, cursor.x, cursor.y)
  } catch (err) {
    console.error('[capture] Failed:', err)
  } finally {
    captureInProgress = false

    // Process next queued capture
    if (captureQueue.length > 0) {
      const next = captureQueue.shift()!
      broadcastQueueSize()
      console.log('[capture] Processing queued capture (backlog: %d)', captureQueue.length)
      processCaptureRequest(next)
    }
  }
}

// ── IPC registration ──

export function registerIpcHandlers(): void {
  // ── Recording lifecycle — Phase 2 ──

  ipcMain.handle(IpcChannels.RECORDING_START, async () => {
    const sessionDir = createSessionDir()
    pendingSessionDir = sessionDir
    console.log('[ipc] recording:start — sessionDir=%s', sessionDir)
  })

  ipcMain.handle(IpcChannels.RECORDING_CONFIRM_STARTED, async () => {
    console.log('[ipc] recording:confirm-started — pendingSessionDir=%s', pendingSessionDir)
    if (!pendingSessionDir) return
    stateBus.startRecording(pendingSessionDir)
    pendingSessionDir = null
    createToolbarWindow()
    startMouseHook(handleStepMarker)
  })

  ipcMain.handle(IpcChannels.RECORDING_PAUSE, async () => {
    stateBus.pauseRecording()
  })

  ipcMain.handle(IpcChannels.RECORDING_RESUME, async () => {
    stateBus.resumeRecording()
  })

  ipcMain.handle(IpcChannels.RECORDING_STOP, async () => {
    console.log('[ipc] recording:stop — pendingSessionDir=%s isRecording=%s', pendingSessionDir, stateBus.getState().isRecording)
    stopMouseHook()
    captureQueue.length = 0
    broadcastQueueSize()
    if (pendingSessionDir) {
      rm(pendingSessionDir, { recursive: true, force: true }).catch(() => {})
      pendingSessionDir = null
    }
    stateBus.stopRecording()
    closeToolbarWindow()
  })

  // ── Media persistence — Phase 2 ──

  ipcMain.handle(
    IpcChannels.RECORDING_SAVE_MEDIA,
    async (_event, data: { video: ArrayBuffer; audio: ArrayBuffer }) => {
      const state = stateBus.getState()
      if (!state.sessionDir) return
      const videoPath = await writeMediaFile(state.sessionDir, 'recording.webm', data.video)
      const audioPath = await writeMediaFile(state.sessionDir, 'audio.webm', data.audio)
      stateBus.setMediaPaths(videoPath, audioPath)
    }
  )

  // ── Capture / Overlay — Phase 3 ──

  ipcMain.handle(IpcChannels.CAPTURE_MARK_STEP, async () => {
    const cursor = screen.getCursorScreenPoint()
    handleStepMarker(cursor)
  })

  // ── Transcription — Phase 4 ──

  ipcMain.handle(IpcChannels.TRANSCRIBE_START, async () => {
    console.log('[ipc] transcribe:start')
    await transcribeAllSteps()
  })

  // ── Screenshots ──

  ipcMain.handle(IpcChannels.SCREENSHOT_LOAD, async (_event, filePath: string) => {
    try {
      const buffer = await readFile(filePath)
      const ext = filePath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg'
      return `data:image/${ext};base64,${buffer.toString('base64')}`
    } catch (err) {
      console.error('[ipc] screenshot:load failed for %s:', filePath, err)
      return null
    }
  })

  // ── Step editing ──

  ipcMain.handle(
    IpcChannels.STEP_UPDATE_TEXT,
    async (_event, data: { stepId: string; editedText: string }) => {
      stateBus.updateStepText(data.stepId, data.editedText)
    }
  )

  ipcMain.handle(
    IpcChannels.STEP_UPDATE_SELECTION,
    async (_event, data: { stepId: string; selectionRect: Rect }) => {
      stateBus.updateStepSelection(data.stepId, data.selectionRect)
    }
  )

  // ── Claude AI — Phase 6 ──

  ipcMain.handle(IpcChannels.CLAUDE_QUESTIONS, async (_event, data: { stepId: string }) => {
    const state = stateBus.getState()
    const step = state.steps.find((s) => s.id === data.stepId)
    if (!step) throw new Error(`Step not found: ${data.stepId}`)

    const questions = await generateQuestions(step, state.steps)
    // Store questions as QAPairs with empty answers
    const qaPairs = questions.map((q) => ({ question: q, answer: '' }))
    stateBus.updateStepQuestions(data.stepId, qaPairs)
    return questions
  })

  ipcMain.handle(
    IpcChannels.CLAUDE_REWRITE,
    async (_event, data: { stepId: string; answers?: Record<string, string> }) => {
      const state = stateBus.getState()
      const step = state.steps.find((s) => s.id === data.stepId)
      if (!step) throw new Error(`Step not found: ${data.stepId}`)

      // Build QAPairs from answers
      const qaPairs = step.claudeQuestions.map((qa) => ({
        question: qa.question,
        answer: data.answers?.[qa.question] || qa.answer
      }))

      // Update stored Q&A with answers
      stateBus.updateStepQuestions(data.stepId, qaPairs)

      const rewrittenText = await rewriteStep(step, state.steps, qaPairs)
      stateBus.updateStepRewrite(data.stepId, rewrittenText, 'interactive')
      return rewrittenText
    }
  )

  ipcMain.handle(IpcChannels.CLAUDE_BATCH_REWRITE, async () => {
    console.log('[ipc] claude:batch-rewrite')
    await batchRewriteAll()
  })

  // ── Export — Phase 7 ──

  ipcMain.handle(IpcChannels.EXPORT_RUN, async (_event, data: { format: 'markdown' | 'html' | 'pdf'; outputPath?: string }) => {
    let outputPath = data.outputPath
    if (!outputPath) {
      const filters: Record<string, Electron.FileFilter[]> = {
        markdown: [{ name: 'Markdown', extensions: ['md'] }],
        html: [{ name: 'HTML', extensions: ['html'] }],
        pdf: [{ name: 'PDF', extensions: ['pdf'] }]
      }
      const result = await dialog.showSaveDialog({
        title: `Export as ${data.format.toUpperCase()}`,
        defaultPath: `xovr-toolpath.${data.format === 'markdown' ? 'md' : data.format}`,
        filters: filters[data.format]
      })
      if (result.canceled || !result.filePath) return
      outputPath = result.filePath
    }

    if (data.format === 'markdown') await exportMarkdown(outputPath)
    else if (data.format === 'html') await exportHtml(outputPath)
    else if (data.format === 'pdf') await exportPdf(outputPath)
  })

  // ── File operations — Phase 7 ──

  ipcMain.handle(IpcChannels.FILE_SAVE_PROJECT, async (_event, data?: { filePath?: string }) => {
    let filePath = data?.filePath
    if (!filePath) {
      const result = await dialog.showSaveDialog({
        title: 'Save Project',
        defaultPath: 'project.xtoolpath',
        filters: [{ name: 'XOVR Toolpath Project', extensions: ['xtoolpath'] }]
      })
      if (result.canceled || !result.filePath) return null
      filePath = result.filePath
    }
    await saveProject(filePath)
    settings.saveSettings({ lastProjectPath: filePath })
    markClean()
    return filePath
  })
  ipcMain.handle(IpcChannels.FILE_LOAD_PROJECT, async (_event, data?: { filePath?: string }) => {
    let filePath = data?.filePath
    if (!filePath) {
      const result = await dialog.showOpenDialog({
        title: 'Open Project',
        filters: [{ name: 'XOVR Toolpath Project', extensions: ['xtoolpath'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      filePath = result.filePaths[0]
    }
    const project = await loadProject(filePath)
    stateBus.loadProjectState(project.steps, null)
    settings.saveSettings({ lastProjectPath: filePath })
    return filePath
  })

  // ── State synchronization — Phase 2 ──

  ipcMain.handle(IpcChannels.STATE_SUBSCRIBE, async () => {
    return stateBus.getState()
  })

  // ── Settings — Phase 7 ──

  ipcMain.handle(IpcChannels.SETTINGS_GET, async () => {
    return settings.getSettings()
  })
  ipcMain.handle(IpcChannels.SETTINGS_SAVE, async (_event, data) => {
    settings.saveSettings(data)
  })

  // ── Autosave / recovery — Phase 7 ──

  ipcMain.handle(IpcChannels.AUTOSAVE_CHECK, async () => {
    return checkForRecoverableAutosave()
  })
  ipcMain.handle(IpcChannels.AUTOSAVE_RESTORE, async () => {
    const snapshot = checkForRecoverableAutosave()
    if (snapshot) {
      stateBus.loadProjectState(snapshot.session.steps, snapshot.session.sessionDir)
      discardAutosave()
      markClean()
      return true
    }
    return false
  })
  ipcMain.handle(IpcChannels.AUTOSAVE_DISCARD, async () => {
    discardAutosave()
  })

  // ── Step title editing — Phase 8 ──

  ipcMain.handle(
    IpcChannels.STEP_UPDATE_TITLE,
    async (_event, data: { stepId: string; title: string }) => {
      stateBus.updateStepTitle(data.stepId, data.title, true)
    }
  )

  // ── Image operations — Phase 8 ──

  // ── Claude full-document review — Phase 8 ──

  ipcMain.handle(IpcChannels.CLAUDE_DOCUMENT_REVIEW, async () => {
    const state = stateBus.getState()
    return documentReview(state.steps)
  })

  ipcMain.handle(
    IpcChannels.CLAUDE_DOCUMENT_REWRITE,
    async (_event, data: { questions: Array<{ id: string; question: string }>; answers: Record<string, string> }) => {
      const state = stateBus.getState()
      return documentRewrite(state.steps, data.questions, data.answers)
    }
  )

  ipcMain.handle(IpcChannels.CLAUDE_MEMORY_LOAD, async () => {
    const state = stateBus.getState()
    const dir = state.sessionDir || settings.getSettings().lastProjectPath
    if (!dir) return null
    const memDir = state.sessionDir ? state.sessionDir : dirname(dir)
    return loadClaudeMemory(memDir)
  })

  ipcMain.handle(
    IpcChannels.CLAUDE_MEMORY_SAVE,
    async (_event, data: { memory: import('../shared/types').ClaudeMemory }) => {
      const state = stateBus.getState()
      const dir = state.sessionDir || settings.getSettings().lastProjectPath
      if (!dir) return
      const memDir = state.sessionDir ? state.sessionDir : dirname(dir)
      saveClaudeMemory(memDir, data.memory)
    }
  )
}
