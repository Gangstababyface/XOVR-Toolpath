import {
  useRecordingStore,
  useInitRecordingStore
} from './stores/recordingStore'
import { useMediaCapture } from './hooks/useMediaCapture'
import Toolbar from './pages/Toolbar'
import SelectionOverlay from './pages/SelectionOverlay'

function MainView(): JSX.Element {
  useInitRecordingStore()
  const { isStarting, startError, startRecording, cancelStart, clearStartError } =
    useMediaCapture()

  const isRecording = useRecordingStore((s) => s.isRecording)

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1>XOVR Toolpath</h1>

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
