import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'
import type { Rect, RecordingSessionState } from '../shared/types'

const api = {
  // Recording lifecycle
  recordingStart: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.RECORDING_START),
  recordingPause: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.RECORDING_PAUSE),
  recordingResume: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.RECORDING_RESUME),
  recordingStop: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.RECORDING_STOP),
  recordingConfirmStarted: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.RECORDING_CONFIRM_STARTED),

  // Media persistence
  recordingSaveMedia: (data: { video: ArrayBuffer; audio: ArrayBuffer }): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.RECORDING_SAVE_MEDIA, data),

  // Capture
  captureMarkStep: (data?: { screenshotDataUrl?: string }): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CAPTURE_MARK_STEP, data),
  overlayOpen: (data: {
    screenshotPath: string
    cursorX: number
    cursorY: number
  }): Promise<void> => ipcRenderer.invoke(IpcChannels.OVERLAY_OPEN, data),
  overlayGetData: (): Promise<{
    screenshotDataUrl: string
    cursorX: number
    cursorY: number
    imgWidth: number
    imgHeight: number
    displayScale: number
  } | null> => ipcRenderer.invoke(IpcChannels.OVERLAY_GET_DATA),
  overlayResult: (data: { rect: Rect | null }): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.OVERLAY_RESULT, data),

  // Hotkey status
  onHotkeyStatus: (
    callback: (data: { registered: boolean }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { registered: boolean }
    ): void => {
      callback(data)
    }
    ipcRenderer.on('hotkey:status', handler)
    return () => {
      ipcRenderer.removeListener('hotkey:status', handler)
    }
  },

  // Screenshots
  screenshotLoad: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke(IpcChannels.SCREENSHOT_LOAD, filePath),

  // Step editing
  stepUpdateText: (data: { stepId: string; editedText: string }): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.STEP_UPDATE_TEXT, data),

  // Transcription
  transcribeStart: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.TRANSCRIBE_START),
  onTranscribeProgress: (
    callback: (progress: {
      stepIndex: number
      total: number
      status: 'extracting' | 'transcribing' | 'done' | 'error'
      message?: string
    }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: {
        stepIndex: number
        total: number
        status: 'extracting' | 'transcribing' | 'done' | 'error'
        message?: string
      }
    ): void => {
      callback(progress)
    }
    ipcRenderer.on(IpcChannels.TRANSCRIBE_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannels.TRANSCRIBE_PROGRESS, handler)
    }
  },

  // Claude AI
  claudeQuestions: (data: { stepId: string }): Promise<string[]> =>
    ipcRenderer.invoke(IpcChannels.CLAUDE_QUESTIONS, data),
  claudeRewrite: (data: {
    stepId: string
    answers?: Record<string, string>
  }): Promise<string> => ipcRenderer.invoke(IpcChannels.CLAUDE_REWRITE, data),
  claudeBatchRewrite: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CLAUDE_BATCH_REWRITE),
  onClaudeProgress: (
    callback: (progress: {
      type: 'batch'
      stepIndex: number
      total: number
      status: 'rewriting' | 'done' | 'error'
      message?: string
    }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: {
        type: 'batch'
        stepIndex: number
        total: number
        status: 'rewriting' | 'done' | 'error'
        message?: string
      }
    ): void => {
      callback(progress)
    }
    ipcRenderer.on(IpcChannels.CLAUDE_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannels.CLAUDE_PROGRESS, handler)
    }
  },

  // Export
  exportRun: (data: {
    format: 'markdown' | 'html' | 'pdf'
    outputPath: string
  }): Promise<void> => ipcRenderer.invoke(IpcChannels.EXPORT_RUN, data),

  // File operations
  fileSaveProject: (data: { filePath: string }): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.FILE_SAVE_PROJECT, data),
  fileLoadProject: (data: { filePath: string }): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.FILE_LOAD_PROJECT, data),

  // State synchronization
  stateSubscribe: (): Promise<RecordingSessionState> =>
    ipcRenderer.invoke(IpcChannels.STATE_SUBSCRIBE),
  onStateUpdate: (
    callback: (state: RecordingSessionState) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: RecordingSessionState
    ): void => {
      callback(state)
    }
    ipcRenderer.on(IpcChannels.STATE_UPDATE, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannels.STATE_UPDATE, handler)
    }
  },

  // Settings
  settingsGet: (): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_GET),
  settingsSave: (data: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_SAVE, data)
}

contextBridge.exposeInMainWorld('api', api)

export type XovrApi = typeof api
