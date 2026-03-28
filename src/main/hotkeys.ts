import { globalShortcut, screen, BrowserWindow } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'

let onStepMarker: ((cursor: { x: number; y: number }) => void) | null = null

function broadcastHotkeyStatus(registered: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('hotkey:status', { registered })
    }
  }
}

export function registerHotkeys(
  handler: (cursor: { x: number; y: number }) => void
): void {
  onStepMarker = handler
  const success = globalShortcut.register('CommandOrControl+Shift+S', () => {
    const point = screen.getCursorScreenPoint()
    console.log('[hotkeys] Ctrl+Shift+S — cursor at (%d, %d)', point.x, point.y)
    if (onStepMarker) onStepMarker(point)
  })
  if (success) {
    console.log('[hotkeys] Ctrl+Shift+S registered successfully')
  } else {
    console.error('[hotkeys] Ctrl+Shift+S registration FAILED — shortcut may be in use by another application')
  }
  broadcastHotkeyStatus(success)
}

export function unregisterHotkeys(): void {
  globalShortcut.unregister('CommandOrControl+Shift+S')
  onStepMarker = null
  console.log('[hotkeys] Ctrl+Shift+S unregistered')
}
