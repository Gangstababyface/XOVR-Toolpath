import { useState, useEffect } from 'react'
import {
  useRecordingStore,
  useInitRecordingStore,
  useInitTranscriptionListener
} from './stores/recordingStore'
import { useMediaCapture } from './hooks/useMediaCapture'
import Toolbar from './pages/Toolbar'
import SelectionOverlay from './pages/SelectionOverlay'
import TranscriptionProgress from './components/TranscriptionProgress'
import EditPage from './pages/EditPage'
import SettingsPage from './pages/SettingsPage'

function MainView(): JSX.Element {
  useInitRecordingStore()
  useInitTranscriptionListener()
  const { isStarting, startError, startRecording, cancelStart, clearStartError } =
    useMediaCapture()

  const isRecording = useRecordingStore((s) => s.isRecording)
  const steps = useRecordingStore((s) => s.steps)
  const view = useRecordingStore((s) => s.view)

  // ── Recovery prompt ──
  const [recoverySnapshot, setRecoverySnapshot] = useState<{ savedAt: string; stepCount: number } | null>(null)

  useEffect(() => {
    window.api.autosaveCheck().then((snapshot: unknown) => {
      if (snapshot && typeof snapshot === 'object' && 'savedAt' in (snapshot as Record<string, unknown>)) {
        const s = snapshot as { savedAt: string; session: { steps: unknown[] } }
        setRecoverySnapshot({ savedAt: s.savedAt, stepCount: s.session.steps.length })
      }
    })
  }, [])

  if (view === 'settings') {
    return <SettingsPage />
  }

  if (view === 'edit' && steps.length > 0) {
    return <EditPage />
  }

  const hasCompletedSession = !isRecording && !isStarting && steps.length > 0

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1>XOVR Toolpath</h1>

      {recoverySnapshot && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: 16,
            backgroundColor: '#fffbeb',
            border: '1px solid #fcd34d',
            borderRadius: 6,
            fontSize: 14,
            color: '#92400e'
          }}
        >
          <strong>Previous session found</strong> ({recoverySnapshot.stepCount} steps, saved {new Date(recoverySnapshot.savedAt).toLocaleString()})
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button
              onClick={async () => {
                await window.api.autosaveRestore()
                setRecoverySnapshot(null)
                useRecordingStore.setState({ view: 'edit' })
              }}
              style={{
                padding: '4px 12px', fontSize: 13, backgroundColor: '#2563eb',
                color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer'
              }}
            >
              Restore
            </button>
            <button
              onClick={async () => {
                await window.api.autosaveDiscard()
                setRecoverySnapshot(null)
              }}
              style={{
                padding: '4px 12px', fontSize: 13, backgroundColor: '#f3f4f6',
                color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer'
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {startError && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: 16,
            backgroundColor: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            color: '#991b1b',
            fontSize: 14
          }}
        >
          <strong>Startup failed:</strong> {startError}
          <button
            onClick={clearStartError}
            style={{
              marginLeft: 12,
              padding: '2px 8px',
              fontSize: 12,
              backgroundColor: 'transparent',
              border: '1px solid #fca5a5',
              borderRadius: 4,
              color: '#991b1b',
              cursor: 'pointer'
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {isRecording ? (
        <p>Recording in progress. Use the toolbar to pause or stop.</p>
      ) : hasCompletedSession ? (
        <TranscriptionProgress />
      ) : isStarting ? (
        <div>
          <p>Acquiring capture sources...</p>
          <button
            onClick={cancelStart}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              backgroundColor: '#6b7280',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={startRecording}
          style={{
            padding: '12px 24px',
            fontSize: 16,
            backgroundColor: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer'
          }}
        >
          Start Recording
        </button>
      )}
    </div>
  )
}

function App(): JSX.Element {
  const hash = window.location.hash

  if (hash === '#toolbar') {
    return <Toolbar />
  }

  if (hash === '#overlay') {
    return <SelectionOverlay />
  }

  return <MainView />
}

export default App
