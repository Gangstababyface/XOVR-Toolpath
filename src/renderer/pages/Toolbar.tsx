import { useEffect, useState } from 'react'
import {
  useRecordingStore,
  useInitRecordingStore
} from '../stores/recordingStore'

function Toolbar(): JSX.Element {
  useInitRecordingStore()

  const isRecording = useRecordingStore((s) => s.isRecording)
  const isPaused = useRecordingStore((s) => s.isPaused)
  const sessionStartTime = useRecordingStore((s) => s.sessionStartTime)
  const totalPausedDuration = useRecordingStore((s) => s.totalPausedDuration)
  const pauseStartedAt = useRecordingStore((s) => s.pauseStartedAt)

  const [elapsed, setElapsed] = useState('00:00')

  useEffect(() => {
    if (!isRecording || sessionStartTime === null) return

    function tick(): void {
      let ms: number
      if (isPaused && pauseStartedAt !== null) {
        ms = pauseStartedAt - sessionStartTime! - totalPausedDuration
      } else {
        ms = Date.now() - sessionStartTime! - totalPausedDuration
      }
      if (ms < 0) ms = 0
      const totalSeconds = Math.floor(ms / 1000)
      const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
      const seconds = String(totalSeconds % 60).padStart(2, '0')
      setElapsed(`${minutes}:${seconds}`)
    }

    tick()
    const interval = setInterval(tick, 200)
    return () => clearInterval(interval)
  }, [isRecording, isPaused, sessionStartTime, totalPausedDuration, pauseStartedAt])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 20px',
        height: '100%',
        boxSizing: 'border-box',
        backgroundColor: '#1a1a2e',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        WebkitAppRegion: 'drag',
        userSelect: 'none'
      } as React.CSSProperties}
    >
      {/* Recording indicator dot */}
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          backgroundColor: isPaused ? '#f59e0b' : '#ef4444',
          flexShrink: 0
        }}
      />

      {/* Status label */}
      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 52 }}>
        {isPaused ? 'PAUSED' : 'REC'}
      </span>

      {/* Timer */}
      <span
        style={{
          fontSize: 18,
          fontFamily: 'monospace',
          fontWeight: 600,
          minWidth: 56
        }}
      >
        {elapsed}
      </span>

      {/* Controls — must be no-drag so buttons work */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginLeft: 'auto',
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}
      >
        {isPaused ? (
          <button
            onClick={() => window.api.recordingResume()}
            style={btnStyle}
          >
            Resume
          </button>
        ) : (
          <button onClick={() => window.api.recordingPause()} style={btnStyle}>
            Pause
          </button>
        )}
        <button
          onClick={() => window.api.recordingStop()}
          style={{ ...btnStyle, backgroundColor: '#ef4444' }}
        >
          Stop
        </button>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '6px 16px',
  border: 'none',
  borderRadius: 4,
  backgroundColor: '#374151',
  color: '#fff',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer'
}

export default Toolbar
