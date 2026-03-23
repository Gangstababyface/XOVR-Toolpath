import { join, basename } from 'path'
import { existsSync, statSync, unlinkSync } from 'fs'
import { readFile } from 'fs/promises'
import { BrowserWindow, dialog } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpeg from 'fluent-ffmpeg'
import OpenAI from 'openai'
import { v4 as uuidv4 } from 'uuid'
import { IpcChannels } from '../shared/ipc-channels'
import type { Step } from '../shared/types'
import * as stateBus from './state-bus'

// ── FFmpeg / FFprobe paths ──

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
  console.log('[transcription] ffmpeg path: %s', ffmpegStatic)
} else {
  console.error('[transcription] ffmpeg-static did not provide a binary path')
}

ffmpeg.setFfprobePath(ffprobeInstaller.path)
console.log('[transcription] ffprobe path: %s', ffprobeInstaller.path)

// ── Constants ──

const SEGMENT_PADDING_MS = 500
const TRAILING_NARRATION_THRESHOLD_MS = 2000
const MIN_SEGMENT_DURATION_MS = 300
const WHISPER_TIMEOUT_MS = 120_000
const MAX_TRANSCRIPTION_ATTEMPTS = 3
const RETRY_BASE_MS = 1000

// ── Progress broadcast ──

interface TranscriptionProgress {
  stepIndex: number
  total: number
  status: 'extracting' | 'transcribing' | 'done' | 'error'
  message?: string
}

function broadcastProgress(progress: TranscriptionProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.TRANSCRIBE_PROGRESS, progress)
    }
  }
}

// ── Error classification ──

function classifyError(err: unknown): 'retryable' | 'permanent' {
  const errObj = err as Record<string, unknown>
  const status = typeof errObj?.status === 'number' ? errObj.status : undefined
  const code = typeof errObj?.code === 'string' ? errObj.code : undefined
  const name = typeof errObj?.name === 'string' ? errObj.name : undefined

  // Permanent: auth, bad request, forbidden, not found
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return 'permanent'
  }

  // Permanent: 429 with insufficient_quota is a billing issue, not a rate limit
  if (status === 429) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('insufficient_quota')) {
      return 'permanent'
    }
    return 'retryable'
  }

  // Retryable: server errors
  if (status !== undefined && status >= 500) return 'retryable'

  // Retryable: SDK connection/timeout errors
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') {
    return 'retryable'
  }

  // Retryable: transport-layer error codes
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' ||
      code === 'EPIPE' || code === 'EAI_AGAIN' || code === 'UND_ERR_SOCKET') {
    return 'retryable'
  }

  // Check cause for transport errors
  const cause = errObj?.cause as Record<string, unknown> | undefined
  if (cause) {
    const causeCode = typeof cause.code === 'string' ? cause.code : undefined
    if (causeCode === 'ECONNRESET' || causeCode === 'ETIMEDOUT' || causeCode === 'ECONNREFUSED' ||
        causeCode === 'EPIPE' || causeCode === 'EAI_AGAIN' || causeCode === 'UND_ERR_SOCKET') {
      return 'retryable'
    }
  }

  // Retryable: generic fetch/network errors without a clear permanent status
  if (name === 'TypeError') {
    return 'retryable'
  }

  // Default: treat unknown errors as retryable to avoid losing work
  return 'retryable'
}

