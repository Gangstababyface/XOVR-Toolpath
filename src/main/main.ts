import 'dotenv/config'
import { app, BrowserWindow, dialog, session, desktopCapturer } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import * as stateBus from './state-bus'
import { startAutosaveTimer, stopAutosaveTimer, triggerAutosave, getIsDirty, markClean } from './autosave'

let mainWindow: BrowserWindow | null = null

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'XOVR Toolpath',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Forward renderer console messages to the terminal for debugging
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    const tag = ['verbose', 'info', 'warn', 'error'][level] || 'log'
    console.log(`[renderer:${tag}] ${message}`)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('close', (event) => {
    if (getIsDirty()) {
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Do you want to save before closing?'
      })
      if (choice === 0) {
        // Save — trigger synchronous autosave then close
        triggerAutosave()
        markClean()
      } else if (choice === 2) {
        // Cancel
        event.preventDefault()
        return
      }
      // choice === 1 — Don't Save — just close
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function setupDisplayMediaHandler(): void {
  console.log('[main] Setting up setDisplayMediaRequestHandler')
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    console.log('[main:displayMediaHandler] Handler invoked')
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      console.log('[main:displayMediaHandler] desktopCapturer returned %d source(s)', sources.length)
      if (sources.length > 0) {
        console.log('[main:displayMediaHandler] Providing source: id=%s name="%s"', sources[0].id, sources[0].name)
        stateBus.setSelectedSource(sources[0].id)
        callback({ video: sources[0] })
        return
      }
      console.warn('[main:displayMediaHandler] No screen sources found — denying request')
    } catch (err) {
      console.error('[main:displayMediaHandler] desktopCapturer.getSources failed:', err)
    }
    // Always call the callback so getDisplayMedia rejects cleanly
    // instead of hanging indefinitely
    // @ts-expect-error Electron accepts empty call to deny the request
    callback()
  })
  console.log('[main] setDisplayMediaRequestHandler registered')
}

app.whenReady().then(() => {
  setupDisplayMediaHandler()
  registerIpcHandlers()
  createMainWindow()
  startAutosaveTimer()
  console.log('[main] App ready, main window created')
})

app.on('window-all-closed', () => {
  stopAutosaveTimer()
  app.quit()
})

export { mainWindow }
