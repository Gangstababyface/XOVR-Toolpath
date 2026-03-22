import { useEffect, useRef, useState, useCallback } from 'react'
import type { Rect } from '../../shared/types'

interface OverlayData {
  screenshotDataUrl: string
  cursorX: number
  cursorY: number
  imgWidth: number
  imgHeight: number
  displayScale: number
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

  // Fetch overlay data on mount
  useEffect(() => {
    window.api.overlayGetData().then((d) => {
      if (!d) return
      setData(d)
      // Default selection box centered on cursor position
      const w = DEFAULT_BOX_W
      const h = DEFAULT_BOX_H
      setRect({
        x: clamp(d.cursorX - w / 2, 0, window.innerWidth - w),
        y: clamp(d.cursorY - h / 2, 0, window.innerHeight - h),
        w,
        h
      })
      console.log('[overlay] Data loaded: %dx%d, cursor at (%d,%d)', d.imgWidth, d.imgHeight, d.cursorX, d.cursorY)
    })
  }, [])

  // Keyboard: Enter = confirm, Escape = skip
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
  }, [rect, data])

  // Convert overlay logical rect to screenshot pixel rect
  const toScreenshotRect = useCallback(
    (r: { x: number; y: number; w: number; h: number }): Rect | null => {
      if (!data) return null
      const vw = window.innerWidth
      const vh = window.innerHeight
      return {
        x: Math.round((r.x / vw) * data.imgWidth),
        y: Math.round((r.y / vh) * data.imgHeight),
        width: Math.round((r.w / vw) * data.imgWidth),
        height: Math.round((r.h / vh) * data.imgHeight),
        displayScale: data.displayScale
      }
    },
    [data]
  )

  function confirmSelection(): void {
    if (!rect || !data) {
      skipSelection()
      return
    }
    const screenshotRect = toScreenshotRect(rect)
    console.log('[overlay] Confirmed rect:', JSON.stringify(screenshotRect))
    window.api.overlayResult({ rect: screenshotRect })
  }

  function skipSelection(): void {
    console.log('[overlay] Skipped')
    window.api.overlayResult({ rect: null })
  }

  // ── Mouse drawing handlers ──

  function handleMouseDown(e: React.MouseEvent): void {
    // Only start drawing on the background, not on the existing rect
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
    // If the drawn rect is too small, revert to default
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
        cursor: drawing ? 'crosshair' : 'crosshair',
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
      {/* Top */}
      <div style={{ ...dimStyle, top: 0, left: 0, right: 0, height: r.y }} />
      {/* Bottom */}
      <div
        style={{ ...dimStyle, top: r.y + r.h, left: 0, right: 0, bottom: 0 }}
      />
      {/* Left */}
      <div
        style={{
          ...dimStyle,
          top: r.y,
          left: 0,
          width: r.x,
          height: r.h
        }}
      />
      {/* Right */}
      <div
        style={{
          ...dimStyle,
          top: r.y,
          left: r.x + r.w,
          right: 0,
          height: r.h
        }}
      />

      {/* Selection border */}
      {rect && rect.w > 0 && rect.h > 0 && (
        <div
          style={{
            position: 'absolute',
            top: r.y,
            left: r.x,
            width: r.w,
            height: r.h,
            border: '2px solid #ef4444',
            boxSizing: 'border-box',
            pointerEvents: 'none'
          }}
        />
      )}

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
        Draw selection or use default &middot; Enter = confirm &middot; Esc =
        skip
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
