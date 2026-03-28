import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import type { AutosaveSnapshot } from '../shared/types'
import * as stateBus from './state-bus'

const AUTOSAVE_INTERVAL_MS = 30_000
const AUTOSAVE_DIR = join(tmpdir(), 'xovr-toolpath')
const AUTOSAVE_PATH = join(AUTOSAVE_DIR, 'backup.xtoolpath')

let timer: ReturnType<typeof setInterval> | null = null
let unsubStateChange: (() => void) | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// ── Dirty tracking ──

let isDirty = false

export function markClean(): void {
  isDirty = false
}

export function getIsDirty(): boolean {
  return isDirty
}

// ── Core autosave ──

export function triggerAutosave(): void {
  const state = stateBus.getState()
  // Only save if there's something worth saving
  if (state.steps.length === 0) return

  const snapshot: AutosaveSnapshot = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    session: state
  }

  try {
    mkdirSync(AUTOSAVE_DIR, { recursive: true })
    writeFileSync(AUTOSAVE_PATH, JSON.stringify(snapshot), 'utf-8')
    console.log('[autosave] Snapshot written: %d steps', state.steps.length)
  } catch (err) {
    console.error('[autosave] Failed to write snapshot:', err)
  }
}

export function checkForRecoverableAutosave(): AutosaveSnapshot | null {
  try {
    if (!existsSync(AUTOSAVE_PATH)) return null
    const raw = readFileSync(AUTOSAVE_PATH, 'utf-8')
    const snapshot: AutosaveSnapshot = JSON.parse(raw)
    if (snapshot.schemaVersion !== 1 || !snapshot.session?.steps?.length) return null
    return snapshot
  } catch {
    return null
  }
}

export function discardAutosave(): void {
  try {
    if (existsSync(AUTOSAVE_PATH)) {
      unlinkSync(AUTOSAVE_PATH)
      console.log('[autosave] Backup discarded')
    }
  } catch (err) {
    console.error('[autosave] Failed to discard backup:', err)
  }
}

// ── Timer lifecycle ──

export function startAutosaveTimer(): void {
  stopAutosaveTimer()

  // Periodic save
  timer = setInterval(triggerAutosave, AUTOSAVE_INTERVAL_MS)

  // Save on state changes (debounced to avoid rapid writes)
  unsubStateChange = stateBus.onStateChange(() => {
    isDirty = true
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(triggerAutosave, 5000)
  })

  console.log('[autosave] Timer started (interval=%ds)', AUTOSAVE_INTERVAL_MS / 1000)
}

export function stopAutosaveTimer(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (unsubStateChange) {
    unsubStateChange()
    unsubStateChange = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}
