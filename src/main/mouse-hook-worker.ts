// This worker thread runs uIOhook.start() which blocks.
// Mouse events are sent back to the main thread via parentPort.
import { parentPort } from 'worker_threads'
import { uIOhook } from 'uiohook-napi'

uIOhook.on('mouseup', (event) => {
  parentPort?.postMessage({
    type: 'mouseup',
    button: event.button,
    x: event.x,
    y: event.y
  })
})

parentPort?.on('message', (msg) => {
  if (msg === 'stop') {
    uIOhook.stop()
    process.exit(0)
  }
})

// This call blocks until uIOhook.stop() is called
uIOhook.start()
