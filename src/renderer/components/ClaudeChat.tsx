import { useState, useEffect } from 'react'
import type { Step } from '../../shared/types'

interface ClaudeChatProps {
  step: Step
  rewriteTrigger?: number
}

function ClaudeChat({ step, rewriteTrigger }: ClaudeChatProps): JSX.Element {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [questions, setQuestions] = useState<string[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<'idle' | 'questions' | 'answering' | 'rewriting' | 'done'>('idle')

  // Trigger rewrite from external button
  useEffect(() => {
    if (rewriteTrigger && rewriteTrigger > 0) {
      handleAskClaude()
    }
  }, [rewriteTrigger])

  // Reset when step changes
  useEffect(() => {
    setLoading(false)
    setError(null)
    setQuestions([])
    setAnswers({})

    // Restore state from step's existing Q&A
    if (step.claudeQuestions.length > 0) {
      const qs = step.claudeQuestions.map((qa) => qa.question)
      const ans: Record<string, string> = {}
      step.claudeQuestions.forEach((qa) => {
        if (qa.answer) ans[qa.question] = qa.answer
      })
      setQuestions(qs)
      setAnswers(ans)

      if (step.rewriteStatus === 'ai_rewritten') {
        setPhase('done')
      } else if (Object.keys(ans).length > 0) {
        setPhase('answering')
      } else {
        setPhase('answering')
      }
    } else if (step.rewriteStatus === 'ai_rewritten') {
      setPhase('done')
    } else {
      setPhase('idle')
    }
  }, [step.id])

  async function handleAskClaude(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const qs: string[] = await window.api.claudeQuestions({ stepId: step.id })
      if (qs.length === 0) {
        // No questions needed — go straight to rewrite
        setPhase('rewriting')
        await doRewrite({})
      } else {
        setQuestions(qs)
        setAnswers({})
        setPhase('answering')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitAnswers(): Promise<void> {
    setPhase('rewriting')
    setLoading(true)
    setError(null)
    await doRewrite(answers)
  }

  async function doRewrite(ans: Record<string, string>): Promise<void> {
    try {
      await window.api.claudeRewrite({ stepId: step.id, answers: ans })
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('answering')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        height: '100%',
        fontSize: 13
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>Claude AI</div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '8px 10px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 4,
            color: '#991b1b',
            fontSize: 12
          }}
        >
          {error}
        </div>
      )}

      {/* Idle state */}
      {phase === 'idle' && !loading && (
        <div>
          <p style={{ color: '#6b7280', margin: '0 0 10px' }}>
            Ask Claude to generate clarifying questions and rewrite this step.
          </p>
          <button onClick={handleAskClaude} style={primaryBtn}>
            Ask Claude
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ color: '#6b7280', padding: '8px 0' }}>
          {phase === 'rewriting' ? 'Rewriting step...' : 'Generating questions...'}
        </div>
      )}

      {/* Questions + answer form */}
      {phase === 'answering' && !loading && questions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: '#374151', fontWeight: 500 }}>Clarifying questions:</div>
          {questions.map((q, i) => (
            <div key={i}>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: '#374151',
                  marginBottom: 3,
                  fontWeight: 500
                }}
              >
                {q}
              </label>
              <input
                type="text"
                value={answers[q] || ''}
                onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
                placeholder="Your answer..."
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 12,
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  boxSizing: 'border-box'
                }}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSubmitAnswers} style={primaryBtn}>
              Rewrite Step
            </button>
            <button
              onClick={() => doRewrite({})}
              style={secondaryBtn}
            >
              Skip &amp; Rewrite
            </button>
          </div>
        </div>
      )}

      {/* Done state */}
      {phase === 'done' && !loading && (
        <div>
          <div
            style={{
              padding: '8px 10px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 4,
              color: '#15803d',
              fontSize: 12,
              marginBottom: 10
            }}
          >
            Step rewritten by Claude
            {step.rewriteSource === 'batch' && ' (batch)'}
            {step.rewriteSource === 'interactive' && ' (interactive)'}
          </div>

          {/* Show Q&A history */}
          {step.claudeQuestions.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                Q&A History
              </div>
              {step.claudeQuestions.map((qa, i) => (
                <div key={i} style={{ marginBottom: 6, fontSize: 12 }}>
                  <div style={{ color: '#374151', fontWeight: 500 }}>Q: {qa.question}</div>
                  <div style={{ color: '#6b7280' }}>A: {qa.answer || '(skipped)'}</div>
                </div>
              ))}
            </div>
          )}

          <button onClick={handleAskClaude} style={secondaryBtn}>
            Rewrite Again
          </button>
        </div>
      )}
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 600,
  backgroundColor: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer'
}

const secondaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 12,
  backgroundColor: '#f3f4f6',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  cursor: 'pointer'
}

export default ClaudeChat
