import { BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'
import { join } from 'path'
import { IpcChannels } from '../shared/ipc-channels'

const MOUSE_BUTTON_LEFT = 1
const DEFAULT_DEBOUNCE_MS = 300

let worker: Worker | null = null
let active = false
let lastCaptureTime = 0
let onClickCallback: ((cursor: { x: number; y: number }) => void) | null = null

function isPointInsideAppWindow(x: number, y: number): boolean {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || !win.isVisible()) continue
    const bounds = win.getBounds()
    if (
      x >= bounds.x &&
      x < bounds.x + bounds.width &&
      y >= bounds.y &&
      y < bounds.y + bounds.height
    ) {
      return true
    }
  }
  return false
}

function handleMouseUp(button: number, x: number, y: number): void {
  if (!active || !onClickCallback) return

  // Left-click only
  if (button !== MOUSE_BUTTON_LEFT) return

  // Debounce
  const now = Date.now()
  if (now - lastCaptureTime < DEFAULT_DEBOUNCE_MS) return

  // Ignore clicks on app's own windows
  if (isPointInsideAppWindow(x, y)) return

  lastCaptureTime = now
  console.log('[mouse-hook] Click at (%d, %d)', x, y)
  onClickCallback({ x, y })
}

export function startMouseHook(
  onClick: (cursor: { x: number; y: number }) => void
): void {
  if (active) return

  onClickCallback = onClick
  active = true
  lastCaptureTime = 0

  const workerPath = join(__dirname, 'mouse-hook-worker.js')
  worker = new Worker(workerPath)

  worker.on('message', (msg) => {
    if (msg.type === 'mouseup') {
      handleMouseUp(msg.button, msg.x, msg.y)
    }
  })

  worker.on('error', (err) => {
    console.error('[mouse-hook] Worker error:', err)
    broadcastStatus({ active: false, error: err.message })
  })

  worker.on('exit', (code) => {
    console.log('[mouse-hook] Worker exited with code %d', code)
    worker = null
  })

  console.log('[mouse-hook] Started (worker thread)')
  broadcastStatus({ active: true })
}

export function stopMouseHook(): void {
  if (!active) return

  active = false
  onClickCallback = null

  if (worker) {
    worker.postMessage('stop')
    // Give it a moment to clean up, then terminate if needed
    const w = worker
    setTimeout(() => {
      try { w.terminate() } catch { /* already exited */ }
    }, 1000)
    worker = null
  }

  console.log('[mouse-hook] Stopped')
  broadcastStatus({ active: false })
}

function broadcastStatus(data: { active: boolean; error?: string }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.MOUSE_HOOK_STATUS, data)
    }
  }
}
