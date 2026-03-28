import { safeStorage } from 'electron'
import Store from 'electron-store'

const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

interface SettingsSchema {
  anthropicApiKey?: string   // stored encrypted via safeStorage
  openaiApiKey?: string      // stored encrypted via safeStorage
  anthropicModel?: string
  defaultExportFormat?: 'markdown' | 'html' | 'pdf'
  lastProjectPath?: string
  schemaVersion: number
}

// Lazy singleton — must not construct until after app.whenReady()
let store: Store | null = null

function getStore(): Store {
  if (!store) {
    store = new Store({ name: 'xovr-toolpath-settings' })
  }
  return store
}

function encryptValue(plaintext: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plaintext).toString('base64')
  }
  // Fallback: store as-is (still better than nothing on systems where
  // safeStorage is unavailable, e.g. some Linux desktops)
  return plaintext
}

function decryptValue(stored: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const buf = Buffer.from(stored, 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      // If decryption fails (e.g. data was stored unencrypted before
      // safeStorage became available), return as-is
      return stored
    }
  }
  return stored
}

export function getSettings(): SettingsSchema {
  const s = getStore()
  const raw: SettingsSchema = {
    schemaVersion: (s.get('schemaVersion') as number) ?? 1,
    anthropicModel: (s.get('anthropicModel') as string) || undefined,
    defaultExportFormat: (s.get('defaultExportFormat') as SettingsSchema['defaultExportFormat']) || undefined,
    lastProjectPath: (s.get('lastProjectPath') as string) || undefined
  }

  const encAnthropicKey = s.get('anthropicApiKey') as string | undefined
  if (encAnthropicKey) raw.anthropicApiKey = decryptValue(encAnthropicKey)

  const encOpenaiKey = s.get('openaiApiKey') as string | undefined
  if (encOpenaiKey) raw.openaiApiKey = decryptValue(encOpenaiKey)

  return raw
}

export function saveSettings(partial: Partial<SettingsSchema>): void {
  const s = getStore()

  if (partial.anthropicApiKey !== undefined) {
    s.set('anthropicApiKey', partial.anthropicApiKey ? encryptValue(partial.anthropicApiKey) : '')
  }
  if (partial.openaiApiKey !== undefined) {
    s.set('openaiApiKey', partial.openaiApiKey ? encryptValue(partial.openaiApiKey) : '')
  }
  if (partial.anthropicModel !== undefined) {
    s.set('anthropicModel', partial.anthropicModel)
  }
  if (partial.defaultExportFormat !== undefined) {
    s.set('defaultExportFormat', partial.defaultExportFormat)
  }
  if (partial.lastProjectPath !== undefined) {
    s.set('lastProjectPath', partial.lastProjectPath)
  }

  s.set('schemaVersion', 1)
}

export function getApiKey(service: 'anthropic' | 'openai'): string | undefined {
  // Environment variables take priority (for dev/CI)
  if (service === 'anthropic') {
    return process.env.ANTHROPIC_API_KEY || getSettings().anthropicApiKey
  }
  return process.env.OPENAI_API_KEY || getSettings().openaiApiKey
}

export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL || getSettings().anthropicModel || DEFAULT_MODEL
}
