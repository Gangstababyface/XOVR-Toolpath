import { useState, useCallback } from 'react'
import { useRecordingStore } from '../stores/recordingStore'
import StepCard from '../components/StepCard'
import ClaudeChat from '../components/ClaudeChat'

function EditPage(): JSX.Element {
  const steps = useRecordingStore((s) => s.steps)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [batchRunning, setBatchRunning] = useState(false)
  const [rewriteTrigger, setRewriteTrigger] = useState(0)

  const selectedStep = steps[selectedIndex] ?? null

  const handleTextChange = useCallback((stepId: string, editedText: string) => {
    window.api.stepUpdateText({ stepId, editedText })
  }, [])

  const handleRewriteCurrent = useCallback(() => {
    if (!selectedStep) return
    setRewriteTrigger((t) => t + 1)
  }, [selectedStep])

  const handleRewriteAll = useCallback(async () => {
    setBatchRunning(true)
    try {
      await window.api.claudeBatchRewrite()
    } catch (err) {
      console.error('[EditPage] Batch rewrite failed:', err)
    } finally {
      setBatchRunning(false)
    }
  }, [])

  const goPrev = () => setSelectedIndex((i) => Math.max(0, i - 1))
  const goNext = () => setSelectedIndex((i) => Math.min(steps.length - 1, i + 1))

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden'
      }}
    >
      {/* ── Top bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 20px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#fff',
          flexShrink: 0
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 16 }}>XOVR Toolpath</span>
        <span style={{ color: '#6b7280', fontSize: 13 }}>
          Step {selectedIndex + 1} of {steps.length}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              // Phase 7 — export
              console.log('[EditPage] Export clicked')
            }}
            style={topBarBtn}
          >
            Export
          </button>
          <button
            onClick={() => {
              // Phase 7 — save
              console.log('[EditPage] Save clicked')
            }}
            style={topBarBtn}
          >
            Save Project
          </button>
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left panel — step list */}
        <div
          style={{
            width: 200,
            borderRight: '1px solid #e5e7eb',
            overflowY: 'auto',
            backgroundColor: '#f9fafb',
            flexShrink: 0
          }}
        >
          {steps.map((step, i) => (
            <button
              key={step.id}
              onClick={() => setSelectedIndex(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '10px 14px',
                border: 'none',
                borderBottom: '1px solid #e5e7eb',
                backgroundColor: i === selectedIndex ? '#dbeafe' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 13
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  backgroundColor: i === selectedIndex ? '#2563eb' : '#d1d5db',
                  color: i === selectedIndex ? '#fff' : '#374151',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0
                }}
              >
                {i + 1}
              </span>
              <div style={{ overflow: 'hidden' }}>
                <div
                  style={{
                    fontWeight: 500,
                    color: '#111827',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  Step {i + 1}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#9ca3af',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {step.editedText
                    ? step.editedText.slice(0, 30) + (step.editedText.length > 30 ? '...' : '')
                    : '(no text)'}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Center — step card */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {selectedStep ? (
            <StepCard step={selectedStep} onTextChange={handleTextChange} />
          ) : (
            <p style={{ color: '#6b7280' }}>No step selected</p>
          )}
        </div>

        {/* Right panel — Claude chat */}
        <div
          style={{
            width: 300,
            borderLeft: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
            padding: 16,
            flexShrink: 0,
            overflowY: 'auto'
          }}
        >
          {selectedStep ? (
            <ClaudeChat step={selectedStep} rewriteTrigger={rewriteTrigger} />
          ) : (
            <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
              Select a step to use Claude AI
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 20px',
          borderTop: '1px solid #e5e7eb',
          backgroundColor: '#fff',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={goPrev}
            disabled={selectedIndex <= 0}
            style={{
              ...bottomBtn,
              opacity: selectedIndex <= 0 ? 0.4 : 1
            }}
          >
            Previous
          </button>
          <button
            onClick={goNext}
            disabled={selectedIndex >= steps.length - 1}
            style={{
              ...bottomBtn,
              opacity: selectedIndex >= steps.length - 1 ? 0.4 : 1
            }}
          >
            Next
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleRewriteCurrent}
            disabled={!selectedStep}
            style={{ ...bottomBtn, backgroundColor: '#2563eb', color: '#fff' }}
          >
            Rewrite Current
          </button>
          <button
            onClick={handleRewriteAll}
            disabled={batchRunning}
            style={{
              ...bottomBtn,
              backgroundColor: batchRunning ? '#a78bfa' : '#7c3aed',
              color: '#fff'
            }}
          >
            {batchRunning ? 'Rewriting All...' : 'Rewrite All'}
          </button>
        </div>
      </div>
    </div>
  )
}

const topBarBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  backgroundColor: '#f3f4f6',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  cursor: 'pointer'
}

const bottomBtn: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  backgroundColor: '#f3f4f6',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 5,
  cursor: 'pointer'
}

export default EditPage
