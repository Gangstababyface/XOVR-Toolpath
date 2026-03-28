import { useEffect, useState } from 'react'
import type { Step } from '../../shared/types'

interface DocumentPreviewProps {
  steps: Step[]
}

interface ImageState {
  url: string | null
  naturalWidth: number
  naturalHeight: number
}

function DocumentPreview({ steps }: DocumentPreviewProps): JSX.Element {
  const [images, setImages] = useState<Map<string, ImageState>>(new Map())

  // Load screenshots — track by step IDs to avoid re-cancelling on every steps ref change
  const stepIds = steps.map((s) => s.id).join(',')
  useEffect(() => {
    let cancelled = false
    const loadAll = async (): Promise<void> => {
      for (const step of steps) {
        if (!step.screenshot) continue
        if (images.has(step.id)) continue // already loaded
        try {
          const url = await window.api.screenshotLoad(step.screenshot)
          if (cancelled) return
          if (url) {
            const dims = await new Promise<{ w: number; h: number }>((resolve) => {
              const img = new Image()
              img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
              img.onerror = () => resolve({ w: 800, h: 600 })
              img.src = url
            })
            if (cancelled) return
            setImages((prev) => {
              const next = new Map(prev)
              next.set(step.id, { url, naturalWidth: dims.w, naturalHeight: dims.h })
              return next
            })
          }
        } catch { /* skip */ }
      }
    }
    loadAll()
    return () => { cancelled = true }
  }, [stepIds])

  return (
    <div style={{
      maxWidth: 900,
      margin: '0 auto',
      padding: '32px 24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#1f2937',
      lineHeight: 1.6
    }}>
      <h1 style={{ fontSize: 24, marginBottom: 16, borderBottom: '2px solid #e5e7eb', paddingBottom: 8 }}>
        XOVR Toolpath Documentation
      </h1>

      {/* Table of Contents */}
      <nav style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>Table of Contents</h3>
        <ol style={{ paddingLeft: 20 }}>
          {steps.map((s) => (
            <li key={s.id} style={{ marginBottom: 4, fontSize: 14 }}>
              <a href={`#preview-step-${s.index + 1}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                {s.title || `Step ${s.index + 1}`}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* Steps */}
      {steps.map((step) => {
        const imgState = images.get(step.id)
        const stepTitle = step.title || `Step ${step.index + 1}`

        return (
          <div key={step.id} id={`preview-step-${step.index + 1}`} style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 18, marginBottom: 12, color: '#374151' }}>{stepTitle}</h2>

            {imgState?.url && (() => {
              const crop = step.cropRect
              const viewW = crop ? crop.width : imgState.naturalWidth
              const viewH = crop ? crop.height : imgState.naturalHeight

              // Translate highlight to cropped coordinates
              const hlRect = step.selectionRect ? {
                x: step.selectionRect.x - (crop ? crop.x : 0),
                y: step.selectionRect.y - (crop ? crop.y : 0),
                width: step.selectionRect.width,
                height: step.selectionRect.height
              } : null

              return (
                <div style={{ position: 'relative', display: 'inline-block', marginBottom: 12, overflow: 'hidden', borderRadius: 4, border: '1px solid #e5e7eb' }}>
                  {crop ? (
                    <div style={{
                      position: 'relative',
                      width: '100%',
                      maxWidth: Math.min(viewW, 900),
                      paddingBottom: `${(viewH / viewW) * 100}%`,
                      overflow: 'hidden'
                    }}>
                      <img
                        src={imgState.url}
                        alt={stepTitle}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: `${(imgState.naturalWidth / crop.width) * 100}%`,
                          height: `${(imgState.naturalHeight / crop.height) * 100}%`,
                          marginLeft: `${-(crop.x / crop.width) * 100}%`,
                          marginTop: `${-(crop.y / crop.height) * 100}%`,
                          maxWidth: 'none',
                          maxHeight: 'none'
                        }}
                      />
                    </div>
                  ) : (
                    <img
                      src={imgState.url}
                      alt={stepTitle}
                      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
                    />
                  )}

                  {/* Highlight rect overlay (in cropped coordinate space) */}
                  {hlRect && (
                    <svg
                      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
                      width="100%" height="100%"
                      viewBox={`0 0 ${viewW} ${viewH}`}
                      preserveAspectRatio="xMinYMin meet"
                    >
                      <rect
                        x={hlRect.x} y={hlRect.y}
                        width={hlRect.width} height={hlRect.height}
                        fill="none" stroke="red"
                        strokeWidth={Math.max(3, Math.round(Math.max(viewW, viewH) / 400))}
                      />
                    </svg>
                  )}
                </div>
              )
            })()}

            <p style={{ fontSize: 15, whiteSpace: 'pre-wrap' }}>
              {step.editedText || step.rawTranscript || ''}
            </p>
          </div>
        )
      })}
    </div>
  )
}

export default DocumentPreview
