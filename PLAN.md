# PLAN.md — XOVR Toolpath Claude Code Execution Plan

## Execution Rules for Claude Code

Read this file and execute **strictly sequentially**.

Before writing code, output only:
1. a concise PRD
2. a risk assessment
3. fallback decisions for ambiguous or high-risk areas
4. a phase-by-phase execution checklist mapped to this plan

Until that planning output is approved:
- do not create, modify, or delete files
- do not scaffold
- do not write code
- stop and wait for approval

After approval:
- execute **Phase 1 only**, then stop
- do not start later phases early
- do not substitute libraries, architecture, or shortcuts unless this plan explicitly allows a fallback
- if a deviation is needed, explain it and stop for approval
- at the end of each phase, output:
  - files changed
  - commands to run
  - what to verify manually
  - any deviations from this plan
  - then stop and wait

Use `CLAUDE.md` in the repo root as persistent project guidance, but if there is any conflict, this `PLAN.md` phase plan wins.

---

## Project Overview

Build "XOVR Toolpath," an internal screen recording and documentation tool.

The user records their screen while narrating a process. They trigger a step marker while recording. Each marker captures a screenshot, opens a selection overlay, and creates a documentation step. The transcript attached to that step must be the audio spoken since the previous marker, not the audio after the marker. After recording, the user enters an edit stage where the raw transcript is preserved and Claude helps rewrite step text into cleaner instructional documentation.

## Product Requirements

- Required v1 step marker: **Ctrl+Shift+S** only.
- **Ctrl+Click is out of scope for the core v1 build** and may only be explored later as an optional experimental feature after all core phases are complete and stable.
- A step marker **closes the prior narration segment**.
- Each step stores:
  - screenshot (compressed JPEG or WebP asset)
  - selection rect
  - timestamp
  - raw transcript
  - edited text
  - Claude Q&A history
  - rewrite status / provenance
- On Stop, if there is meaningful audio since the last marker, prompt the user to create a final trailing-narration step. If accepted, create one final step using the last available frame/screenshot plus that trailing audio. If declined, discard the trailing narration for v1.
- Claude should ask clarifying questions **only when needed** for ambiguity or user-requested refinement.
- Batch rewrite mode should **not** ask questions.
- `rawTranscript` must never be overwritten by AI output.
- v1 priorities:
  1. reliable recording
  2. correct step timing + transcript mapping
  3. fast capture flow
  4. solid edit stage
  5. save/load project
  6. Markdown/HTML/PDF export

## Before Writing Code

Before implementation, produce:
1. a short PRD
2. a list of requirement conflicts or ambiguity
3. top technical risks
4. fallback decisions for v1 versus later versions

Do this before major coding so architecture decisions are explicit.

## Technical Guardrails

### Critical guardrails that must be followed

1. **Main process source of truth**
   - The main window, toolbar, and overlay are separate `BrowserWindow` instances.
   - They do not share Zustand state or memory.
   - Keep canonical recording state in the Electron main process.
   - Broadcast `state:update` IPC events to all open windows so local stores stay synchronized.

2. **Timestamp math must exclude paused time**
   - Track:
     - `sessionStartTime`
     - `pauseStartedAt`
     - `totalPausedDuration`
   - Use:
     - `effectiveTimestamp = (Date.now() - sessionStartTime) - totalPausedDuration`
   - This is required so FFmpeg segment extraction matches the recorded media.

3. **Step segmentation rule**
   - Segment audio from the previous step marker to the current step marker.
   - For the first step, segment from `0` to `step[0].timestamp`.
   - After the last step, if there is meaningful trailing narration, stop flow must prompt the user to either create one final step from the last available frame/screenshot plus that narration or discard it for v1.
   - Add a small overlap/padding (for example 0.5s to 1.0s) when extracting segments so speech at click time is not cut off.

4. **Vision input must be visually annotated**
   - Do not rely on raw coordinate text alone for screenshot focus.
   - Before sending a screenshot to Claude, draw a visible red rectangle on a copy of the image using the `selectionRect`.
   - Send the annotated image to Claude.
   - Keep the original screenshot unmodified on disk.

5. **Claude flow must be two separate API calls**
   - API Call 1: generate clarifying questions only.
   - API Call 2: generate rewritten step text after the user answers.
   - Do not instruct Claude to "wait" inside a single request.

6. **Use stable dependencies for v1**
   - Use `ffmpeg-static` with `fluent-ffmpeg`.
   - Use the OpenAI Whisper API for v1.
   - Do not depend on `whisper.cpp` Node bindings or other native transcription modules for v1.
   - Do not bundle Puppeteer for PDF export; use Electron `webContents.printToPDF()`.

