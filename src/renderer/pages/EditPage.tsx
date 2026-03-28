import { useState, useCallback, useRef } from 'react'
import { useRecordingStore } from '../stores/recordingStore'
import StepCard from '../components/StepCard'
import ClaudeChat from '../components/ClaudeChat'
import DocumentPreview from '../components/DocumentPreview'
import DocumentReviewPanel from '../components/DocumentReviewPanel'

function EditPage(): JSX.Element {
  const steps = useRecordingStore((s) => s.steps)
  const projectFilePath = useRecordingStore((s) => s.projectFilePath)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [batchRunning, setBatchRunning] = useState(false)
  const [rewriteTrigger, setRewriteTrigger] = useState(0)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [centerTab, setCenterTab] = useState<'step' | 'preview'>('step')
  const [reviewActive, setReviewActive] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

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
          <div ref={exportRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setExportMenuOpen((v) => !v)}
              style={topBarBtn}
            >
              Export
            </button>
            {exportMenuOpen && (
              <div style={dropdownStyle}>
                {(['markdown', 'html', 'pdf'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={async () => {
                      setExportMenuOpen(false)
                      try { await window.api.exportRun({ format: fmt }) }
                      catch (err) { console.error('[EditPage] Export failed:', err) }
                    }}
                    style={dropdownItemStyle}
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setReviewActive(true)}
            disabled={!steps.some((s) => s.editedText || s.rawTranscript)}
            style={{
              ...topBarBtn,
              backgroundColor: '#7c3aed',
              color: '#fff',
              border: '1px solid #6d28d9',
              opacity: steps.some((s) => s.editedText || s.rawTranscript) ? 1 : 0.5
            }}
          >
            Claude Review
          </button>
          <button
            onClick={async () => {
              try {
                const path = await window.api.fileSaveProject(
                  projectFilePath ? { filePath: projectFilePath } : undefined
                )
                if (path) useRecordingStore.setState({ projectFilePath: path })
              } catch (err) { console.error('[EditPage] Save failed:', err) }
            }}
            style={topBarBtn}
          >
            Save Project
          </button>
          <button
            onClick={() => useRecordingStore.setState({ view: 'settings' })}
            style={topBarBtn}
          >
            Settings
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
                  {step.title || `Step ${i + 1}`}
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

        {/* Center — tab bar + content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Tab bar */}
          <div style={{
            display: 'flex',
            gap: 0,
            borderBottom: '1px solid #e5e7eb',
            backgroundColor: '#fff',
            flexShrink: 0
          }}>
            {(['step', 'preview'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setCenterTab(tab)}
                style={{
                  padding: '8px 20px',
                  fontSize: 13,
                  fontWeight: centerTab === tab ? 600 : 400,
                  color: centerTab === tab ? '#2563eb' : '#6b7280',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderBottom: centerTab === tab ? '2px solid #2563eb' : '2px solid transparent',
                  cursor: 'pointer'
                }}
              >
                {tab === 'step' ? 'Step Editor' : 'Document Preview'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            {centerTab === 'step' ? (
              selectedStep ? (
                <StepCard
                  step={selectedStep}
                  onTextChange={handleTextChange}
                  onTitleTab={() => setSelectedIndex((i) => Math.min(steps.length - 1, i + 1))}
                />
              ) : (
                <p style={{ color: '#6b7280' }}>No step selected</p>
              )
            ) : (
              <DocumentPreview steps={steps} />
            )}
          </div>
        </div>

        {/* Right panel — Claude chat or Document Review */}
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
          {reviewActive ? (
            <DocumentReviewPanel
              steps={steps}
              onClose={() => setReviewActive(false)}
            />
          ) : selectedStep ? (
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

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 4,
  backgroundColor: '#fff',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  zIndex: 10,
  minWidth: 120
}

const dropdownItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 14px',
  fontSize: 13,
  border: 'none',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  textAlign: 'left',
  color: '#374151'
}

export default EditPage
