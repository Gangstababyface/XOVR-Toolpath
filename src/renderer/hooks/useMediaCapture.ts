import { useEffect, useRef, useState } from 'react'
import { useRecordingStore } from '../stores/recordingStore'

export interface MediaCaptureControls {
  isStarting: boolean
  startError: string | null
  startRecording: () => void
  cancelStart: () => void
  clearStartError: () => void
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) return `${err.name}: ${err.message}`
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

export function useMediaCapture(): MediaCaptureControls {
  const isRecording = useRecordingStore((s) => s.isRecording)
  const isPaused = useRecordingStore((s) => s.isPaused)

  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const abortRef = useRef(false)
  const videoRecorderRef = useRef<MediaRecorder | null>(null)
  const audioRecorderRef = useRef<MediaRecorder | null>(null)
  const videoChunksRef = useRef<Blob[]>([])
  const audioChunksRef = useRef<Blob[]>([])
  const displayStreamRef = useRef<MediaStream | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const wasRecordingRef = useRef(false)

  // Detect canonical stop: isRecording transitions true → false
  useEffect(() => {
    if (isRecording && !wasRecordingRef.current) {
      wasRecordingRef.current = true
    } else if (!isRecording && wasRecordingRef.current) {
      wasRecordingRef.current = false
      stopCapture()
    }
  }, [isRecording])

  // Pause / resume recorders when main-process state changes
  useEffect(() => {
    if (!wasRecordingRef.current) return
    if (isPaused) {
      if (videoRecorderRef.current?.state === 'recording')
        videoRecorderRef.current.pause()
      if (audioRecorderRef.current?.state === 'recording')
        audioRecorderRef.current.pause()
    } else {
      if (videoRecorderRef.current?.state === 'paused')
        videoRecorderRef.current.resume()
      if (audioRecorderRef.current?.state === 'paused')
        audioRecorderRef.current.resume()
    }
  }, [isPaused])

  // On unmount: signal abort and release any held streams
  useEffect(() => {
    return () => {
      abortRef.current = true
      releaseStreams()
    }
  }, [])

  // ── Start flow: abort-safe, checked after every async step ──

  async function startRecording(): Promise<void> {
    if (isStarting || isRecording) return
    setIsStarting(true)
    setStartError(null)
    abortRef.current = false

    let displayStream: MediaStream | null = null
    let audioStream: MediaStream | null = null

    try {
      // Step 1 — recording:start IPC
      console.log('[capture:step-1] Calling recording:start IPC...')
      await window.api.recordingStart()
      console.log('[capture:step-1] recording:start IPC OK')

      if (abortRef.current) {
        console.log('[capture] Aborted after step 1')
        await window.api.recordingStop()
        return
      }

      // Step 2 — getDisplayMedia (triggers setDisplayMediaRequestHandler in main)
      console.log('[capture:step-2] Calling getDisplayMedia({ video: true, audio: false })...')
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        })
        console.log('[capture:step-2] getDisplayMedia OK — %d track(s)', displayStream.getTracks().length)
      } catch (err) {
        const msg = describeError(err)
        console.error('[capture:step-2] getDisplayMedia FAILED:', msg)
        setStartError('Display capture failed: ' + msg)
        await window.api.recordingStop()
        return
      }

      if (abortRef.current) {
        console.log('[capture] Aborted after step 2')
        displayStream.getTracks().forEach((t) => t.stop())
        await window.api.recordingStop()
        return
      }

      // Step 3 — getUserMedia for microphone
      console.log('[capture:step-3] Calling getUserMedia({ audio: true })...')
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        console.log('[capture:step-3] getUserMedia OK — %d track(s)', audioStream.getTracks().length)
      } catch (err) {
        const msg = describeError(err)
        console.error('[capture:step-3] getUserMedia FAILED:', msg)
        setStartError('Microphone capture failed: ' + msg)
        displayStream.getTracks().forEach((t) => t.stop())
        await window.api.recordingStop()
        return
      }

      if (abortRef.current) {
        console.log('[capture] Aborted after step 3')
        displayStream.getTracks().forEach((t) => t.stop())
        audioStream.getTracks().forEach((t) => t.stop())
        await window.api.recordingStop()
        return
      }

      // Step 4 — construct MediaRecorder instances
      displayStreamRef.current = displayStream
      audioStreamRef.current = audioStream

      console.log('[capture:step-4a] Constructing video MediaRecorder...')
      videoChunksRef.current = []
      const videoMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm'
      console.log('[capture:step-4a] Using video MIME: %s', videoMime)
      const videoRecorder = new MediaRecorder(displayStream, {
        mimeType: videoMime
      })
      videoRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) videoChunksRef.current.push(e.data)
      }
      videoRecorderRef.current = videoRecorder
      console.log('[capture:step-4a] Video MediaRecorder constructed OK')

      console.log('[capture:step-4b] Constructing audio MediaRecorder...')
      audioChunksRef.current = []
      const audioMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      console.log('[capture:step-4b] Using audio MIME: %s', audioMime)
      const audioRecorder = new MediaRecorder(audioStream, {
        mimeType: audioMime
      })
      audioRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      audioRecorderRef.current = audioRecorder
      console.log('[capture:step-4b] Audio MediaRecorder constructed OK')

      // Step 5 — start recorders
      console.log('[capture:step-5a] Starting video MediaRecorder...')
      videoRecorder.start(1000)
      console.log('[capture:step-5a] Video MediaRecorder started OK (state=%s)', videoRecorder.state)

      console.log('[capture:step-5b] Starting audio MediaRecorder...')
      audioRecorder.start(1000)
      console.log('[capture:step-5b] Audio MediaRecorder started OK (state=%s)', audioRecorder.state)

      // Step 6 — confirm to main: streams acquired, recorders running
      console.log('[capture:step-6] Calling recording:confirm-started IPC...')
      await window.api.recordingConfirmStarted()
      console.log('[capture:step-6] recording:confirm-started IPC OK — recording is active')
    } catch (err) {
      const msg = describeError(err)
      console.error('[capture] Startup failed with uncaught error:', msg)
      setStartError('Recording startup failed: ' + msg)
      // Clean up any partially-acquired resources
      if (displayStream) displayStream.getTracks().forEach((t) => t.stop())
      if (audioStream) audioStream.getTracks().forEach((t) => t.stop())
      displayStreamRef.current = null
      audioStreamRef.current = null
      videoRecorderRef.current = null
      audioRecorderRef.current = null
      await window.api.recordingStop()
    } finally {
      setIsStarting(false)
    }
  }

  function cancelStart(): void {
    abortRef.current = true
  }

  function clearStartError(): void {
    setStartError(null)
  }

  // ── Stop flow: flush recorders, persist media ──

  async function stopCapture(): Promise<void> {
    const videoRecorder = videoRecorderRef.current
    const audioRecorder = audioRecorderRef.current

    const videoStopped = new Promise<void>((resolve) => {
      if (!videoRecorder || videoRecorder.state === 'inactive') {
        resolve()
        return
      }
      videoRecorder.onstop = () => resolve()
      videoRecorder.stop()
    })

    const audioStopped = new Promise<void>((resolve) => {
      if (!audioRecorder || audioRecorder.state === 'inactive') {
        resolve()
        return
      }
      audioRecorder.onstop = () => resolve()
      audioRecorder.stop()
    })

    await Promise.all([videoStopped, audioStopped])

    releaseStreams()

    const videoBlob = new Blob(videoChunksRef.current, { type: 'video/webm' })
    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })

    const videoBuffer = await videoBlob.arrayBuffer()
    const audioBuffer = await audioBlob.arrayBuffer()

    await window.api.recordingSaveMedia({
      video: videoBuffer,
      audio: audioBuffer
    })

    // Kick off transcription (fire-and-forget — progress comes via IPC)
    window.api.transcribeStart().catch((err) => {
      console.error('[capture] transcribeStart failed:', err)
    })

    videoChunksRef.current = []
    audioChunksRef.current = []
    videoRecorderRef.current = null
    audioRecorderRef.current = null
  }

  function releaseStreams(): void {
    displayStreamRef.current?.getTracks().forEach((t) => t.stop())
    audioStreamRef.current?.getTracks().forEach((t) => t.stop())
    displayStreamRef.current = null
    audioStreamRef.current = null
  }

  return { isStarting, startError, startRecording, cancelStart, clearStartError }
}