7. **Model configuration**
   - Do not hardcode a dated Anthropic model string in the plan or code.
   - Read the model from config/settings/environment.
   - If the model is missing or invalid, surface a clear settings error and disable Claude features until corrected.

8. **API key storage**
   - For keys entered in the desktop settings UI, use Electron `safeStorage` before writing to `electron-store`.
   - Environment variables remain supported for local development and CI.
   - Never write plaintext API keys to project files, autosave snapshots, or logs.

9. **Windows-focused reliability**
   - Handle multi-monitor capture.
   - Handle DPI scaling / coordinate transforms.
   - Add autosave and crash recovery for session/project state.
   - Queue rapid capture requests so only one overlay/capture flow runs at a time.

## Tech Stack

- Electron + React + TypeScript
- Vite + electron-builder
- Zustand for renderer-local UI state only
- Electron main process for canonical app state
- OpenAI Whisper API for transcription
- Anthropic Claude API for rewrite/question generation
- `fluent-ffmpeg` + `ffmpeg-static` for segment extraction
- Electron native `printToPDF()` for PDF export

## Capture Architecture Split

- Renderer capture context: `getDisplayMedia(...)`, `getUserMedia(...)`, and `MediaRecorder` for live media capture and recording
- Main process: canonical session state, `globalShortcut`, `screen.getCursorScreenPoint()`, BrowserWindow lifecycle, IPC orchestration, and optional `desktopCapturer` + `session.setDisplayMediaRequestHandler(...)` for source selection or permission brokering

---

## Phase 1: Project Scaffolding

### Agent 1 — Scaffold

```text
Initialize an Electron + React + TypeScript project using Vite as the bundler.

Directory structure:
  xovr-toolpath/
    src/
      main/
        main.ts
        ipc-handlers.ts
        hotkeys.ts
        state-bus.ts
        transcription.ts
        claude.ts
        export.ts
      renderer/
        App.tsx
        components/
        pages/
        hooks/
        stores/
        types/
      preload/
        preload.ts
      shared/
        types.ts
    electron-builder.yml
    vite.config.ts
    tsconfig.json
    package.json

Install dependencies:
  - electron, electron-builder, vite, @vitejs/plugin-react
  - react, react-dom, zustand
  - @anthropic-ai/sdk
  - openai
  - fluent-ffmpeg
  - ffmpeg-static
  - electron-store
  - uuid

Dev dependencies:
  - typescript, @types/react, @types/react-dom
  - concurrently, electron-vite or equivalent

Configure electron-builder for Windows builds.
- Build both an NSIS installer and a portable executable target for field technicians who may not have admin rights.
Set up the preload bridge exposing typed IPC methods for:
  - recording:start
  - recording:pause
  - recording:resume
  - recording:stop
  - capture:mark-step
  - overlay:open
  - transcribe:start
  - claude:questions
  - claude:rewrite
  - export:run
  - file:save-project
  - file:load-project
  - state:subscribe
  - settings:get
  - settings:save
```

---

## Phase 2: Shared Types + Canonical Recording State

### Agent 2 — Types and Main-Process State

```text
Define shared types in src/shared/types.ts.

Required interfaces:

interface Step {
  id: string;
  index: number;
  timestamp: number;              // effective ms offset excluding paused time
  screenshot: string;             // full screenshot path
  selectionRect: Rect | null;
  rawTranscript: string;
  editedText: string;
  claudeQuestions: QAPair[];
  rewriteStatus: "raw" | "ai_rewritten" | "manually_edited";
  rewriteSource: "none" | "batch" | "interactive";
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  displayScale?: number;          // for DPI/multi-monitor handling if needed
}

interface QAPair {
  question: string;
  answer: string;
}

interface RecordingSessionState {
  isRecording: boolean;
  isPaused: boolean;
  sessionStartTime: number | null;
  pauseStartedAt: number | null;
  totalPausedDuration: number;
  activeCaptureQueue: number;
  selectedSourceId: string | null;
  steps: Step[];
  audioFilePath: string | null;
  videoFilePath: string | null;
  sessionDir: string | null;
}

interface ProjectFile {
  schemaVersion: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  steps: Step[];
  assetBasePath: string;
}

interface AutosaveSnapshot {
  schemaVersion: number;
  savedAt: string;
  session: RecordingSessionState;
}

CRITICAL:
- Canonical state must live in the main process.
- Renderer stores must mirror main-process state via IPC.
- Implement a state broadcaster in src/main/state-bus.ts that emits state:update to all open windows whenever relevant state changes.
```

### Agent 3 — Recording Engine + Toolbar

