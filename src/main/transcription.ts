import { join, basename } from 'path'
import { readFileSync, statSync, unlinkSync } from 'fs'
import { BrowserWindow, dialog } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpeg from 'fluent-ffmpeg'
import OpenAI, { toFile } from 'openai'
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

      // Fallback: Chrome WebM has no duration header. Remux to MKV to compute it.
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
            // Clean up temp file regardless of result
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

// ── Whisper API ──

const WHISPER_TIMEOUT_MS = 120_000

async function transcribeSegment(segmentPath: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  const fileStats = statSync(segmentPath)
  const fileSizeKB = Math.round(fileStats.size / 1024)

  const model = 'whisper-1'

  console.log(
    '[transcription:whisper] PRE-REQUEST: key_present=%s model=%s file=%s size=%dKB',
    Boolean(apiKey),
    model,
    segmentPath,
    fileSizeKB
  )

  if (fileStats.size === 0) {
    console.log('[transcription:whisper] File is empty, returning [No audio]')
    return '[No audio]'
  }

  const client = new OpenAI({ apiKey, timeout: WHISPER_TIMEOUT_MS })

  // Read segment into memory and create an upload file object
  // instead of passing a raw fs.createReadStream which can stall
  // in Electron's bundled Node environment.
  const buffer = readFileSync(segmentPath)
  const uploadFile = await toFile(buffer, basename(segmentPath))

  const startTime = Date.now()

  const transcription = await client.audio.transcriptions.create({
    model,
    file: uploadFile,
    response_format: 'text'
  })

  const elapsedMs = Date.now() - startTime
  console.log(
    '[transcription:whisper] POST-REQUEST: elapsed=%dms response_type=%s response_length=%d',
    elapsedMs,
    typeof transcription,
    typeof transcription === 'string' ? transcription.length : JSON.stringify(transcription).length
  )

  const text = String(transcription).trim()
  if (!text) {
    return '[No audio]'
  }
  return text
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

  // Step 1 — probe audio duration
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

  // Step 2 — check for trailing narration
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
      // Create a final step using the last step's screenshot
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

  // Re-read state after potential trailing step addition
  const currentState = stateBus.getState()
  const allSteps = currentState.steps
  const sessionDir = currentState.sessionDir
  if (!sessionDir) {
    console.error('[transcription] No session directory')
    return
  }

  const total = allSteps.length
  console.log('[transcription] Transcribing %d steps sequentially', total)

  // Step 3 — extract and transcribe each step sequentially
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
      console.error('[transcription] Step %d: extraction failed:', i, msg)
      stateBus.updateStepTranscript(step.id, '[Transcription failed]')
      broadcastProgress({ stepIndex: i, total, status: 'error', message: 'Extraction failed: ' + msg })
      continue
    }

    // Transcribe segment
    broadcastProgress({ stepIndex: i, total, status: 'transcribing' })

    try {
      const transcript = await transcribeSegment(segmentPath)
      console.log('[transcription] Step %d: transcript = "%s"', i, transcript.slice(0, 80))
      stateBus.updateStepTranscript(step.id, transcript)
      broadcastProgress({ stepIndex: i, total, status: 'done' })
    } catch (err: unknown) {
      const errObj = err as Record<string, unknown>
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[transcription] Step %d: Whisper API failed:', i, msg)
      console.error('[transcription:whisper] ERROR DETAILS: name=%s status=%s code=%s type=%s',
        errObj?.name ?? 'N/A',
        errObj?.status ?? 'N/A',
        errObj?.code ?? 'N/A',
        errObj?.type ?? 'N/A'
      )
      if (errObj?.cause) {
        console.error('[transcription:whisper] ERROR CAUSE:', errObj.cause)
      }
      try {
        console.error('[transcription:whisper] SERIALIZED:', JSON.stringify(err, Object.getOwnPropertyNames(err as object)))
      } catch {
        console.error('[transcription:whisper] (could not serialize error)')
      }
      stateBus.updateStepTranscript(step.id, '[Transcription failed]')
      broadcastProgress({ stepIndex: i, total, status: 'error', message: 'Whisper API failed: ' + msg })
    }
  }

  console.log('[transcription] All steps transcribed')
}