function logErrorDetails(prefix: string, err: unknown, attempt: number, elapsedMs: number): void {
  const errObj = err as Record<string, unknown>
  const msg = err instanceof Error ? err.message : String(err)
  const classification = classifyError(err)

  console.error(
    '%s FAILED (attempt %d/%d, elapsed %dms, classification: %s)',
    prefix, attempt, MAX_TRANSCRIPTION_ATTEMPTS, elapsedMs, classification
  )
  console.error('%s   message: %s', prefix, msg)
  console.error('%s   error.name: %s', prefix, String(errObj?.name ?? 'N/A'))
  console.error('%s   error.status: %s', prefix, String(errObj?.status ?? 'N/A'))
  console.error('%s   error.code: %s', prefix, String(errObj?.code ?? 'N/A'))
  console.error('%s   error.type: %s', prefix, String(errObj?.type ?? 'N/A'))

  if (errObj?.cause) {
    const cause = errObj.cause as Record<string, unknown>
    console.error('%s   error.cause.name: %s', prefix, String(cause?.name ?? 'N/A'))
    console.error('%s   error.cause.message: %s', prefix, String(cause?.message ?? 'N/A'))
    console.error('%s   error.cause.code: %s', prefix, String(cause?.code ?? 'N/A'))
  } else {
    console.error('%s   error.cause: (none)', prefix)
  }

  try {
    const serialized = JSON.stringify(err, Object.getOwnPropertyNames(err as object))
    console.error('%s   SERIALIZED: %s', prefix, serialized)
  } catch {
    console.error('%s   SERIALIZED: (could not serialize)', prefix)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelayMs(attempt: number): number {
  const exponential = RETRY_BASE_MS * Math.pow(2, attempt)
  const jitter = Math.random() * RETRY_BASE_MS
  return Math.round(exponential + jitter)
}

// ── FFmpeg helpers ──

/**
 * Probe audio duration. Chrome-recorded WebM files have no duration in their
 * container header (format.duration returns "N/A"). When that happens, remux
 * to a temp MKV with codec copy (nearly instant) which forces FFmpeg to write
 * the real duration, then probe the MKV.
 */
function getAudioDurationMs(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) {
        reject(new Error(`ffprobe failed: ${err.message}`))
        return
      }

      const rawDuration = metadata.format.duration
      console.log('[transcription] ffprobe format.duration: %s (typeof %s)', rawDuration, typeof rawDuration)

      const durationSec = typeof rawDuration === 'string'
        ? parseFloat(rawDuration)
        : Number(rawDuration)

      if (Number.isFinite(durationSec) && durationSec > 0) {
        const durationMs = Math.round(durationSec * 1000)
        console.log('[transcription] Audio duration: %d ms', durationMs)
        resolve(durationMs)
        return
      }

      console.log('[transcription] Duration unavailable from WebM header, remuxing to MKV to compute...')
      const tempMkv = audioPath + '.duration-probe.mkv'

      ffmpeg(audioPath)
        .audioCodec('copy')
        .toFormat('matroska')
        .on('error', (remuxErr) => {
          reject(new Error(`Remux for duration probe failed: ${remuxErr.message}`))
        })
        .on('end', () => {
          ffmpeg.ffprobe(tempMkv, (probeErr, mkvMeta) => {
            try { unlinkSync(tempMkv) } catch { /* ignore */ }

            if (probeErr) {
              reject(new Error(`ffprobe of remuxed MKV failed: ${probeErr.message}`))
              return
            }

            const mkvRaw = mkvMeta.format.duration
            console.log('[transcription] MKV format.duration: %s (typeof %s)', mkvRaw, typeof mkvRaw)

            const mkvDurationSec = typeof mkvRaw === 'string'
              ? parseFloat(mkvRaw)
              : Number(mkvRaw)

            if (!Number.isFinite(mkvDurationSec) || mkvDurationSec <= 0) {
              reject(new Error(
                `Could not determine audio duration: webm=${JSON.stringify(rawDuration)} mkv=${JSON.stringify(mkvRaw)}`
              ))
              return
            }

            const durationMs = Math.round(mkvDurationSec * 1000)
            console.log('[transcription] Audio duration (from MKV remux): %d ms', durationMs)
            resolve(durationMs)
          })
        })
        .save(tempMkv)
    })
  })
}

function extractAudioSegment(
  audioPath: string,
  startMs: number,
  endMs: number,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startSec = startMs / 1000
    const durationSec = (endMs - startMs) / 1000

    if (durationSec <= 0) {
      reject(new Error(`Invalid segment duration: ${durationSec}s (start=${startMs}ms end=${endMs}ms)`))
      return
    }

    ffmpeg(audioPath)
      .seekInput(startSec)
      .duration(durationSec)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .toFormat('wav')
      .on('error', (err) => {
        reject(new Error(`FFmpeg extraction failed: ${err.message}`))
      })
      .on('end', () => {
        resolve()
      })
      .save(outputPath)
  })
}

// ── OpenAI client factory ──

function createOpenAIClient(apiKey: string): OpenAI {
  // Pass globalThis.fetch directly — no wrapper.
  // Wrapping fetch (even to inject duplex:'half') causes undici to disturb/lock
  // the body stream when the SDK builds a multipart Request internally.
  // The SDK handles duplex:'half' on its own for streaming uploads.
  if (typeof globalThis.fetch === 'function') {
    console.log('[transcription:client] OpenAI client initialized (fetch: globalThis.fetch, no wrapper)')
    return new OpenAI({
      apiKey,
      timeout: WHISPER_TIMEOUT_MS,
      fetch: globalThis.fetch.bind(globalThis)
    })
  }
  console.log('[transcription:client] OpenAI client initialized (fetch: default)')
  return new OpenAI({ apiKey, timeout: WHISPER_TIMEOUT_MS })
}

