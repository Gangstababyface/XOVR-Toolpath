import { useEffect, useRef, useState, useCallback } from 'react'
import type { Step } from '../../shared/types'

interface StepCardProps {
  step: Step
  onTextChange: (stepId: string, editedText: string) => void
  onTitleTab?: () => void
}

function StepCard({ step, onTextChange, onTitleTab }: StepCardProps): JSX.Element {
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [showFull, setShowFull] = useState(false)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(step.title)
  const titleInputRef = useRef<HTMLInputElement>(null)
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

  // Sync title draft when step changes
  useEffect(() => {
    setTitleDraft(step.title || `Step ${step.index + 1}`)
    setEditingTitle(false)
  }, [step.id, step.title, step.index])

  const commitTitle = useCallback(() => {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== step.title) {
      window.api.stepUpdateTitle({ stepId: step.id, title: trimmed })
    }
    setEditingTitle(false)
  }, [titleDraft, step.id, step.title])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitTitle()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commitTitle()
      onTitleTab?.()
    } else if (e.key === 'Escape') {
      setTitleDraft(step.title || `Step ${step.index + 1}`)
      setEditingTitle(false)
    }
  }, [commitTitle, onTitleTab, step.title, step.index])

  // Render highlight rect as SVG overlay using viewBox for proper coordinate mapping
  const renderHighlightSvg = () => {
    if (!step.selectionRect || !imgSize) return null

    const crop = step.cropRect && !showFull ? step.cropRect : null
    const viewX = crop ? crop.x : 0
    const viewY = crop ? crop.y : 0
    const viewW = crop ? crop.width : imgSize.w
    const viewH = crop ? crop.height : imgSize.h

    const r = step.selectionRect
    const strokeWidth = Math.max(2, Math.round(Math.max(viewW, viewH) / 400))

    return (
      <svg
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`}
        preserveAspectRatio="xMinYMin meet"
      >
        <rect
          x={r.x} y={r.y} width={r.width} height={r.height}
          fill="none" stroke="#ef4444" strokeWidth={strokeWidth}
        />
      </svg>
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
      {/* Editable step title */}
      {editingTitle ? (
        <input
          ref={titleInputRef}
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={handleTitleKeyDown}
          autoFocus
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: '#111827',
            border: '1px solid #2563eb',
            borderRadius: 4,
            padding: '4px 8px',
            outline: 'none',
            width: '100%'
          }}
        />
      ) : (
        <div
          onClick={() => {
            setEditingTitle(true)
            setTimeout(() => titleInputRef.current?.select(), 0)
          }}
          title="Click to edit title"
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: '#111827',
            cursor: 'text',
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid transparent'
          }}
          onMouseOver={(e) => { (e.currentTarget.style.borderColor = '#d1d5db') }}
          onMouseOut={(e) => { (e.currentTarget.style.borderColor = 'transparent') }}
        >
          {step.title || `Step ${step.index + 1}`}
        </div>
      )}

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
            {step.cropRect && !showFull && imgSize ? (
              // Cropped view: use a wrapper div that clips the image
              (() => {
                const crop = step.cropRect
                // Compute aspect ratio of the crop region
                const cropAspect = crop.width / crop.height
                // The wrapper takes full width; height is derived from crop aspect
                return (
                  <div style={{
                    position: 'relative',
                    width: '100%',
                    paddingBottom: `${(1 / cropAspect) * 100}%`,
                    overflow: 'hidden'
                  }}>
                    <img
                      ref={imgRef}
                      src={screenshotUrl}
                      onLoad={handleImgLoad}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: `${(imgSize.w / crop.width) * 100}%`,
                        height: `${(imgSize.h / crop.height) * 100}%`,
                        marginLeft: `${-(crop.x / crop.width) * 100}%`,
                        marginTop: `${-(crop.y / crop.height) * 100}%`,
                        maxWidth: 'none',
                        maxHeight: 'none'
                      }}
                      alt={`Step ${step.index + 1} screenshot`}
                    />
                  </div>
                )
              })()
            ) : (
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
            )}
            {renderHighlightSvg()}
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
        {statusBadge()}
        {step.cropRect && (
          <button
            onClick={() => setShowFull((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b7280',
              fontSize: 11,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0
            }}
          >
            {showFull ? 'Show cropped' : 'Show full screenshot'}
          </button>
        )}
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
