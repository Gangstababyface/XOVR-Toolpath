# CLAUDE.md — XOVR Toolpath Repository Guidance

This file provides persistent project guidance for Claude Code while working in the XOVR Toolpath repo.

Priority order:
1. Direct user instruction
2. `PLAN.md`
3. This `CLAUDE.md`

Do not use this file as permission to skip the sequential phase gates defined in `PLAN.md`.

---

# XOVR Toolpath

Internal screen recording and documentation tool for XOVR Fiber Laser Systems.

## What This Does

Record the user's screen while they narrate a process. Press `Ctrl+Shift+S` to mark a step, capture a screenshot, and open a selection overlay. Each step gets the narration spoken since the previous marker. After recording, the app enters an edit stage where the raw transcript is preserved and Claude helps rewrite each step into clean procedural documentation. Export as Markdown, HTML, or PDF, or save/load a `.xtoolpath` project.

## Product Rules

1. **Primary interaction:** `Ctrl+Shift+S` is the sole required v1 step marker. Do not attempt `Ctrl+Click` during the core v1 build. `Ctrl+Click` may only be explored later as an optional experimental feature if all core phases are complete and stable.
2. **Step boundary rule:** A step marker closes the previous narration segment. The transcript attached to a step must be the audio from the previous marker (or recording start) up to the current marker.
3. **Preserve source material:** Keep `rawTranscript` and `editedText` separate. Claude rewrites must never overwrite the raw transcript.
4. **Questioning behavior:** Claude should ask clarifying questions only when ambiguity is high, confidence is low, or the user explicitly requests refinement. Batch rewrite mode should skip questions.
5. **Rewrite context:** When rewriting a step, provide up to the previous 3 edited steps as context so Claude can preserve terminology, sequence, and tone.
6. **Batch consistency:** For batch rewrite, Claude should infer terminology and formatting from any manually edited steps and apply that style consistently. If no steps have been manually edited, default to concise imperative voice and reference visible UI elements from the screenshots.
7. **Selection workflow:** After a marker, show an overlay with a default selection box centered near the current cursor position when available. The user can move or resize it, confirm it, or skip it.
8. **Screenshot storage:** Save screenshots in compressed JPEG or WebP format around quality 80 and max width around 1920px unless debugging requires more.
9. **Trailing narration rule:** When the user stops recording, if there is meaningful audio since the last marker, prompt to create a final step from trailing narration. If accepted, create one final step using the last available frame or screenshot plus that trailing audio. If declined, discard the trailing narration for v1.
10. **Project compatibility:** Include a `schemaVersion` in saved project files and autosave snapshots so step and settings formats can evolve safely.
11. **v1 priority:** Reliability over polish. Prioritize recording, correct step mapping, editability, save/load, and export.

## Tech Stack

- **Runtime:** Electron 33+ (Node 20+)
- **Frontend:** React 18 + TypeScript + Zustand
- **Bundler:** Vite (via electron-vite)
- **Windows Packaging:** Build both NSIS installer and portable executable targets for field use on locked-down PCs
- **Screen Capture:** Renderer uses `getDisplayMedia(...)` + `MediaRecorder`; main process may optionally use Electron `desktopCapturer` + `session.setDisplayMediaRequestHandler(...)` for source selection or permission brokering
- **Audio:** Renderer uses `getUserMedia(...)`
- **Transcription:** OpenAI Whisper API for v1
- **AI Rewriting:** Anthropic Claude API using a model read from settings or environment configuration; do not hardcode a dated model string
- **Audio Processing:** FFmpeg via `fluent-ffmpeg` + `ffmpeg-static`
- **Export:** Native HTML/Markdown generation + Electron `webContents.printToPDF()`
- **Secret Storage:** `electron-store` + Electron `safeStorage` for desktop-stored API keys

## Architecture

```text
Main Process (Node, source of truth)      Renderer Windows / Capture Context
├── main.ts                               ├── App.tsx
├── ipc-handlers.ts                       ├── pages/
│   ├── recording:*                       │   ├── StartPage.tsx
│   ├── capture:*                         │   ├── Toolbar.tsx
│   ├── transcribe:*                      │   ├── SelectionOverlay.tsx
│   ├── claude:*                          │   ├── EditPage.tsx
│   ├── export:*                          │   └── SettingsPage.tsx
│   └── file:*                            ├── components/
├── hotkeys.ts                            │   ├── StepCard.tsx
├── transcription.ts                      │   └── ClaudeChat.tsx
├── claude.ts                             ├── stores/
├── export.ts                             │   ├── recordingStore.ts
└── state-bus.ts                          │   └── claudeStore.ts
                                           └── capture renderer
                                               ├── getDisplayMedia(...)
                                               ├── getUserMedia(...)
                                               └── MediaRecorder
```

## Key Design Decisions

1. **Main process is authoritative:** The main window, toolbar, and overlay are separate `BrowserWindow` instances and do not share renderer memory. Canonical recording/session state lives in the main process and is broadcast to renderer windows over IPC.
2. **Renderer owns live media capture:** The renderer or hidden capture window owns `getDisplayMedia(...)`, `getUserMedia(...)`, and `MediaRecorder`. The main process owns orchestration, shortcuts, window lifecycle, and state.
3. **Paused time must be excluded:** Step timestamps must subtract total paused duration so media timestamps remain aligned with FFmpeg slicing.
4. **Full screenshots, visual focus:** Store the full screenshot, keep the selected rect separately, and draw a visible annotation box on a copy of the image before sending it to Claude.
5. **Two-call Claude flow:** Question generation and final rewrite are separate API calls. Do not model Claude as waiting inside a single request.
6. **Bundled FFmpeg, API Whisper for v1:** Use `ffmpeg-static` and the OpenAI Whisper API in v1 to avoid native module build issues.
7. **Autosave and recovery:** Persist lightweight session state every 30 seconds during recording and whenever a step is captured or edited. Offer restore on relaunch after crash or forced close.
8. **Protected API keys:** If API keys are stored from the settings UI, encrypt them with Electron `safeStorage` before writing to `electron-store`. Environment variables remain supported for local development.
9. **Retry discipline:** Use capped exponential backoff with at most 3 retries for transcription and Claude calls, never run Claude rewrites in parallel, and surface per-step failure state with manual retry.
10. **Sequential build flow:** Even if the implementation plan is written in agents, execute phases sequentially against one codebase to avoid conflicts.

## Development

```bash
npm install
npm run dev
npm run build
```

## Environment Variables

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
ANTHROPIC_MODEL=<configured-sonnet-model-or-alias>
```
