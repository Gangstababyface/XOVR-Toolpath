# XOVR Toolpath — Four New Features

## Project Context

XOVR Toolpath is an Electron + React + TypeScript application built with electron-vite, Zustand for state, and IPC via preload. It records screen + audio, captures step screenshots via Ctrl+Shift+S with selection overlays, transcribes audio with the OpenAI Whisper API, and generates step-by-step documentation guides for CNC fiber laser software (TubePro, HypCut, CypNest, TubesT).

All seven build phases are implemented. The app has: recording with a frameless toolbar (pause/resume/stop), step capture with selection overlays, FFmpeg-based audio segmentation, Whisper transcription with progress tracking, an Edit page with StepCard components and a ClaudeChat panel, per-step Claude Q&A (two-call flow: questions then rewrite) and batch rewrite, export to Markdown/HTML/PDF, project save/load (.xtoolpath), settings with safeStorage-encrypted API keys, and autosave with crash recovery. Phase 8 (polish/edge cases) has not been started.

Read the existing codebase before making changes. Key files:
- `src/shared/types.ts` — Step, Rect, QAPair, RecordingSessionState, ProjectFile, AutosaveSnapshot, TranscriptionProgress
- `src/shared/ipc-channels.ts` — all IPC channel constants
- `src/main/claude.ts` — existing two-call Claude flow (questions + rewrite + batch)
- `src/main/export.ts` — Markdown/HTML/PDF export
- `src/main/autosave.ts` — 30-second autosave + crash recovery
- `src/main/settings.ts` — electron-store + safeStorage
- `src/renderer/pages/EditPage.tsx` — edit UI with step list and Claude panel
- `src/renderer/components/StepCard.tsx` — step display with annotated screenshots
- `src/renderer/components/ClaudeChat.tsx` — per-step Q&A UI
- `src/renderer/stores/recordingStore.ts` and `claudeStore.ts` — Zustand stores
- `src/preload/preload.ts` — typed IPC bridge
- `CLAUDE.md` and `PLAN.md` — existing project guidance (read these first)

---

## Feature: Two-Step Capture Overlay (Crop Frame + Highlight)

The current capture flow uses a single overlay after Ctrl+Shift+S where the user draws a highlight box. This feature replaces that with a two-step sequential overlay: first a crop/frame selection to define what area of the screenshot to show in the document, then a highlight box to mark the specific click target within that framed area.

**New capture flow (replaces existing single-overlay flow):**
1. User presses Ctrl+Shift+S
2. **Crop overlay** appears first. The user draws a rectangle to frame the relevant area of the screen (the part they want visible in the final documentation). This is the "what to show" selection
3. User confirms (Enter) or skips (Escape). If skipped, the full screenshot is used
4. **Highlight overlay** appears second, constrained to the cropped area (or full screenshot if crop was skipped). The user draws a rectangle to mark the specific click target or UI element. This is the "what to look at" annotation
5. User confirms (Enter) or skips (Escape). If skipped, no highlight is drawn
6. Step is created with both rectangles stored

**Visual distinction:**
- Crop overlay: use a blue or cyan border/fill (visually distinct from the existing red highlight). Show a label like "Select area to show" so the user knows this is the framing step
- Highlight overlay: keep the existing red rectangle. Show a label like "Highlight click target"
- In the final document, the crop defines the visible image area and the highlight draws an annotation box on top of it

**Data model changes (Step interface in `src/shared/types.ts`):**
- `cropRect: Rect | null` — the crop/frame rectangle in full-screenshot coordinates. If null, the full screenshot is displayed
- The existing `selectionRect` field continues to store the highlight box coordinates. These are relative to the full screenshot (not the crop), so the renderer must translate them when displaying within a cropped view

**Impact on existing code:**
- `src/renderer/pages/SelectionOverlay.tsx` — modify to support both modes. Add a `mode` prop or parameter passed via IPC: `'crop'` or `'highlight'`. Change the overlay color and label text based on mode
- `src/main/ipc-handlers.ts` — the capture flow now opens the overlay twice sequentially. First call with mode `'crop'`, wait for result, then second call with mode `'highlight'`
- `src/renderer/components/StepCard.tsx` — when rendering a step's screenshot, apply `cropRect` to show only the cropped region, then draw the `selectionRect` highlight within that cropped view
- `src/main/claude.ts` — when generating annotated images for Claude, apply the crop first (show only the cropped area), then draw the red highlight annotation. Claude should see exactly what the user will see in the final document
- `src/main/export.ts` — all export formats must apply the crop before rendering the screenshot. The highlight annotation is drawn on the cropped image

**Edit phase adjustments:**
- In the Edit page, the step card shows the cropped view with the highlight overlay, matching the export output
- Add a "Show full screenshot" toggle per step so the user can see the uncropped original if needed
- The crop and highlight rects should both be adjustable in the Edit phase (re-open the overlay or use inline drag handles). Store changes back to the Step

---

## Feature: Editable Step Titles

Each step gets a user-editable title. Titles appear in the step list sidebar, the document preview, and all export formats.

