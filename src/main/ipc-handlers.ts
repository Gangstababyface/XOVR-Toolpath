import { BrowserWindow, desktopCapturer, dialog, ipcMain, screen } from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync } from 'fs'
import { writeFile, rm, readFile } from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'
import { IpcChannels } from '../shared/ipc-channels'
import type { Rect, Step } from '../shared/types'
import * as stateBus from './state-bus'
import { registerHotkeys, unregisterHotkeys } from './hotkeys'
import { transcribeAllSteps } from './transcription'
import { generateQuestions, rewriteStep, batchRewriteAll } from './claude'
import * as settings from './settings'
import { saveProject, loadProject, exportMarkdown, exportHtml, exportPdf } from './export'
import { checkForRecoverableAutosave, discardAutosave, markClean } from './autosave'

let toolbarWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let pendingSessionDir: string | null = null

// ── Overlay communication state ──

interface OverlayInitData {
  screenshotDataUrl: string
  cursorX: number
  cursorY: number
  imgWidth: number
  imgHeight: number
  displayScale: number
}

let overlayData: OverlayInitData | null = null
let overlayResultResolver: ((rect: Rect | null) => void) | null = null

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

  toolbarWindow = new BrowserWindow({
    width: 420,
    height: 90,
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

function createOverlayWindow(displayBounds: Electron.Rectangle): BrowserWindow {
  const win = new BrowserWindow({
    x: displayBounds.x,
    y: displayBounds.y,
    width: displayBounds.width,
    height: displayBounds.height,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.webContents.on('console-message', (_event, level, message) => {
    const tag = ['verbose', 'info', 'warn', 'error'][level] || 'log'
    console.log(`[overlay:${tag}] ${message}`)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL + '#overlay')
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
  }

  win.webContents.on('did-finish-load', () => {
    win.focus()
  })

  return win
}

function closeOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close()
    overlayWindow = null
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
    // Use 8K max to never downscale any consumer display
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

    // Step 3 — resolve the display that the source belongs to
    // This is the single identity used for overlay bounds, scale, and coordinates
    const sourceDisplay = findDisplayForSource(source)
    const scaleFactor = sourceDisplay.scaleFactor
    console.log(
      '[capture] Source display: id=%d bounds=%dx%d at (%d,%d) scale=%s sourceId=%s display_id=%s',
      sourceDisplay.id,
      sourceDisplay.bounds.width, sourceDisplay.bounds.height,
      sourceDisplay.bounds.x, sourceDisplay.bounds.y,
      scaleFactor, source.id, source.display_id
    )

    const screenshot = source.thumbnail
    const imgWidth = screenshot.getSize().width
    const imgHeight = screenshot.getSize().height
    console.log('[capture] Screenshot: %dx%d from source %s', imgWidth, imgHeight, source.id)

    // Step 4 — save JPEG at quality 80
    const stepIndex = state.steps.length
    const capturesDir = join(state.sessionDir, 'captures')
    mkdirSync(capturesDir, { recursive: true })
    const screenshotFilename = `step-${stepIndex}.jpg`
    const screenshotPath = join(capturesDir, screenshotFilename)
    const jpegBuffer = screenshot.toJPEG(80)
    await writeFile(screenshotPath, jpegBuffer)
    console.log('[capture] Screenshot saved: %s (%d bytes, %dx%d)', screenshotPath, jpegBuffer.length, imgWidth, imgHeight)

    // Step 5 — prepare overlay data
    const screenshotDataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`

    // Map cursor from absolute screen coords to source-display-relative coords.
    // If cursor is on a different display, clamp to center of the source display.
    let relCursorX = cursor.x - sourceDisplay.bounds.x
    let relCursorY = cursor.y - sourceDisplay.bounds.y

    const inBounds =
      relCursorX >= 0 &&
      relCursorX < sourceDisplay.bounds.width &&
      relCursorY >= 0 &&
      relCursorY < sourceDisplay.bounds.height

    if (!inBounds) {
      console.log('[capture] Cursor is on a different display — centering default box on source display')
      relCursorX = Math.round(sourceDisplay.bounds.width / 2)
      relCursorY = Math.round(sourceDisplay.bounds.height / 2)
    }

    overlayData = {
      screenshotDataUrl,
      cursorX: relCursorX,
      cursorY: relCursorY,
      imgWidth,
      imgHeight,
      displayScale: scaleFactor
    }

    // Open overlay on the SOURCE display, not the cursor display
    const rect = await openOverlayAndWaitForResult(sourceDisplay.bounds)

    // Step 6 — create Step record
    const step: Step = {
      id: uuidv4(),
      index: stepIndex,
      timestamp: effectiveTimestamp,
      screenshot: screenshotPath,
      selectionRect: rect,
      rawTranscript: '',
      editedText: '',
      claudeQuestions: [],
      rewriteStatus: 'raw',
      rewriteSource: 'none'
    }

    stateBus.addStep(step)
    console.log('[capture] Step %d created (rect: %s)', stepIndex, rect ? 'confirmed' : 'skipped')
  } catch (err) {
    console.error('[capture] Failed:', err)
  } finally {
    captureInProgress = false
    overlayData = null

    // Process next queued capture
    if (captureQueue.length > 0) {
      const next = captureQueue.shift()!
      broadcastQueueSize()
      console.log('[capture] Processing queued capture (backlog: %d)', captureQueue.length)
      processCaptureRequest(next)
    }
  }
}

async function openOverlayAndWaitForResult(
  displayBounds: Electron.Rectangle
): Promise<Rect | null> {
  return new Promise<Rect | null>((resolve) => {
    overlayResultResolver = (rect) => {
      overlayResultResolver = null
      closeOverlayWindow()
      resolve(rect)
    }

    overlayWindow = createOverlayWindow(displayBounds)

    overlayWindow.on('closed', () => {
      overlayWindow = null
      if (overlayResultResolver) {
        overlayResultResolver(null)
      }
    })
  })
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
    registerHotkeys(handleStepMarker)
  })

  ipcMain.handle(IpcChannels.RECORDING_PAUSE, async () => {
    stateBus.pauseRecording()
  })

  ipcMain.handle(IpcChannels.RECORDING_RESUME, async () => {
    stateBus.resumeRecording()
  })

  ipcMain.handle(IpcChannels.RECORDING_STOP, async () => {
    console.log('[ipc] recording:stop — pendingSessionDir=%s isRecording=%s', pendingSessionDir, stateBus.getState().isRecording)
    unregisterHotkeys()
    captureQueue.length = 0
    broadcastQueueSize()
    if (overlayResultResolver) {
      overlayResultResolver(null)
    }
    closeOverlayWindow()
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

  ipcMain.handle(IpcChannels.CAPTURE_MARK_STEP, async (_event, _data) => {
    const cursor = screen.getCursorScreenPoint()
    handleStepMarker(cursor)
  })

  ipcMain.handle(IpcChannels.OVERLAY_OPEN, async (_event, _data) => {
    // Stub — overlay is opened by the capture flow
  })

  ipcMain.handle(IpcChannels.OVERLAY_GET_DATA, async () => {
    return overlayData
  })

  ipcMain.handle(IpcChannels.OVERLAY_RESULT, async (_event, data: { rect: Rect | null }) => {
    console.log('[ipc] overlay:result — rect=%s', data.rect ? JSON.stringify(data.rect) : 'null')
    if (overlayResultResolver) {
      overlayResultResolver(data.rect)
    }
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
}
