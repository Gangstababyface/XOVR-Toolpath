import { BrowserWindow } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'
import type { RecordingSessionState } from '../shared/types'

function createInitialState(): RecordingSessionState {
  return {
    isRecording: false,
    isPaused: false,
    sessionStartTime: null,
    pauseStartedAt: null,
    totalPausedDuration: 0,
    activeCaptureQueue: 0,
    selectedSourceId: null,
    steps: [],
    audioFilePath: null,
    videoFilePath: null,
    sessionDir: null
  }
}

let state: RecordingSessionState = createInitialState()

function snapshot(): RecordingSessionState {
  return { ...state, steps: state.steps.map((s) => ({ ...s })) }
}

function broadcast(): void {
  const data = snapshot()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.STATE_UPDATE, data)
    }
  }
}

export function getState(): RecordingSessionState {
  return snapshot()
}

export function startRecording(sessionDir: string): void {
  const preservedSourceId = state.selectedSourceId
  state = {
    ...createInitialState(),
    isRecording: true,
    sessionStartTime: Date.now(),
    sessionDir,
    selectedSourceId: preservedSourceId
  }
  console.log('[state-bus] startRecording: sessionDir=%s selectedSourceId=%s', sessionDir, preservedSourceId)
  broadcast()
}

export function pauseRecording(): void {
  if (!state.isRecording || state.isPaused) return
  state = {
    ...state,
    isPaused: true,
    pauseStartedAt: Date.now()
  }
  broadcast()
}

export function resumeRecording(): void {
  if (!state.isRecording || !state.isPaused || state.pauseStartedAt === null) return
  state = {
    ...state,
    isPaused: false,
    totalPausedDuration: state.totalPausedDuration + (Date.now() - state.pauseStartedAt),
    pauseStartedAt: null
  }
  broadcast()
}

export function stopRecording(): void {
  if (!state.isRecording) return
  let finalPausedDuration = state.totalPausedDuration
  if (state.isPaused && state.pauseStartedAt !== null) {
    finalPausedDuration += Date.now() - state.pauseStartedAt
  }
  state = {
    ...state,
    isRecording: false,
    isPaused: false,
    pauseStartedAt: null,
    totalPausedDuration: finalPausedDuration
  }
  broadcast()
}

export function setSelectedSource(sourceId: string): void {
  state = { ...state, selectedSourceId: sourceId }
  broadcast()
}

export function addStep(step: import('../shared/types').Step): void {
  state = { ...state, steps: [...state.steps, step] }
  console.log('[state-bus] addStep: index=%d id=%s timestamp=%d', step.index, step.id, step.timestamp)
  broadcast()
}

export function updateStepTranscript(stepId: string, rawTranscript: string): void {
  state = {
    ...state,
    steps: state.steps.map((s) =>
      s.id === stepId
        ? { ...s, rawTranscript, editedText: rawTranscript }
        : s
    )
  }
  broadcast()
}

export function setCaptureQueueSize(size: number): void {
  state = { ...state, activeCaptureQueue: size }
  broadcast()
}

export function setMediaPaths(videoPath: string, audioPath: string): void {
  state = {
    ...state,
    videoFilePath: videoPath,
    audioFilePath: audioPath
  }
  broadcast()
}