**Data model changes (Step interface in `src/shared/types.ts`):**
- `title: string` — defaults to `"Step {index}"`
- `titleManuallyEdited: boolean` — defaults to false, set to true on first manual edit

**Auto-title behavior:**
- When Whisper transcription completes for a step, auto-generate a short title from the first 6-8 words of the transcript, trimmed at a natural break point
- Only auto-generate if `titleManuallyEdited` is false
- If the transcript updates and `titleManuallyEdited` is still false, regenerate the auto-title

**Edit phase UI:**
- The title is an inline-editable text field above each step's screenshot. Click to edit, Enter or blur to save
- Visually distinct from description text: larger font, bold
- Use a controlled input with local state that flushes to Zustand on blur/Enter (not on every keystroke)
- Tab moves focus to the next step's title for fast sequential editing

**Exports:**
- All export formats (PDF, Markdown, HTML) render the title as a heading above each step

---

## Feature: Document Preview with Image Resize and Crop

Before export, the user sees a live preview of the final document. Each step's screenshot has controls to resize and crop it.

**Preview panel:**
- Add a Preview tab/view accessible from the Edit phase
- Render the full document layout in a single scrollable view: document title, then each step in order showing step number, title, cropped screenshot with highlight box, and description text
- The preview uses `cropRect` to show only the framed area of the screenshot, with the `selectionRect` highlight drawn on top. This matches the final exported output
- "Show full screenshot" toggle per step (same one from the capture overlay feature)

**Image resize:**
- Each screenshot in the preview has drag handles on corners and edges
- Dragging resizes the displayed image proportionally by default. Hold Shift to unlock aspect ratio
- Display current dimensions (width x height px) near the image while dragging
- Minimum: 200px width. Maximum: original cropped area resolution (no upscaling)

**Data model changes (Step interface):**
- `displayWidth?: number` — optional, defaults to cropped area width if unset
- `displayHeight?: number` — optional, defaults to cropped area height if unset
- No `croppedScreenshotPath` field. Crop is defined by `cropRect` coordinates, not a separate file. The renderer and exporter crop on the fly from the original screenshot

**Image crop (edit-phase adjustment):**
- Each screenshot has a "Re-crop" button that lets the user adjust the `cropRect` set during recording, or add one if the user skipped it
- Opens the same crop overlay used during recording (blue/cyan), operating on the full screenshot
- "Apply" updates `cropRect` on the Step. "Cancel" exits without changes
- Hold Shift to snap the crop selection to common aspect ratios (16:9, 4:3, 1:1)
- A separate "Re-highlight" button lets the user adjust the `selectionRect` (red overlay) within the cropped view

**Undo:**
- Ctrl+Z reverts the last image edit (resize, re-crop, or re-highlight) per step. Keep last 10 edits per step in memory. Undo history does not persist across save/load

**Persistence:**
- All image size and crop data persists in the session JSON via the existing save mechanism

**Implementation constraints:**
- No heavy image editing libraries. Use canvas or HTML-based crop overlay
- The preview renderer should be a reusable component since Export will use the same layout logic
- Preview updates in real time as the user edits text or images

---

## Feature: Claude Full-Document Review

The app already has per-step Claude rewrite (interactive two-call Q&A and batch mode) in `src/main/claude.ts` with UI in `src/renderer/components/ClaudeChat.tsx`. This feature adds a separate full-document review that works alongside the existing per-step flow. Claude receives the entire document including all screenshots via the vision API, asks clarifying questions, then rewrites every step for maximum detail and accuracy. A project memory file accumulates context across sessions.

**Trigger:**
- "Claude Review" button in the Edit phase toolbar, visually distinct from per-step rewrite buttons
- Disabled until at least one step has text content
- Shows a badge if project memory exists (e.g., "Memory: 3 decisions saved")

### Project Memory

Location: `{project_output_dir}/claude_memory.json`

```json
{
  "projectContext": "",
  "softwareBeingDocumented": "",
  "targetAudience": "",
  "previousDecisions": [],
  "terminologyPreferences": {},
  "styleNotes": [],
  "lastUpdated": ""
}
```

- On first run, the file does not exist. Claude's first question set should include questions that populate it (what software, who is the audience, terminology preferences)
- On subsequent runs, Claude receives the memory contents in its system prompt so it does not re-ask resolved questions
- After each session, the memory file updates with new decisions, terminology, and context from the Q&A

### Question Phase

Claude receives the full document and returns clarifying questions before rewriting.

**API call:**
```
Model: Read from settings/environment (same source as existing claude.ts)
System prompt:
  "You are reviewing a step-by-step documentation guide for [softwareBeingDocumented].
   Target audience: [targetAudience].
   Project memory: [contents of claude_memory.json]
   
   Review the entire document below, including all screenshots and text.
   Generate clarifying questions that will help you produce the most detailed,
   accurate, and comprehensive rewrite possible. Focus on:
   - Unclear UI elements visible in screenshots that are not explained in the text
   - Steps that seem to be missing between captured steps
   - Terminology that could be more specific
   - Context that would help a reader who has never seen this software
   
   If the project memory already answers a potential question, do not ask it again.
   
   Respond with a JSON array of question objects:
   [{ \"id\": \"q1\", \"question\": \"...\", \"context\": \"Referring to Step 3's screenshot...\" }]
   
   If no questions are needed, respond with an empty array: []"

Messages:
  - One message containing all step data as a structured block:
    - For each step: the screenshot as a base64 image (vision), the title,
      the current description text, the selection box coordinates, and the step index
    - Include the document title and any overall description
```

