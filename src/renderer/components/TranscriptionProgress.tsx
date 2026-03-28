import { useRecordingStore } from '../stores/recordingStore'

function TranscriptionProgress(): JSX.Element {
  const steps = useRecordingStore((s) => s.steps)
  const transcription = useRecordingStore((s) => s.transcription)
  const isTranscribing = useRecordingStore((s) => s.isTranscribing)
  const transcriptionComplete = useRecordingStore((s) => s.transcriptionComplete)
  const transcriptionError = useRecordingStore((s) => s.transcriptionError)

  if (steps.length === 0) {
    return (
      <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
        <h2>No Steps Captured</h2>
        <p style={{ color: '#6b7280' }}>
          No steps were marked during recording. Use Ctrl+Shift+S to mark steps while recording.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 20px',
            fontSize: 14,
            backgroundColor: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer'
          }}
        >
          Start New Recording
        </button>
      </div>
    )
  }

  const total = transcription?.total ?? steps.length
  const currentIndex = transcription?.stepIndex ?? -1
  const progressPct = transcriptionComplete
    ? 100
    : total > 0
      ? Math.round(((currentIndex + 1) / total) * 100)
      : 0

  function handleRetry(): void {
    useRecordingStore.setState({
      transcriptionError: null,
      isTranscribing: true,
      transcriptionComplete: false
    })
    window.api.transcribeStart().catch((err) => {
      console.error('[TranscriptionProgress] retry failed:', err)
    })
  }

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>
        {transcriptionComplete
          ? 'Transcription Complete'
          : transcriptionError
            ? 'Transcription Error'
            : 'Transcribing Audio...'}
      </h2>

      {/* Progress bar */}
      <div
        style={{
          height: 8,
          backgroundColor: '#e5e7eb',
          borderRadius: 4,
          overflow: 'hidden',
          marginBottom: 20
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progressPct}%`,
            backgroundColor: transcriptionError ? '#ef4444' : transcriptionComplete ? '#22c55e' : '#2563eb',
            borderRadius: 4,
            transition: 'width 0.3s ease'
          }}
        />
      </div>

      {/* Per-step status list */}
      <div style={{ marginBottom: 20 }}>
        {steps.map((step, i) => {
          let statusIcon: string
          let statusColor: string

          if (transcriptionError && currentIndex === i) {
            statusIcon = 'x'
            statusColor = '#ef4444'
          } else if (i < currentIndex || (i === currentIndex && transcription?.status === 'done')) {
            statusIcon = '\u2713'
            statusColor = '#22c55e'
          } else if (i === currentIndex) {
            statusIcon = transcription?.status === 'extracting' ? '\u2026' : '\u25cb'
            statusColor = '#2563eb'
          } else {
            statusIcon = '\u2014'
            statusColor = '#9ca3af'
          }

          const statusLabel =
            i === currentIndex && transcription
              ? transcription.status === 'extracting'
                ? 'Extracting audio...'
                : transcription.status === 'transcribing'
                  ? 'Transcribing...'
                  : transcription.status === 'done'
                    ? step.rawTranscript
                      ? step.rawTranscript.slice(0, 60) + (step.rawTranscript.length > 60 ? '...' : '')
                      : 'Done'
                    : transcription.message || 'Error'
              : step.rawTranscript
                ? step.rawTranscript.slice(0, 60) + (step.rawTranscript.length > 60 ? '...' : '')
                : i < currentIndex
                  ? 'Done'
                  : 'Pending'

          return (
            <div
              key={step.id}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                padding: '6px 0',
                fontSize: 14,
                borderBottom: '1px solid #f3f4f6'
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  color: statusColor,
                  width: 20,
                  textAlign: 'center',
                  flexShrink: 0
                }}
              >
                {statusIcon}
              </span>
              <span style={{ color: '#374151', fontWeight: 500 }}>Step {i + 1}</span>
              <span style={{ color: '#6b7280', fontSize: 13 }}>{statusLabel}</span>
            </div>
          )
        })}
      </div>

      {/* Error message + retry */}
      {transcriptionError && (
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
          <strong>Error:</strong> {transcriptionError}
          <button
            onClick={handleRetry}
            style={{
              display: 'block',
              marginTop: 8,
              padding: '6px 16px',
              fontSize: 13,
              backgroundColor: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer'
            }}
          >
            Retry Transcription
          </button>
        </div>
      )}

      {/* Completion actions */}
      {transcriptionComplete && (
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => {
              useRecordingStore.setState({ view: 'edit' })
            }}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              backgroundColor: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            Proceed to Edit
          </button>
        </div>
      )}

      {/* Transcribing status */}
      {isTranscribing && !transcriptionError && (
        <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
          Step {currentIndex + 1} of {total}
          {transcription?.status === 'extracting' && ' — extracting audio segment'}
          {transcription?.status === 'transcribing' && ' — sending to Whisper API'}
        </p>
      )}
    </div>
  )
}

export default TranscriptionProgress
