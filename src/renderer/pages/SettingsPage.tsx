import { useState, useEffect, useCallback, CSSProperties } from 'react'
import { useRecordingStore } from '../stores/recordingStore'

interface SettingsData {
  anthropicApiKey?: string
  openaiApiKey?: string
  anthropicModel?: string
  defaultExportFormat?: 'markdown' | 'html' | 'pdf'
}

function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<SettingsData>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    window.api.settingsGet().then((data) => {
      setSettings(data as SettingsData)
    })
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    try {
      await window.api.settingsSave(settings)
      setMessage({ type: 'success', text: 'Settings saved.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }, [settings])

  const goBack = useCallback(() => {
    useRecordingStore.setState({ view: 'home' })
  }, [])

  const update = (key: keyof SettingsData, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setMessage(null)
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <button onClick={goBack} style={backBtnStyle}>&larr; Back</button>
        <h2 style={{ margin: 0, fontSize: 18 }}>Settings</h2>
      </div>

      <div style={formStyle}>
        <label style={labelStyle}>
          Anthropic API Key
          <input
            type="password"
            value={settings.anthropicApiKey || ''}
            onChange={(e) => update('anthropicApiKey', e.target.value)}
            placeholder="sk-ant-..."
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          OpenAI API Key
          <input
            type="password"
            value={settings.openaiApiKey || ''}
            onChange={(e) => update('openaiApiKey', e.target.value)}
            placeholder="sk-..."
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          Anthropic Model
          <input
            type="text"
            value={settings.anthropicModel || ''}
            onChange={(e) => update('anthropicModel', e.target.value)}
            placeholder="claude-sonnet-4-20250514"
            style={inputStyle}
          />
          <span style={hintStyle}>Leave blank for default</span>
        </label>

        <label style={labelStyle}>
          Default Export Format
          <select
            value={settings.defaultExportFormat || 'html'}
            onChange={(e) => update('defaultExportFormat', e.target.value)}
            style={inputStyle}
          >
            <option value="markdown">Markdown</option>
            <option value="html">HTML</option>
            <option value="pdf">PDF</option>
          </select>
        </label>

        {message && (
          <div style={{
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 13,
            backgroundColor: message.type === 'success' ? '#f0fdf4' : '#fef2f2',
            color: message.type === 'success' ? '#166534' : '#991b1b',
            border: `1px solid ${message.type === 'success' ? '#86efac' : '#fca5a5'}`
          }}>
            {message.text}
          </div>
        )}

        <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

const containerStyle: CSSProperties = {
  padding: 32,
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 480
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 24
}

const backBtnStyle: CSSProperties = {
  padding: '4px 12px',
  fontSize: 14,
  backgroundColor: '#f3f4f6',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  cursor: 'pointer'
}

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 14,
  fontWeight: 500,
  color: '#374151'
}

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  fontSize: 14,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontFamily: 'system-ui, sans-serif',
  fontWeight: 400
}

const hintStyle: CSSProperties = {
  fontSize: 12,
  color: '#9ca3af',
  fontWeight: 400
}

const saveBtnStyle: CSSProperties = {
  marginTop: 8,
  padding: '10px 20px',
  fontSize: 14,
  backgroundColor: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  alignSelf: 'flex-start'
}

export default SettingsPage
