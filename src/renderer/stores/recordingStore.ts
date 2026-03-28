import { create } from 'zustand'
import { useEffect } from 'react'
import type { RecordingSessionState, TranscriptionProgress } from '../../shared/types'

type AppView = 'home' | 'edit' | 'settings'

interface RecordingStoreState extends RecordingSessionState {
  view: AppView
  projectFilePath: string | null
  transcription: TranscriptionProgress | null
  isTranscribing: boolean
  transcriptionComplete: boolean
  transcriptionError: string | null
}

const initialState: RecordingStoreState = {
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
  sessionDir: null,
  view: 'home',
  projectFilePath: null,
  transcription: null,
  isTranscribing: false,
  transcriptionComplete: false,
  transcriptionError: null
}

export const useRecordingStore = create<RecordingStoreState>()(() => initialState)

export function useInitRecordingStore(): void {
  useEffect(() => {
    window.api.stateSubscribe().then((state) => {
      useRecordingStore.setState(state)
    })

    const unsub = window.api.onStateUpdate((state) => {
      // Reset transcription state when a new recording starts
      if (state.isRecording && !useRecordingStore.getState().isRecording) {
        useRecordingStore.setState({
          ...state,
          view: 'home',
          transcription: null,
          isTranscribing: false,
          transcriptionComplete: false,
          transcriptionError: null
        })
      } else {
        useRecordingStore.setState(state)
      }
    })

    return unsub
  }, [])
}

export function useInitTranscriptionListener(): void {
  useEffect(() => {
    const unsub = window.api.onTranscribeProgress((progress) => {
      const { stepIndex, total, status, message } = progress

      if (status === 'error') {
        useRecordingStore.setState({
          transcription: progress,
          transcriptionError: message || 'Transcription failed'
        })
        return
      }

      const isLastStep = stepIndex === total - 1
      const isDone = status === 'done' && isLastStep

      useRecordingStore.setState({
        transcription: progress,
        isTranscribing: !isDone,
        transcriptionComplete: isDone,
        transcriptionError: null
      })
    })

    return unsub
  }, [])
}