```text
Implement recording and toolbar flow.

SCREEN RECORDING:
- In the renderer capture context, use navigator.mediaDevices.getDisplayMedia(...) to obtain the display stream.
- Record screen video in the renderer with MediaRecorder.
- Persist video to a temp/session file.
- The main process may optionally use Electron desktopCapturer + session.setDisplayMediaRequestHandler(...) to help with source selection or permission brokering, but the renderer owns the live media stream and recording.

AUDIO RECORDING:
- In the renderer capture context, capture microphone audio separately with navigator.mediaDevices.getUserMedia({ audio: true }).
- Record audio to a transcription-friendly format or a format that can be converted by FFmpeg.
- Persist audio to a temp/session file.

TIMING:
- On recording start, set sessionStartTime.
- On pause, set pauseStartedAt.
- On resume, accumulate totalPausedDuration += (Date.now() - pauseStartedAt), then clear pauseStartedAt.
- All step timestamps must use:
    (Date.now() - sessionStartTime) - totalPausedDuration

TOOLBAR WINDOW:
- Separate always-on-top BrowserWindow.
- Draggable, frameless.
- Shows REC state, timer, pause/resume, stop.
- Toolbar actions send IPC to main.
- Main updates canonical state, then broadcasts back to all windows.

The renderer may use Zustand for UI presentation, but not as the sole source of truth. The main process remains the canonical session/state authority.
```

---

## Phase 3: Step Capture

### Agent 4 — Step Marker Input + Screenshot Capture

```text
Implement the step marker system.

PRODUCT DECISION:
- Use Ctrl+Shift+S as the sole required v1 step marker.
- Do not attempt Ctrl+Click during the core v1 build.
- If explored later, Ctrl+Click must be optional and explicitly marked experimental.

WHEN A STEP IS MARKED:
1. Compute effective timestamp:
     (Date.now() - sessionStartTime) - totalPausedDuration
2. Capture a full screenshot.
3. Save a compressed screenshot (JPEG or WebP, quality about 80, max width about 1920px) to:
     {sessionDir}/captures/step-{index}.webp
4. Open the selection overlay.
5. Queue further capture requests if a capture is already in progress.

CAPTURE RULES:
- Keep the full screenshot content, but store it in a compressed JPEG or WebP asset to reduce disk, memory, and Claude Vision payload size.
- The selected rect is metadata, not the stored image.
- If cursor coordinates are available, use them to center a default selection box in the overlay.

CURSOR POSITION HINT:
- Because v1 uses the Ctrl+Shift+S keyboard marker, there is no click event with X/Y coordinates. Use Electron's `screen.getCursorScreenPoint()` in the main process at the exact moment the hotkey fires to capture the current mouse position. Pass those coordinates to the overlay for default selection box placement.
```

### Agent 5 — Selection Overlay

```text
Build a fullscreen transparent overlay BrowserWindow.

Behavior:
- Show the screenshot as the background.
- Dim the screen slightly.
- Show a selection rectangle centered near the click location when available.
- Allow user to draw, move, and resize the rectangle for v1 if feasible; if not, at minimum allow draw + confirm/skip.
- Enter = confirm.
- Escape = skip.
- Return Rect coordinates to main via IPC.
- Create the Step record in canonical state after overlay completion.

Reliability requirements:
- Handle multi-monitor coordinate systems correctly.
- Handle DPI scaling so overlay rect matches the screenshot coordinates.
```

---

## Phase 4: Transcription

### Agent 6 — Audio Segmentation + Whisper API

```text
After recording stops, segment the audio and transcribe each step.

SEGMENTATION RULE:
- Each step's transcript is the audio from the previous marker to this marker.
- Example:
    Step 1 => 0 to step[0].timestamp
    Step 2 => step[0].timestamp to step[1].timestamp
    ...
- Consider 0.5s to 1.0s overlap/padding during extraction to avoid clipping speech exactly at boundaries.

FFMPEG:
- Use fluent-ffmpeg with the ffmpeg-static binary path.
- Never rely on a system-installed ffmpeg.

TRANSCRIPTION:
- Use the OpenAI Whisper API for v1.
- For each segment:
  1. extract temp audio file
  2. transcribe
  3. store text in step.rawTranscript
  4. initialize step.editedText = step.rawTranscript

ERROR HANDLING:
- silent or too-short segments => "[No audio]"
- API failure => "[Transcription failed]"
- emit progress events to renderer via IPC
```

---

## Phase 5: Edit Stage

### Agent 7 — Edit Page Layout

```text
Build the edit stage.

LEFT PANEL:
- ordered step list
- screenshot preview with visible selection overlay
- editable editedText area
- status badge

RIGHT PANEL:
- Claude question/answer panel for interactive rewrite
- shows per-step Q&A history
- user can answer questions and trigger final rewrite

TOP BAR:
- project title
- export
- save project
- step count

BOTTOM BAR:
- previous / next
- rewrite current
- rewrite all

Important:
- Show both rawTranscript and editedText somewhere in the UI, even if rawTranscript is tucked behind a disclosure panel or secondary tab.
- The user must be able to inspect the original source transcript at any time.
```

