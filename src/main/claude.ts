import { join } from 'path'
import { readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import Anthropic from '@anthropic-ai/sdk'
import { IpcChannels } from '../shared/ipc-channels'
import type { Step, QAPair, Rect } from '../shared/types'
import * as stateBus from './state-bus'

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
}

// ── Constants ──

const MAX_ATTEMPTS = 3
const RETRY_BASE_MS = 1000
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

// ── Helpers ──

function getModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelayMs(attempt: number): number {
  return Math.round(RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * RETRY_BASE_MS)
}

function broadcastProgress(data: {
  type: 'batch'
  stepIndex: number
  total: number
  status: 'rewriting' | 'done' | 'error'
  message?: string
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.CLAUDE_PROGRESS, data)
    }
  }
}

// ── Screenshot annotation via FFmpeg drawbox ──

async function annotateScreenshot(
  screenshotPath: string,
  rect: Rect | null
): Promise<string> {
  const buffer = await readFile(screenshotPath)

  if (!rect) {
    return buffer.toString('base64')
  }

  const tempOutput = join(tmpdir(), `xovr-annotated-${uuidv4()}.jpg`)

  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg(screenshotPath)
      .outputOptions([
        '-vf',
        `drawbox=x=${Math.round(rect.x)}:y=${Math.round(rect.y)}:w=${Math.round(rect.width)}:h=${Math.round(rect.height)}:color=red:t=6`
      ])
      .toFormat('mjpeg')
      .on('error', (err) => reject(new Error(`FFmpeg annotation failed: ${err.message}`)))
      .on('end', () => resolve())

    cmd.save(tempOutput)
  })

  const annotatedBuffer = await readFile(tempOutput)
  await unlink(tempOutput).catch(() => {})
  return annotatedBuffer.toString('base64')
}

// ── Anthropic client ──

function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set')
  }
  return new Anthropic({ apiKey })
}

// ── Build context from previous steps ──

function buildPreviousStepsContext(allSteps: Step[], currentIndex: number): string {
  const start = Math.max(0, currentIndex - 3)
  const prevSteps = allSteps.slice(start, currentIndex)

  if (prevSteps.length === 0) return ''

  const lines = prevSteps.map((s, i) => {
    const text = s.editedText || s.rawTranscript
    return `Step ${start + i + 1}: ${text}`
  })

  return '\n\nPrevious steps for context:\n' + lines.join('\n')
}

// ── API Call 1: Generate Questions ──

const QUESTIONS_SYSTEM_PROMPT = `You are helping write procedural documentation for a technical process. The user will provide a screenshot (possibly annotated with a red rectangle highlighting the area of interest) and a raw transcript of what was spoken during this step.

Return only a JSON array of 0 to 4 concise clarifying questions. Ask questions only if they are necessary to resolve ambiguity or improve the quality of the instruction. If no clarification is needed, return an empty array [].

Examples of when to ask: unclear UI element references, ambiguous pronouns, missing context about what was clicked.
Examples of when NOT to ask: the transcript is clear and matches the screenshot, simple navigation steps.

Return ONLY the JSON array, no other text.`

export async function generateQuestions(
  step: Step,
  allSteps: Step[]
): Promise<string[]> {
  const model = getModel()
  const client = createClient()
  const prevContext = buildPreviousStepsContext(allSteps, step.index)

  const screenshotBase64 = await annotateScreenshot(step.screenshot, step.selectionRect)

  console.log(
    '[claude:questions] step=%d model=%s screenshot=%dKB',
    step.index, model, Math.round(screenshotBase64.length / 1024)
  )

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 512,
        system: QUESTIONS_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 }
              },
              {
                type: 'text',
                text: `Raw transcript: "${step.rawTranscript}"${prevContext}`
              }
            ]
          }
        ]
      })

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as Anthropic.TextBlock).text)
        .join('')

      console.log('[claude:questions] step=%d response=%s', step.index, text.slice(0, 200))

      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) {
        return parsed.map(String).slice(0, 4)
      }
      return []
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[claude:questions] step=%d attempt=%d/%d error=%s', step.index, attempt, MAX_ATTEMPTS, msg)

      if (attempt < MAX_ATTEMPTS) {
        await sleep(retryDelayMs(attempt - 1))
      } else {
        throw err
      }
    }
  }

  return []
}

// ── API Call 2: Rewrite Step ──

const REWRITE_SYSTEM_PROMPT = `You are writing procedural documentation for a technical process. The user will provide:
- A screenshot (possibly annotated with a red rectangle highlighting the area of interest)
- The raw transcript of what was spoken during this step
- Previous steps for context (if available)
- Answers to clarifying questions (if any were asked)

Write one clear procedural documentation step. Use imperative voice. Keep it concise. Reference visible UI elements from the screenshot when relevant.

Return only the final step text wrapped in <step_text> tags. Example:
<step_text>Click the "Save" button in the top-right corner of the toolbar to save your changes.</step_text>`