// ── Preflight connectivity check ──

async function preflightCheck(apiKey: string): Promise<boolean> {
  console.log('[transcription:preflight] Starting connectivity check...')
  console.log('[transcription:preflight] key_present=%s key_prefix=%s',
    Boolean(apiKey),
    apiKey.slice(0, 7) + '...'
  )

  const client = createOpenAIClient(apiKey)
  const startTime = Date.now()

  try {
    await client.models.list()
    const elapsedMs = Date.now() - startTime
    console.log('[transcription:preflight] SUCCESS (elapsed %dms) — OpenAI API is reachable', elapsedMs)
    console.log('[transcription:preflight] Note: preflight checks connectivity only, not billing/quota status')
    return true
  } catch (err) {
    const elapsedMs = Date.now() - startTime
    logErrorDetails('[transcription:preflight]', err, 1, elapsedMs)

    const classification = classifyError(err)
    if (classification === 'permanent') {
      console.error('[transcription:preflight] Permanent error — check API key and permissions')
    } else {
      console.error('[transcription:preflight] Transport/connection error — network may be blocked or unstable')
    }
    return false
  }
}

// ── Single transcription attempt (direct fetch — bypasses OpenAI SDK) ──
// The SDK internally builds a multipart streaming body but does NOT set
// `duplex: 'half'` on the RequestInit. Electron's Chromium-based fetch
// (undici) requires it, so every SDK upload fails with:
//   "TypeError: RequestInit: duplex option is required when sending a body."
// A direct fetch with `duplex: 'half'` sidesteps the problem entirely.

async function attemptTranscription(
  apiKey: string,
  buffer: Buffer,
  filename: string,
  model: string,
  stepIndex: number,
  attempt: number
): Promise<string> {
  console.log(
    '[transcription:whisper] PRE-REQUEST: step=%d attempt=%d/%d model=%s size=%dKB',
    stepIndex, attempt, MAX_TRANSCRIPTION_ATTEMPTS, model,
    Math.round(buffer.length / 1024)
  )

  // Fresh FormData per attempt — not reused across retries
  const formData = new FormData()
  formData.append('file', new Blob([buffer as any]), filename)
  formData.append('model', model)
  formData.append('response_format', 'text')

  const startTime = Date.now()

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
    duplex: 'half',
  } as any)

  const elapsedMs = Date.now() - startTime

  if (!response.ok) {
    const errorBody = await response.text()
    console.error(
      '[transcription:whisper] POST-REQUEST: step=%d attempt=%d elapsed=%dms status=%d body=%s',
      stepIndex, attempt, elapsedMs, response.status, errorBody.slice(0, 500)
    )
    const err = new Error(`Whisper API error ${response.status}: ${errorBody}`) as any
    err.status = response.status
    throw err
  }

  const responseText = await response.text()

  console.log(
    '[transcription:whisper] POST-REQUEST: step=%d attempt=%d elapsed=%dms status=%d response_length=%d',
    stepIndex, attempt, elapsedMs, response.status, responseText.length
  )

  const text = responseText.trim()
  return text || '[No audio]'
}

// ── Whisper API with retry ──