### Agent 8 — Step Card + Annotated Images

```text
Implement the step card component.

Display rules:
- load full screenshot
- visually render the selected region on top
- optionally show a zoomed inset of the selected area

For Claude preparation:
- generate an annotated copy of the image with a thick visible red rectangle over selectionRect
- keep the original screenshot untouched
- use the annotated copy when sending screenshot context to Claude
```

---

## Phase 6: Claude Rewrite Flow

### Agent 9 — Claude Integration

```text
Implement Claude integration in src/main/claude.ts and renderer state/hooks.

INTERACTIVE FLOW:
API CALL 1 — Questions
- Send:
  - annotated screenshot
  - raw transcript
  - up to the previous 3 edited steps if available
  - any user-supplied context
- System instruction:
  "Return only a JSON array of 0 to 4 concise clarifying questions. Ask questions only if they are necessary to resolve ambiguity or improve the quality of the instruction. If no clarification is needed, return an empty array."

API CALL 2 — Rewrite
- After the user answers questions, send:
  - original transcript
  - annotated screenshot
  - up to the previous 3 edited steps as context
  - Q&A pairs
- System instruction:
  "Write one clear procedural documentation step. Use imperative voice. Keep it concise. Return only the final step text wrapped in <step_text> tags."

RULES:
- Never ask mandatory questions for every step.
- If the first call returns [], allow immediate rewrite.
- Preserve Q&A history on the step.
- Parse <step_text> tags programmatically.

BATCH MODE:
- No Q&A.
- Process sequentially, not in parallel.
- Use up to the previous 3 edited steps for continuity.
- If any steps were manually edited by the user, infer terminology, formatting, and tone from those steps and apply that style consistently across the batch.
- If no steps have been manually edited, default to imperative voice, concise sentences, and reference visible UI elements from the screenshots.
- Mark rewriteSource = "batch".

MODEL:
- Pull Anthropic model from settings/env.
- Default to a current valid Sonnet model configured externally.
```

---

## Phase 7: Export + Project Save

### Agent 10 — Export and Persistence

```text
Support these formats:

1. MARKDOWN
- title
- numbered steps
- screenshot references
- edited text

2. HTML
- self-contained
- embedded images
- clean documentation layout
- optional SVG/HTML overlays for selection rects
- table of contents

3. PDF
- render HTML in a hidden BrowserWindow
- use webContents.printToPDF()
- do not use Puppeteer

4. PROJECT FILE (.xtoolpath)
- JSON metadata + relative asset paths
- include `schemaVersion`
- supports reopening and continuing edits

Also implement:
- save/load project
- settings persistence using `electron-store`, with any API key values encrypted via Electron `safeStorage` before writing
- autosave every 30 seconds during recording and whenever a step is captured or edited
- autosave to a lightweight `backup.xtoolpath` JSON snapshot in the OS temp directory, excluding raw media blobs
- include `schemaVersion` in autosave snapshots
- restore prompt on launch if a recoverable autosave exists
- unsaved-work warning on close
- crash recovery from the latest autosave
```

---

## Phase 8: Polish + Edge Cases

### Agent 11 — Integration Hardening

```text
Handle:
- start page: new recording / open project
- session temp directory lifecycle
- error boundaries
- retry flows for Claude and transcription using capped exponential backoff with a maximum of 3 retries
- surface per-step failure state with manual retry actions in the UI
- never run Claude rewrites in parallel
- keyboard shortcuts in edit mode
- proper cleanup of toolbar + overlay windows
- Windows multi-monitor behavior
- DPI scaling correctness
- rapid capture queueing
- user messaging for the Ctrl+Shift+S step marker and any future experimental Ctrl+Click toggle
```

---

## Execution Strategy

Build sequentially, not with simultaneous local agent sessions on the same codebase.

Recommended workflow:
1. Save this plan as PLAN.md in the project root.
2. Run Claude Code against one phase at a time.
3. After each phase:
   - run the app
   - verify the acceptance criteria
   - commit to git
4. Only then move to the next phase.

Suggested sequence:
- Agent 1
- Agent 2
- Agent 3
- Agent 4
- Agent 5
- Agent 6
- Agent 7
- Agent 8
- Agent 9
- Agent 10
- Agent 11

## Acceptance Checks

- recording starts/stops reliably
- pause/resume does not break timestamps
- step transcripts map to the correct spoken narration
- overlay coordinates match the screenshot on Windows displays
- interactive rewrite can ask questions and then rewrite
- batch rewrite skips questions
- raw transcript remains visible and unchanged
- save/load/autosave/restore work
- Markdown, HTML, and PDF export work