**UI:**
- Questions appear in a modal or side panel, each with a text input
- User answers all (or skips individual ones), then clicks "Continue"
- If Claude returns an empty array, display "Sufficient context from project memory. Proceeding to rewrite." and move directly to the rewrite phase

### Rewrite Phase

**API call:**
```
Model: Read from settings/environment (same source as existing claude.ts)
System prompt:
  Same base as question phase, plus:
  "Produce the comprehensive rewrite. For each step, provide:
   - A suggested title (or null to keep the current one)
   - A detailed, comprehensive description covering:
     * What the user should do (action)
     * What UI elements to look for (referencing what is visible in the screenshot)
     * What the expected result is after the action
     * Any warnings, tips, or common mistakes
   - A suggested overall document title
   - A suggested document summary (2-3 sentences)
   
   Respond with JSON:
   {
     \"documentTitle\": \"...\",
     \"documentSummary\": \"...\",
     \"steps\": [
       { \"index\": 1, \"suggestedTitle\": \"...\" | null, \"rewrittenDescription\": \"...\" }
     ]
   }
   
   User's answers to your questions:
   [{ \"id\": \"q1\", \"answer\": \"...\" }]"

Messages:
  Same document payload as the question phase
```

**Diff view:**
- Side-by-side panels per step: current text on the left, Claude's rewrite on the right
- Green highlighting for new/changed text, red for removed text (block-level comparison, not a full diff algorithm)
- Accept/Reject buttons per step, plus "Accept All" / "Reject All" at the top
- If Claude suggests a title and the user accepts it, set `titleManuallyEdited` to true

**Progress:**
- The rewrite API call returns a complete JSON response (not streamed, since partial JSON cannot be parsed incrementally). Show a progress indicator ("Generating rewrite...") while waiting. Once the full response arrives, populate the diff view for all steps at once

### Error Handling

- API failure: show error message + "Retry" button. Never lose the user's current work
- Missing API key: show message explaining how to set ANTHROPIC_API_KEY. Do not crash
- 120-second timeout per API call with progress indicator ("Analyzing document..." / "Generating rewrite...")
- Screenshots >20MB after base64: downscale to fit, log a warning

### Memory Update After Review

After the user accepts/rejects and closes the review flow, update `claude_memory.json`:
- Add confirmed/corrected terminology to `terminologyPreferences`
- Add Q&A pairs to `previousDecisions`
- Update `softwareBeingDocumented` and `targetAudience` if the user provided new info
- Update `styleNotes` based on accept/reject patterns (e.g., consistently rejecting tips suggests the user prefers concise text)

### Vision API Image Handling

When preparing screenshots for the Claude API, apply `cropRect` first (crop the original to the framed area), then resize the cropped result to a max of 1568px on the longest side for the API payload. This is a temporary in-memory operation only. The preview and all export formats apply `cropRect` on the fly from the original full-resolution screenshot. Never create separate cropped files on disk. Never downscale the source files.

For the full-document review, send annotated screenshots (with the red selection rect drawn on a copy, same as the existing per-step flow in `claude.ts`). Reuse the existing annotation logic rather than duplicating it.

---

## Codebase Conventions

Follow these existing patterns:

- IPC channels: defined in `src/shared/ipc-channels.ts`. Add new channels for: image crop (`image:crop`), full-document Claude review (`claude:document-review`, `claude:document-rewrite`), and memory file operations (`claude:memory-load`, `claude:memory-save`). Follow the existing naming pattern
- Types/interfaces: defined in `src/shared/types.ts`
- Zustand stores: `src/renderer/stores/`
- React hooks: `src/renderer/hooks/`
- Preload bridge: add new IPC methods to `src/preload/preload.ts` for every new channel
- File paths: always use `path.join()`, no hardcoded separators
- Build verification: `npm run build` (runs `electron-vite build`) and `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` must pass after changes
- No large data to stdout (base64 strings, full API responses). Write to files or log summaries only

---

## Verification

After all four features are complete:
- Build passes: `npm run build` and `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` all return 0 errors
- Existing functionality is unbroken: recording, toolbar, step capture, per-step Claude rewrite (interactive and batch), export, save/load, autosave
- The two-step capture overlay works: crop overlay (blue/cyan) appears first, highlight overlay (red) appears second, both can be skipped independently
- Session JSON and .xtoolpath files round-trip correctly with the new Step fields (cropRect, title, titleManuallyEdited, displayWidth, displayHeight)
- Bump `schemaVersion` in ProjectFile and AutosaveSnapshot to account for the new Step fields
- Old project files missing the new fields load gracefully with defaults (cropRect = null, title = "Step {index}", titleManuallyEdited = false, display dimensions = cropped area or original)
