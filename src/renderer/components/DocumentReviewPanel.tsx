import { useState, useEffect, useCallback } from 'react'
import type { Step, DocumentReviewQuestion, DocumentReviewResult, ClaudeMemory } from '../../shared/types'

interface DocumentReviewPanelProps {
  steps: Step[]
  onClose: () => void
}

type Phase = 'idle' | 'analyzing' | 'questions' | 'rewriting' | 'diff' | 'error'

interface StepAcceptance {
  index: number
  accepted: boolean | null
  originalText: string
  suggestedTitle: string | null
  rewrittenDescription: string
}

function DocumentReviewPanel({ steps, onClose }: DocumentReviewPanelProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [progressMsg, setProgressMsg] = useState('')
  const [questions, setQuestions] = useState<DocumentReviewQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<DocumentReviewResult | null>(null)
  const [stepAcceptances, setStepAcceptances] = useState<StepAcceptance[]>([])
  const [memory, setMemory] = useState<ClaudeMemory | null>(null)

  // Load memory on mount
  useEffect(() => {
    window.api.claudeMemoryLoad().then((m) => {
      if (m) setMemory(m)
    }).catch(() => {})
  }, [])

  // Listen for progress updates
  useEffect(() => {
    const unsub = window.api.onClaudeReviewProgress((progress) => {
      if (progress.message) setProgressMsg(progress.message)
      if (progress.status === 'error') {
        setError(progress.message || 'Review failed')
        setPhase('error')
      }
    })
    return unsub
  }, [])

  const startReview = useCallback(async () => {
    setPhase('analyzing')
    setError(null)
    setProgressMsg('Analyzing document...')

    try {
      const qs = await window.api.claudeDocumentReview()
      if (qs.length === 0) {
        // No questions needed, go straight to rewrite
        setPhase('rewriting')
        setProgressMsg('Generating rewrite...')
        const rewriteResult = await window.api.claudeDocumentRewrite({
          questions: [],
          answers: {}
        })
        populateDiff(rewriteResult)
      } else {
        setQuestions(qs)
        setAnswers({})
        setPhase('questions')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }, [])

  const submitAnswersAndRewrite = useCallback(async () => {
    setPhase('rewriting')
    setProgressMsg('Generating rewrite...')

    try {
      const rewriteResult = await window.api.claudeDocumentRewrite({
        questions: questions.map((q) => ({ id: q.id, question: q.question })),
        answers
      })
      populateDiff(rewriteResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }, [questions, answers])

  const populateDiff = (rewriteResult: DocumentReviewResult): void => {
    setResult(rewriteResult)
    const acceptances: StepAcceptance[] = rewriteResult.steps.map((rs) => {
      const original = steps.find((s) => s.index + 1 === rs.index) || steps[rs.index - 1]
      return {
        index: rs.index,
        accepted: null,
        originalText: original?.editedText || original?.rawTranscript || '',
        suggestedTitle: rs.suggestedTitle,
        rewrittenDescription: rs.rewrittenDescription
      }
    })
    setStepAcceptances(acceptances)
    setPhase('diff')
  }

  const setAcceptance = (index: number, accepted: boolean): void => {
    setStepAcceptances((prev) =>
      prev.map((sa) => sa.index === index ? { ...sa, accepted } : sa)
    )
  }

  const acceptAll = (): void => {
    setStepAcceptances((prev) => prev.map((sa) => ({ ...sa, accepted: true })))
  }

  const rejectAll = (): void => {
    setStepAcceptances((prev) => prev.map((sa) => ({ ...sa, accepted: false })))
  }

  const applyAccepted = useCallback(async () => {
    for (const sa of stepAcceptances) {
      if (!sa.accepted) continue
      const step = steps.find((s) => s.index + 1 === sa.index) || steps[sa.index - 1]
      if (!step) continue

      // Apply rewritten text
      await window.api.stepUpdateText({ stepId: step.id, editedText: sa.rewrittenDescription })

      // Apply suggested title
      if (sa.suggestedTitle) {
        await window.api.stepUpdateTitle({ stepId: step.id, title: sa.suggestedTitle })
      }
    }

    // Update memory with Q&A decisions
    const updatedMemory: ClaudeMemory = memory || {
      projectContext: '',
      softwareBeingDocumented: '',
      targetAudience: '',
      previousDecisions: [],
      terminologyPreferences: {},
      styleNotes: [],
      lastUpdated: new Date().toISOString()
    }

    // Add Q&A pairs to previous decisions
    for (const q of questions) {
      const answer = answers[q.id]
      if (answer) {
        updatedMemory.previousDecisions.push({ question: q.question, answer })
      }
    }

    // Infer style preferences from accept/reject patterns
    const acceptedCount = stepAcceptances.filter((sa) => sa.accepted).length
    const rejectedCount = stepAcceptances.filter((sa) => sa.accepted === false).length
    if (rejectedCount > acceptedCount) {
      updatedMemory.styleNotes.push('User rejected most comprehensive rewrites - prefer concise text')
    }

    updatedMemory.lastUpdated = new Date().toISOString()
    await window.api.claudeMemorySave({ memory: updatedMemory }).catch(() => {})

    onClose()
  }, [stepAcceptances, steps, memory, questions, answers, onClose])

  const memoryBadge = memory
    ? `Memory: ${memory.previousDecisions.length} decisions`
    : null

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Document Review</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 16 }}
        >
          x
        </button>
      </div>

      {memoryBadge && (
        <div style={{
          padding: '4px 8px',
          fontSize: 11,
          backgroundColor: '#ede9fe',
          color: '#6d28d9',
          borderRadius: 4,
          marginBottom: 12
        }}>
          {memoryBadge}
        </div>
      )}

      {/* Idle state */}
      {phase === 'idle' && (
        <div>
          <p style={{ color: '#6b7280', marginBottom: 12 }}>
            Send the full document to Claude for a comprehensive review and rewrite of all steps.
          </p>
          <button
            onClick={startReview}
            style={{
              width: '100%',
              padding: '10px 16px',
              fontSize: 13,
              backgroundColor: '#7c3aed',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer'
            }}
          >
            Start Review
          </button>
        </div>
      )}

      {/* Analyzing / Rewriting progress */}
      {(phase === 'analyzing' || phase === 'rewriting') && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{
            width: 24,
            height: 24,
            border: '3px solid #e5e7eb',
            borderTopColor: '#7c3aed',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 12px'
          }} />
          <p style={{ color: '#6b7280' }}>{progressMsg}</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* Questions phase */}
      {phase === 'questions' && (
        <div>
          <p style={{ color: '#374151', fontWeight: 600, marginBottom: 8 }}>
            Claude has {questions.length} question{questions.length !== 1 ? 's' : ''}:
          </p>
          {questions.map((q) => (
            <div key={q.id} style={{ marginBottom: 12 }}>
              <p style={{ color: '#374151', marginBottom: 4 }}>{q.question}</p>
              {q.context && (
                <p style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>{q.context}</p>
              )}
              <input
                value={answers[q.id] || ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                placeholder="Your answer (or leave blank to skip)"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 12,
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  outline: 'none'
                }}
              />
            </div>
          ))}
          <button
            onClick={submitAnswersAndRewrite}
            style={{
              width: '100%',
              padding: '10px 16px',
              fontSize: 13,
              backgroundColor: '#7c3aed',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer',
              marginTop: 8
            }}
          >
            Continue to Rewrite
          </button>
        </div>
      )}

      {/* Diff view */}
      {phase === 'diff' && result && (
        <div>
          {result.documentTitle && (
            <div style={{ marginBottom: 12, padding: 8, backgroundColor: '#f0fdf4', borderRadius: 4 }}>
              <span style={{ fontSize: 11, color: '#15803d' }}>Suggested title:</span>
              <div style={{ fontWeight: 600 }}>{result.documentTitle}</div>
            </div>
          )}
          {result.documentSummary && (
            <div style={{ marginBottom: 12, padding: 8, backgroundColor: '#f0fdf4', borderRadius: 4 }}>
              <span style={{ fontSize: 11, color: '#15803d' }}>Summary:</span>
              <div style={{ fontSize: 12 }}>{result.documentSummary}</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button onClick={acceptAll} style={smallBtn}>Accept All</button>
            <button onClick={rejectAll} style={smallBtn}>Reject All</button>
          </div>

          {stepAcceptances.map((sa) => (
            <div
              key={sa.index}
              style={{
                marginBottom: 12,
                padding: 8,
                border: '1px solid #e5e7eb',
                borderRadius: 4,
                backgroundColor: sa.accepted === true ? '#f0fdf4' : sa.accepted === false ? '#fef2f2' : '#fff'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>
                  Step {sa.index}
                  {sa.suggestedTitle && (
                    <span style={{ fontWeight: 400, color: '#6b7280' }}> - {sa.suggestedTitle}</span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => setAcceptance(sa.index, true)}
                    style={{
                      ...tinyBtn,
                      backgroundColor: sa.accepted === true ? '#16a34a' : '#e5e7eb',
                      color: sa.accepted === true ? '#fff' : '#374151'
                    }}
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => setAcceptance(sa.index, false)}
                    style={{
                      ...tinyBtn,
                      backgroundColor: sa.accepted === false ? '#dc2626' : '#e5e7eb',
                      color: sa.accepted === false ? '#fff' : '#374151'
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>

              {/* Current text */}
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>Current:</div>
              <div style={{
                fontSize: 11,
                padding: 4,
                backgroundColor: '#fef2f2',
                borderRadius: 2,
                marginBottom: 6,
                whiteSpace: 'pre-wrap',
                maxHeight: 60,
                overflow: 'auto'
              }}>
                {sa.originalText || '(empty)'}
              </div>

              {/* Suggested text */}
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>Suggested:</div>
              <div style={{
                fontSize: 11,
                padding: 4,
                backgroundColor: '#f0fdf4',
                borderRadius: 2,
                whiteSpace: 'pre-wrap',
                maxHeight: 80,
                overflow: 'auto'
              }}>
                {sa.rewrittenDescription}
              </div>
            </div>
          ))}

          <button
            onClick={applyAccepted}
            disabled={!stepAcceptances.some((sa) => sa.accepted === true)}
            style={{
              width: '100%',
              padding: '10px 16px',
              fontSize: 13,
              backgroundColor: stepAcceptances.some((sa) => sa.accepted === true) ? '#16a34a' : '#9ca3af',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer',
              marginTop: 8
            }}
          >
            Apply Accepted Changes
          </button>
        </div>
      )}

      {/* Error state */}
      {phase === 'error' && (
        <div>
          <div style={{
            padding: 8,
            backgroundColor: '#fef2f2',
            color: '#dc2626',
            borderRadius: 4,
            fontSize: 12,
            marginBottom: 12
          }}>
            {error || 'An error occurred'}
          </div>
          <button
            onClick={startReview}
            style={{
              width: '100%',
              padding: '10px 16px',
              fontSize: 13,
              backgroundColor: '#7c3aed',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

const smallBtn: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  backgroundColor: '#f3f4f6',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 3,
  cursor: 'pointer'
}

const tinyBtn: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 10,
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer'
}

export default DocumentReviewPanel
