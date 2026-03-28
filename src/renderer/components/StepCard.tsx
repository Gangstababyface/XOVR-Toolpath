import { useEffect, useRef, useState, useCallback } from 'react'
import type { Step } from '../../shared/types'

interface StepCardProps {
  step: Step
  onTextChange: (stepId: string, editedText: string) => void
}

function StepCard({ step, onTextChange }: StepCardProps): JSX.Element {
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load screenshot
  useEffect(() => {
    let cancelled = false
    setScreenshotUrl(null)
    if (step.screenshot) {
      window.api.screenshotLoad(step.screenshot).then((url) => {
        if (!cancelled && url) setScreenshotUrl(url)
      })
    }
    return () => { cancelled = true }
  }, [step.screenshot])

  const handleImgLoad = useCallback(() => {
    if (imgRef.current) {
      setImgSize({
        w: imgRef.current.naturalWidth,
        h: imgRef.current.naturalHeight
      })
    }
  }, [])

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onTextChange(step.id, text)
      }, 500)
    },
    [step.id, onTextChange]
  )

  // Compute selection rect overlay position scaled to rendered image size
  const renderRect = () => {
    if (!step.selectionRect || !imgRef.current || !imgSize) return null
    const rendered = imgRef.current.getBoundingClientRect()
    const scaleX = rendered.width / imgSize.w
    const scaleY = rendered.height / imgSize.h
    const r = step.selectionRect

    return (
      <div
        style={{
          position: 'absolute',
          left: r.x * scaleX,
          top: r.y * scaleY,
          width: r.width * scaleX,
          height: r.height * scaleY,
          border: '2px solid #ef4444',
          borderRadius: 2,
          pointerEvents: 'none',
          boxSizing: 'border-box'
        }}
      />
    )
  }

  const statusBadge = () => {
    const colors: Record<string, { bg: string; text: string }> = {
      raw: { bg: '#f3f4f6', text: '#6b7280' },
      ai_rewritten: { bg: '#dbeafe', text: '#1d4ed8' },
      manually_edited: { bg: '#dcfce7', text: '#15803d' }
    }
    const c = colors[step.rewriteStatus] || colors.raw
    const label = step.rewriteStatus === 'raw'
      ? 'Raw'
      : step.rewriteStatus === 'ai_rewritten'
        ? 'AI Rewritten'
        : 'Edited'

    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          fontSize: 11,
          fontWeight: 600,
          backgroundColor: c.bg,
          color: c.text,
          borderRadius: 4
        }}
      >
        {label}
      </span>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Screenshot with selection overlay */}
      <div
        style={{
          position: 'relative',
          backgroundColor: '#111827',
          borderRadius: 6,
          overflow: 'hidden',
          flexShrink: 0,
          maxHeight: '45%'
        }}
      >
        {screenshotUrl ? (
          <>
            <img
              ref={imgRef}
              src={screenshotUrl}
              onLoad={handleImgLoad}
              style={{
                display: 'block',
                width: '100%',
                height: 'auto',
                maxHeight: '100%',
                objectFit: 'contain'
              }}
              alt={`Step ${step.index + 1} screenshot`}
            />
            {renderRect()}
          </>
        ) : (
          <div
            style={{
              height: 200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6b7280'
            }}
          >
            Loading screenshot...
          </div>
        )}
      </div>

      {/* Status + step info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          Step {step.index + 1}
        </span>
        {statusBadge()}
        <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 'auto' }}>
          {(step.timestamp / 1000).toFixed(1)}s
        </span>
      </div>

      {/* Editable text */}
      <textarea
        defaultValue={step.editedText}
        key={`${step.id}-${step.rewriteStatus}-${step.rewriteSource}`}
        onChange={handleTextChange}
        placeholder="Step text..."
        style={{
          flex: 1,
          minHeight: 100,
          padding: 12,
          fontSize: 14,
          lineHeight: 1.5,
          fontFamily: 'system-ui, sans-serif',
          border: '1px solid #d1d5db',
          borderRadius: 6,
          resize: 'vertical',
          outline: 'none'
        }}
      />

      {/* Raw transcript toggle */}
      <div>
        <button
          onClick={() => setShowRaw(!showRaw)}
          style={{
            background: 'none',
            border: 'none',
            color: '#6b7280',
            fontSize: 12,
            cursor: 'pointer',
            padding: '4px 0',
            textDecoration: 'underline'
          }}
        >
          {showRaw ? 'Hide' : 'Show'} raw transcript
        </button>
        {showRaw && (
          <div
            style={{
              marginTop: 4,
              padding: 10,
              fontSize: 13,
              lineHeight: 1.4,
              backgroundColor: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 4,
              color: '#374151',
              whiteSpace: 'pre-wrap'
            }}
          >
            {step.rawTranscript || '(empty)'}
          </div>
        )}
      </div>
    </div>
  )
}

export default StepCard
