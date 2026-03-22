import { create } from 'zustand'
import { useEffect } from 'react'
import type { RecordingSessionState } from '../../shared/types'

const initialState: RecordingSessionState = {
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

export const useRecordingStore = create<RecordingSessionState>()(() => initialState)

export function useInitRecordingStore(): void {
  useEffect(() => {
    window.api.stateSubscribe().then((state) => {
      useRecordingStore.setState(state)
    })

    const unsub = window.api.onStateUpdate((state) => {
      useRecordingStore.setState(state)
    })

    return unsub
  }, [])
}