async function transcribeSegmentWithRetry(
  segmentPath: string,
  stepIndex: number,
  apiKey: string
): Promise<string> {
  const fileStats = statSync(segmentPath)
  const model = 'whisper-1'

  if (fileStats.size === 0) {
    console.log('[transcription:whisper] Step %d: file is empty, returning [No audio]', stepIndex)
    return '[No audio]'
  }

  const buffer = await readFile(segmentPath)
  const filename = basename(segmentPath)

  for (let attempt = 1; attempt <= MAX_TRANSCRIPTION_ATTEMPTS; attempt++) {
    const startTime = Date.now()

    try {
      return await attemptTranscription(
        apiKey, buffer, filename, model, stepIndex, attempt
      )
    } catch (err) {
      const elapsedMs = Date.now() - startTime
      logErrorDetails(`[transcription:whisper] Step ${stepIndex}`, err, attempt, elapsedMs)

      const classification = classifyError(err)

      if (classification === 'permanent') {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (errMsg.includes('insufficient_quota')) {
          console.error('[transcription:whisper] Step %d: insufficient_quota detected — billing issue, not retrying', stepIndex)
        } else {
          console.error('[transcription:whisper] Step %d: permanent error, not retrying', stepIndex)
        }
        throw err
      }

      if (attempt < MAX_TRANSCRIPTION_ATTEMPTS) {
        const delayMs = retryDelayMs(attempt - 1)
        console.log('[transcription:whisper] Step %d: will retry in %dms (attempt %d/%d failed)',
          stepIndex, delayMs, attempt, MAX_TRANSCRIPTION_ATTEMPTS)
        await sleep(delayMs)
      } else {
        console.error(
          '[transcription:whisper] Step %d: all %d attempts exhausted',
          stepIndex, MAX_TRANSCRIPTION_ATTEMPTS
        )
      }
    }
  }

  throw new Error(`Step ${stepIndex}: transcription failed after all attempts`)
}

// ── Trailing narration ──

async function promptTrailingNarration(
  trailingDurationMs: number
): Promise<boolean> {
  const windows = BrowserWindow.getAllWindows()
  const parentWindow = windows.find((w) => !w.isDestroyed()) || null

  const trailingSec = (trailingDurationMs / 1000).toFixed(1)

  const { response } = await dialog.showMessageBox(
    parentWindow!,
    {
      type: 'question',
      buttons: ['Create Final Step', 'Discard'],
      defaultId: 0,
      cancelId: 1,
      title: 'Trailing Narration',
      message: `There are approximately ${trailingSec}s of narration after your last step marker. Create a final step from this trailing audio?`
    }
  )

  return response === 0
}

// ── Main orchestration ──

