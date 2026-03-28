export interface Rect {
  x: number
  y: number
  width: number
  height: number
  displayScale?: number
}

export interface QAPair {
  question: string
  answer: string
}

export interface Step {
  id: string
  index: number
  timestamp: number
  screenshot: string
  cropRect: Rect | null
  selectionRect: Rect | null
  rawTranscript: string
  editedText: string
  claudeQuestions: QAPair[]
  rewriteStatus: 'raw' | 'ai_rewritten' | 'manually_edited'
  rewriteSource: 'none' | 'batch' | 'interactive'
  title: string
  titleManuallyEdited: boolean
}

export interface RecordingSessionState {
  isRecording: boolean
  isPaused: boolean
  sessionStartTime: number | null
  pauseStartedAt: number | null
  totalPausedDuration: number
  activeCaptureQueue: number
  selectedSourceId: string | null
  steps: Step[]
  audioFilePath: string | null
  videoFilePath: string | null
  sessionDir: string | null
}

export interface ProjectFile {
  schemaVersion: number
  title: string
  createdAt: string
  updatedAt: string
  steps: Step[]
  assetBasePath: string
}

export interface AutosaveSnapshot {
  schemaVersion: number
  savedAt: string
  session: RecordingSessionState
}

export interface ClaudeMemory {
  projectContext: string
  softwareBeingDocumented: string
  targetAudience: string
  previousDecisions: Array<{ question: string; answer: string }>
  terminologyPreferences: Record<string, string>
  styleNotes: string[]
  lastUpdated: string
}

export interface DocumentReviewQuestion {
  id: string
  question: string
  context: string
}

export interface DocumentReviewResult {
  documentTitle: string
  documentSummary: string
  steps: Array<{
    index: number
    suggestedTitle: string | null
    rewrittenDescription: string
  }>
}

export interface TranscriptionProgress {
  stepIndex: number
  total: number
  status: 'extracting' | 'transcribing' | 'done' | 'error'
  message?: string
}
