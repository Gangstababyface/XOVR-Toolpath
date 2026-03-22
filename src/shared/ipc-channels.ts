/**
 * IPC channel constants shared between main, preload, and renderer.
 * Single source of truth for all channel names.
 */
export const IpcChannels = {
  // Recording lifecycle
  RECORDING_START: 'recording:start',
  RECORDING_PAUSE: 'recording:pause',
  RECORDING_RESUME: 'recording:resume',
  RECORDING_STOP: 'recording:stop',
  RECORDING_CONFIRM_STARTED: 'recording:confirm-started',

  // Capture
  CAPTURE_MARK_STEP: 'capture:mark-step',
  OVERLAY_OPEN: 'overlay:open',
  OVERLAY_GET_DATA: 'overlay:get-data',
  OVERLAY_RESULT: 'overlay:result',

  // Transcription
  TRANSCRIBE_START: 'transcribe:start',
  TRANSCRIBE_PROGRESS: 'transcribe:progress',

  // Claude AI
  CLAUDE_QUESTIONS: 'claude:questions',
  CLAUDE_REWRITE: 'claude:rewrite',

  // Export
  EXPORT_RUN: 'export:run',

  // File operations
  FILE_SAVE_PROJECT: 'file:save-project',
  FILE_LOAD_PROJECT: 'file:load-project',

  // Recording media persistence
  RECORDING_SAVE_MEDIA: 'recording:save-media',

  // State synchronization
  STATE_SUBSCRIBE: 'state:subscribe',
  STATE_UPDATE: 'state:update',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
