import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { ClaudeMemory } from '../shared/types'

const MEMORY_FILENAME = 'claude_memory.json'

function createEmptyMemory(): ClaudeMemory {
  return {
    projectContext: '',
    softwareBeingDocumented: '',
    targetAudience: '',
    previousDecisions: [],
    terminologyPreferences: {},
    styleNotes: [],
    lastUpdated: new Date().toISOString()
  }
}

export function loadClaudeMemory(projectDir: string): ClaudeMemory | null {
  const filePath = join(projectDir, MEMORY_FILENAME)
  if (!existsSync(filePath)) return null

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const memory: ClaudeMemory = JSON.parse(raw)
    console.log('[claude-memory] Loaded from %s', filePath)
    return memory
  } catch (err) {
    console.error('[claude-memory] Failed to load %s:', filePath, err)
    return null
  }
}

export function saveClaudeMemory(projectDir: string, memory: ClaudeMemory): void {
  const filePath = join(projectDir, MEMORY_FILENAME)
  memory.lastUpdated = new Date().toISOString()

  try {
    writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf-8')
    console.log('[claude-memory] Saved to %s', filePath)
  } catch (err) {
    console.error('[claude-memory] Failed to save %s:', filePath, err)
  }
}

export { createEmptyMemory }