export async function transcribeAllSteps(): Promise<void> {
  const state = stateBus.getState()

  if (!state.audioFilePath) {
    console.error('[transcription] No audio file path in state')
    return
  }
  if (state.steps.length === 0) {
    console.log('[transcription] No steps to transcribe')
    return
  }

  const audioPath = state.audioFilePath
  console.log('[transcription] Starting transcription for %d steps', state.steps.length)
  console.log('[transcription] Audio file: %s', audioPath)

  // ── Guard: wait for audio file to exist on disk ──
  // Recording finalization may still be writing the file when transcribe:start fires.
  const AUDIO_WAIT_INTERVAL_MS = 250
  const AUDIO_WAIT_MAX_MS = 10_000
  let audioWaitedMs = 0
  while (!existsSync(audioPath)) {
    if (audioWaitedMs >= AUDIO_WAIT_MAX_MS) {
      console.error(
        '[transcription] Audio file not found after waiting %d ms: %s',
        audioWaitedMs, audioPath
      )
      broadcastProgress({
        stepIndex: 0,
        total: state.steps.length,
        status: 'error',
        message: 'Audio file not found: ' + audioPath
      })
      return
    }
    console.log('[transcription] Audio file not yet on disk, waiting… (%d ms elapsed)', audioWaitedMs)
    await sleep(AUDIO_WAIT_INTERVAL_MS)
    audioWaitedMs += AUDIO_WAIT_INTERVAL_MS
  }
  if (audioWaitedMs > 0) {
    console.log('[transcription] Audio file appeared after %d ms', audioWaitedMs)
  }

  // ── Preflight: verify API key and connectivity ──

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('[transcription] OPENAI_API_KEY is not set — aborting')
    broadcastProgress({
      stepIndex: 0,
      total: state.steps.length,
      status: 'error',
      message: 'OPENAI_API_KEY environment variable is not set'
    })
    return
  }

  const preflightOk = await preflightCheck(apiKey)
  if (!preflightOk) {
    console.error('[transcription] Preflight failed — aborting transcription to avoid wasting time')
    broadcastProgress({
      stepIndex: 0,
      total: state.steps.length,
      status: 'error',
      message: 'OpenAI API connectivity check failed — see logs for details'
    })
    return
  }

  // ── Probe audio duration ──

  let audioDurationMs: number
  try {
    audioDurationMs = await getAudioDurationMs(audioPath)
    console.log('[transcription] Audio duration: %d ms', audioDurationMs)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[transcription] Failed to probe audio duration:', msg)
    broadcastProgress({
      stepIndex: 0,
      total: state.steps.length,
      status: 'error',
      message: 'Failed to read audio file: ' + msg
    })
    return
  }

  // ── Check for trailing narration ──

  const steps = state.steps
  const lastStepTimestamp = steps[steps.length - 1].timestamp
  const trailingDurationMs = audioDurationMs - lastStepTimestamp

  if (trailingDurationMs > TRAILING_NARRATION_THRESHOLD_MS) {
    console.log(
      '[transcription] Trailing narration detected: %d ms after last step',
      trailingDurationMs
    )

    const accepted = await promptTrailingNarration(trailingDurationMs)

    if (accepted) {
      const lastStep = steps[steps.length - 1]
      const trailingStep: Step = {
        id: uuidv4(),
        index: steps.length,
        timestamp: audioDurationMs,
        screenshot: lastStep.screenshot,
        selectionRect: null,
        rawTranscript: '',
        editedText: '',
        claudeQuestions: [],
        rewriteStatus: 'raw',
        rewriteSource: 'none'
      }
      stateBus.addStep(trailingStep)
      console.log('[transcription] Created trailing narration step: index=%d', trailingStep.index)
    } else {
      console.log('[transcription] User declined trailing narration step')
    }
  }

  // ── Extract and transcribe each step sequentially ──

  const currentState = stateBus.getState()
  const allSteps = currentState.steps
  const sessionDir = currentState.sessionDir
  if (!sessionDir) {
    console.error('[transcription] No session directory')
    return
  }

  const total = allSteps.length
  let succeeded = 0
  let failed = 0
  let noAudio = 0
  console.log('[transcription] Transcribing %d steps sequentially', total)

  for (let i = 0; i < total; i++) {
    const step = allSteps[i]

    // Compute segment boundaries with 0.5s padding
    const prevTimestamp = i === 0 ? 0 : allSteps[i - 1].timestamp
    const currentTimestamp = step.timestamp

    const segStartMs = Math.max(0, prevTimestamp - (i === 0 ? 0 : SEGMENT_PADDING_MS))
    const segEndMs = Math.min(audioDurationMs, currentTimestamp + SEGMENT_PADDING_MS)
    const segDurationMs = segEndMs - segStartMs

    console.log(
      '[transcription] Step %d: segment %d ms → %d ms (duration: %d ms)',
      i, segStartMs, segEndMs, segDurationMs
    )

    // Short/silent segment check
    if (segDurationMs < MIN_SEGMENT_DURATION_MS) {
      console.log('[transcription] Step %d: segment too short (%d ms), marking [No audio]', i, segDurationMs)
      stateBus.updateStepTranscript(step.id, '[No audio]')
      broadcastProgress({ stepIndex: i, total, status: 'done', message: '[No audio]' })
      noAudio++
      continue
    }

    // Extract segment
    const segmentFilename = `segment-${i}-${uuidv4().slice(0, 8)}.wav`
    const segmentPath = join(sessionDir, segmentFilename)

    broadcastProgress({ stepIndex: i, total, status: 'extracting' })

    try {
      await extractAudioSegment(audioPath, segStartMs, segEndMs, segmentPath)
      console.log('[transcription] Step %d: segment extracted to %s', i, segmentPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[transcription] Step %d: extraction failed: %s', i, msg)
      stateBus.updateStepTranscript(step.id, '[Transcription failed]')
      broadcastProgress({ stepIndex: i, total, status: 'error', message: 'Extraction failed: ' + msg })
      failed++
      continue
    }

    // Transcribe segment (with retry)
    broadcastProgress({ stepIndex: i, total, status: 'transcribing' })

    try {
      const transcript = await transcribeSegmentWithRetry(segmentPath, i, apiKey)
      console.log('[transcription] Step %d: FINAL RESULT = "%s"', i, transcript.slice(0, 100))
      stateBus.updateStepTranscript(step.id, transcript)
      broadcastProgress({ stepIndex: i, total, status: 'done' })
      if (transcript === '[No audio]') {
        noAudio++
      } else {
        succeeded++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[transcription] Step %d: FINAL OUTCOME — failed after all retries: %s', i, msg)
      stateBus.updateStepTranscript(step.id, '[Transcription failed]')
      broadcastProgress({ stepIndex: i, total, status: 'error', message: 'Whisper API failed: ' + msg })
      failed++
    }
  }

  console.log(
    '[transcription] SUMMARY: total=%d succeeded=%d failed=%d no_audio=%d',
    total, succeeded, failed, noAudio
  )
}