export async function rewriteStep(
  step: Step,
  allSteps: Step[],
  qaPairs: QAPair[]
): Promise<string> {
  const model = getModel()
  const client = createClient()
  const prevContext = buildPreviousStepsContext(allSteps, step.index)

  const screenshotBase64 = await annotateScreenshot(step.screenshot, step.selectionRect)

  let userText = `Raw transcript: "${step.rawTranscript}"${prevContext}`

  if (qaPairs.length > 0) {
    const qaText = qaPairs
      .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
      .join('\n\n')
    userText += '\n\nClarifying Q&A:\n' + qaText
  }

  console.log(
    '[claude:rewrite] step=%d model=%s qaPairs=%d',
    step.index, model, qaPairs.length
  )

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: REWRITE_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 }
              },
              {
                type: 'text',
                text: userText
              }
            ]
          }
        ]
      })

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as Anthropic.TextBlock).text)
        .join('')

      console.log('[claude:rewrite] step=%d response=%s', step.index, text.slice(0, 200))

      // Parse <step_text> tags
      const match = text.match(/<step_text>([\s\S]*?)<\/step_text>/)
      if (match) {
        return match[1].trim()
      }

      // Fallback: use the full text if no tags found
      console.warn('[claude:rewrite] step=%d no <step_text> tags found, using raw response', step.index)
      return text.trim()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[claude:rewrite] step=%d attempt=%d/%d error=%s', step.index, attempt, MAX_ATTEMPTS, msg)

      if (attempt < MAX_ATTEMPTS) {
        await sleep(retryDelayMs(attempt - 1))
      } else {
        throw err
      }
    }
  }

  throw new Error(`Step ${step.index}: rewrite failed after all attempts`)
}

// ── Batch Rewrite ──

const BATCH_REWRITE_SYSTEM_PROMPT = `You are writing procedural documentation for a technical process. The user will provide:
- A screenshot (possibly annotated with a red rectangle highlighting the area of interest)
- The raw transcript of what was spoken during this step
- Previous steps for context and tone consistency

Write one clear procedural documentation step. Use imperative voice. Keep it concise. Reference visible UI elements from the screenshot when relevant. Match the tone and formatting of any previously edited steps provided as context.

Return only the final step text wrapped in <step_text> tags.`

export async function batchRewriteAll(): Promise<void> {
  const state = stateBus.getState()
  const steps = state.steps
  const model = getModel()

  if (steps.length === 0) {
    console.log('[claude:batch] No steps to rewrite')
    return
  }

  console.log('[claude:batch] Starting batch rewrite: %d steps, model=%s', steps.length, model)

  // Find manually edited steps to infer style
  const editedSteps = steps.filter((s) => s.rewriteStatus === 'manually_edited')
  let styleHint = ''
  if (editedSteps.length > 0) {
    const examples = editedSteps.slice(0, 3).map((s) => s.editedText).join('\n---\n')
    styleHint = `\n\nThe user has manually edited some steps. Match this style and tone:\n${examples}`
  }

  const client = createClient()

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]

    // Skip manually edited steps — respect user's work
    if (step.rewriteStatus === 'manually_edited') {
      console.log('[claude:batch] step=%d skipped (manually_edited)', i)
      broadcastProgress({ type: 'batch', stepIndex: i, total: steps.length, status: 'done' })
      continue
    }

    broadcastProgress({ type: 'batch', stepIndex: i, total: steps.length, status: 'rewriting' })

    try {
      const screenshotBase64 = await annotateScreenshot(step.screenshot, step.selectionRect)
      const prevContext = buildPreviousStepsContext(
        stateBus.getState().steps, // Re-read to get latest edited text
        i
      )

      const userText = `Raw transcript: "${step.rawTranscript}"${prevContext}${styleHint}`

      let rewrittenText: string | null = null

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const response = await client.messages.create({
            model,
            max_tokens: 1024,
            system: BATCH_REWRITE_SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 }
                  },
                  { type: 'text', text: userText }
                ]
              }
            ]
          })

          const text = response.content
            .filter((b) => b.type === 'text')
            .map((b) => (b as Anthropic.TextBlock).text)
            .join('')

          const match = text.match(/<step_text>([\s\S]*?)<\/step_text>/)
          rewrittenText = match ? match[1].trim() : text.trim()
          break
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[claude:batch] step=%d attempt=%d/%d error=%s', i, attempt, MAX_ATTEMPTS, msg)

          if (attempt < MAX_ATTEMPTS) {
            await sleep(retryDelayMs(attempt - 1))
          }
        }
      }

      if (rewrittenText) {
        stateBus.updateStepRewrite(step.id, rewrittenText, 'batch')
        console.log('[claude:batch] step=%d rewritten: "%s"', i, rewrittenText.slice(0, 80))
        broadcastProgress({ type: 'batch', stepIndex: i, total: steps.length, status: 'done' })
      } else {
        console.error('[claude:batch] step=%d failed after all attempts', i)
        broadcastProgress({
          type: 'batch',
          stepIndex: i,
          total: steps.length,
          status: 'error',
          message: 'Rewrite failed after all attempts'
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[claude:batch] step=%d error=%s', i, msg)
      broadcastProgress({
        type: 'batch',
        stepIndex: i,
        total: steps.length,
        status: 'error',
        message: msg
      })
    }
  }

  console.log('[claude:batch] Batch rewrite complete')
}
