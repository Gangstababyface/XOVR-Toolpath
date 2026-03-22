// Electron apps launched from VS Code or other Electron-based editors inherit
// ELECTRON_RUN_AS_NODE=1, which forces Electron to run as plain Node.js and
// disables all built-in Electron APIs (app, BrowserWindow, etc.).
// This wrapper clears that variable before handing off to electron-vite.

delete process.env.ELECTRON_RUN_AS_NODE

const { spawn } = require('child_process')
const args = process.argv.slice(2)

spawn('npx', ['electron-vite', ...args], {
  stdio: 'inherit',
  shell: true,
  env: process.env
}).on('exit', (code) => process.exit(code ?? 0))
