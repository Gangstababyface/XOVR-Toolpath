import { useEffect, useRef, useState, useCallback } from 'react'
import type { Rect } from '../../shared/types'

interface OverlayData {
  screenshotDataUrl: string
  cursorX: number
  cursorY: number
  imgWidth: number
  imgHeight: number
  displayScale: number
  mode?: 'crop' | 'highlight'
}

const DEFAULT_BOX_W = 200
const DEFAULT_BOX_H = 150

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

function SelectionOverlay(): JSX.Element {
  const [data, setData] = useState<OverlayData | null>(null)

  // Selection rect in overlay logical pixels (relative to viewport)
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [drawing, setDrawing] = useState(false)
  const drawStartRef = useRef<{ x: number; y: number } | null>(null)
  const rectRef = useRef(rect)
  const dataRef = useRef(data)
  rectRef.current = rect
  dataRef.current = data

  const mode = data?.mode || 'highlight'
  const isCrop = mode === 'crop'

  // Colors and labels per mode
  const borderColor = isCrop ? '#06b6d4' : '#ef4444' // cyan for crop, red for highlight
  const labelText = isCrop
    ? 'Select area to show \u00b7 Enter = confirm \u00b7 Esc = skip (use full screenshot)'
    : 'Highlight click target \u00b7 Enter = confirm \u00b7 Esc = skip (no highlight)'

  // Fetch overlay data on mount
  useEffect(() => {
    console.log('[overlay] Component mounted, fetching data...')
    window.api.overlayGetData().then((d) => {
      console.log('[overlay] overlayGetData returned:', d ? `mode=${d.mode} img=${d.imgWidth}x${d.imgHeight} dataUrl=${d.screenshotDataUrl?.slice(0, 50)}...` : 'null')
      if (!d) return
      setData(d)
      const w = DEFAULT_BOX_W
      const h = DEFAULT_BOX_H
      setRect({
        x: clamp(d.cursorX - w / 2, 0, window.innerWidth - w),
        y: clamp(d.cursorY - h / 2, 0, window.innerHeight - h),
        w,
        h
      })
    })
  }, [])

  function toScreenshotRect(r: { x: number; y: number; w: number; h: number }, d: OverlayData): Rect {
    const vw = window.innerWidth
    const vh = window.innerHeight
    return {
      x: Math.round((r.x / vw) * d.imgWidth),
      y: Math.round((r.y / vh) * d.imgHeight),
      width: Math.round((r.w / vw) * d.imgWidth),
      height: Math.round((r.h / vh) * d.imgHeight),
      displayScale: d.displayScale
    }
  }

  function confirmSelection(): void {
    const r = rectRef.current
    const d = dataRef.current
    if (!r || !d) {
      skipSelection()
      return
    }
    const screenshotRect = toScreenshotRect(r, d)
    console.log('[overlay] Confirmed rect (mode=%s):', d.mode || 'highlight', JSON.stringify(screenshotRect))
    window.api.overlayResult({ rect: screenshotRect }).then(() => window.close())
  }

  function skipSelection(): void {
    console.log('[overlay] Skipped (mode=%s)', dataRef.current?.mode || 'highlight')
    window.api.overlayResult({ rect: null }).then(() => window.close())
  }

  // Keyboard: Enter = confirm, Escape = skip — single listener, reads from refs
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Enter') {
        e.preventDefault()
        confirmSelection()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        skipSelection()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // ── Mouse drawing handlers ──

  function handleMouseDown(e: React.MouseEvent): void {
    if ((e.target as HTMLElement).dataset.role === 'handle') return
    e.preventDefault()
    setDrawing(true)
    drawStartRef.current = { x: e.clientX, y: e.clientY }
  }

  function handleMouseMove(e: React.MouseEvent): void {
    if (!drawing || !drawStartRef.current) return
    const sx = drawStartRef.current.x
    const sy = drawStartRef.current.y
    const cx = e.clientX
    const cy = e.clientY
    setRect({
      x: Math.min(sx, cx),
      y: Math.min(sy, cy),
      w: Math.abs(cx - sx),
      h: Math.abs(cy - sy)
    })
  }

  function handleMouseUp(): void {
    if (!drawing) return
    setDrawing(false)
    drawStartRef.current = null
    if (rect && rect.w < 10 && rect.h < 10) {
      if (data) {
        setRect({
          x: clamp(data.cursorX - DEFAULT_BOX_W / 2, 0, window.innerWidth - DEFAULT_BOX_W),
          y: clamp(data.cursorY - DEFAULT_BOX_H / 2, 0, window.innerHeight - DEFAULT_BOX_H),
          w: DEFAULT_BOX_W,
          h: DEFAULT_BOX_H
        })
      }
    }
  }

  if (!data) {
    return <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000' }} />
  }

  const r = rect || { x: 0, y: 0, w: 0, h: 0 }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'crosshair',
        userSelect: 'none'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Screenshot background */}
      <img
        src={data.screenshotDataUrl}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          pointerEvents: 'none'
        }}
      />

      {/* Dim overlay — four rects around the selection */}
      <div style={{ ...dimStyle, top: 0, left: 0, right: 0, height: r.y }} />
      <div style={{ ...dimStyle, top: r.y + r.h, left: 0, right: 0, bottom: 0 }} />
      <div style={{ ...dimStyle, top: r.y, left: 0, width: r.x, height: r.h }} />
      <div style={{ ...dimStyle, top: r.y, left: r.x + r.w, right: 0, height: r.h }} />

      {/* Selection border — color depends on mode */}
      {rect && rect.w > 0 && rect.h > 0 && (
        <div
          style={{
            position: 'absolute',
            top: r.y,
            left: r.x,
            width: r.w,
            height: r.h,
            border: `2px solid ${borderColor}`,
            boxSizing: 'border-box',
            pointerEvents: 'none'
          }}
        />
      )}

      {/* Mode label (top-center) */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: isCrop ? 'rgba(6, 182, 212, 0.85)' : 'rgba(239, 68, 68, 0.85)',
          color: '#fff',
          padding: '6px 18px',
          borderRadius: 6,
          fontSize: 15,
          fontWeight: 600,
          fontFamily: 'system-ui, sans-serif',
          pointerEvents: 'none',
          whiteSpace: 'nowrap'
        }}
      >
        {isCrop ? 'Step 1: Select area to show' : 'Step 2: Highlight click target'}
      </div>

      {/* Instructions */}
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(0,0,0,0.75)',
          color: '#fff',
          padding: '8px 20px',
          borderRadius: 6,
          fontSize: 14,
          fontFamily: 'system-ui, sans-serif',
          pointerEvents: 'none',
          whiteSpace: 'nowrap'
        }}
      >
        {labelText}
      </div>
    </div>
  )
}

const dimStyle: React.CSSProperties = {
  position: 'absolute',
  backgroundColor: 'rgba(0, 0, 0, 0.45)',
  pointerEvents: 'none'
}

export default SelectionOverlay
