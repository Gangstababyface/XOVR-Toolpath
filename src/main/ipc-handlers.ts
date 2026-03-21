import { ipcMain } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'

/**
 * Register all IPC handlers.
 * Stubs for Phase 1 — each handler will be implemented in its respective phase.
 */
export function registerIpcHandlers(): void {
  // Recording lifecycle — Phase 2
  ipcMain.handle(IpcChannels.RECORDING_START, async () => {
    // TODO: Phase 2
  })
  ipcMain.handle(IpcChannels.RECORDING_PAUSE, async () => {
    // TODO: Phase 2
  })
  ipcMain.handle(IpcChannels.RECORDING_RESUME, async () => {
    // TODO: Phase 2
  })
  ipcMain.handle(IpcChannels.RECORDING_STOP, async () => {
    // TODO: Phase 2
  })

  // Capture — Phase 3
  ipcMain.handle(IpcChannels.CAPTURE_MARK_STEP, async (_event, _data) => {
    // TODO: Phase 3
  })
  ipcMain.handle(IpcChannels.OVERLAY_OPEN, async (_event, _data) => {
    // TODO: Phase 3
  })

  // Transcription — Phase 4
  ipcMain.handle(IpcChannels.TRANSCRIBE_START, async () => {
    // TODO: Phase 4
  })

  // Claude AI — Phase 6
  ipcMain.handle(IpcChannels.CLAUDE_QUESTIONS, async (_event, _data) => {
    // TODO: Phase 6
  })
  ipcMain.handle(IpcChannels.CLAUDE_REWRITE, async (_event, _data) => {
    // TODO: Phase 6
  })

  // Export — Phase 7
  ipcMain.handle(IpcChannels.EXPORT_RUN, async (_event, _data) => {
    // TODO: Phase 7
  })

  // File operations — Phase 7
  ipcMain.handle(IpcChannels.FILE_SAVE_PROJECT, async (_event, _data) => {
    // TODO: Phase 7
  })
  ipcMain.handle(IpcChannels.FILE_LOAD_PROJECT, async (_event, _data) => {
    // TODO: Phase 7
  })

  // State synchronization — Phase 2
  ipcMain.handle(IpcChannels.STATE_SUBSCRIBE, async () => {
    // TODO: Phase 2 — return current canonical state snapshot
  })

  // Settings — Phase 7
  ipcMain.handle(IpcChannels.SETTINGS_GET, async () => {
    // TODO: Phase 7
  })
  ipcMain.handle(IpcChannels.SETTINGS_SAVE, async (_event, _data) => {
    // TODO: Phase 7
  })
}
