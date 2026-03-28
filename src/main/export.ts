import { join, dirname, basename, extname, relative } from 'path'
import { readFileSync, mkdirSync, existsSync, copyFileSync, writeFileSync } from 'fs'
import { BrowserWindow, nativeImage } from 'electron'
import type { ProjectFile, Step, Rect } from '../shared/types'
import * as stateBus from './state-bus'

// ── Project save/load ──

export async function saveProject(filePath: string): Promise<void> {
  const state = stateBus.getState()
  const projectDir = dirname(filePath)
  const projectName = basename(filePath, extname(filePath))
  const assetsDir = join(projectDir, `${projectName}_assets`, 'captures')

  mkdirSync(assetsDir, { recursive: true })

  // Copy screenshots and build steps with relative paths
  const steps: Step[] = state.steps.map((step) => {
    const screenshotName = basename(step.screenshot)
    const destPath = join(assetsDir, screenshotName)

    if (existsSync(step.screenshot)) {
      copyFileSync(step.screenshot, destPath)
    }

    const relPath = relative(projectDir, destPath).replace(/\\/g, '/')
    return { ...step, screenshot: relPath }
  })

  const project: ProjectFile = {
    schemaVersion: 2,
    title: projectName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps,
    assetBasePath: relative(projectDir, dirname(assetsDir)).replace(/\\/g, '/')
  }

  writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8')
  console.log('[export] Project saved: %s (%d steps)', filePath, steps.length)
}

export async function loadProject(filePath: string): Promise<ProjectFile> {
  const raw = readFileSync(filePath, 'utf-8')
  const project: ProjectFile = JSON.parse(raw)
  const projectDir = dirname(filePath)

  if (!project.schemaVersion || project.schemaVersion > 2) {
    throw new Error(`Unsupported schema version: ${project.schemaVersion}`)
  }

  // Resolve relative screenshot paths to absolute and migrate v1 steps
  project.steps = project.steps.map((step, i) => ({
    ...step,
    screenshot: join(projectDir, step.screenshot.replace(/\//g, '\\')),
    // v1/v2 migration: add defaults for new fields
    cropRect: step.cropRect ?? null,
    title: step.title || `Step ${i + 1}`,
    titleManuallyEdited: step.titleManuallyEdited ?? false
  }))

  console.log('[export] Project loaded: %s (%d steps)', filePath, project.steps.length)
  return project
}

// ── Markdown export ──

export async function exportMarkdown(outputPath: string): Promise<void> {
  const state = stateBus.getState()
  const outputDir = dirname(outputPath)
  const capturesDir = join(outputDir, 'captures')
  mkdirSync(capturesDir, { recursive: true })

  const lines: string[] = ['# XOVR Toolpath Documentation', '']

  for (const step of state.steps) {
    const screenshotName = basename(step.screenshot)
    const destPath = join(capturesDir, screenshotName)

    if (existsSync(step.screenshot)) {
      copyFileSync(step.screenshot, destPath)
    }

    const stepTitle = step.title || `Step ${step.index + 1}`
    const imgPath = screenshotName
    lines.push(`## ${stepTitle}`)
    lines.push('')
    lines.push(`![${stepTitle} screenshot](captures/${imgPath})`)
    lines.push('')
    lines.push(step.editedText || step.rawTranscript || '_No text_')
    lines.push('')
  }

  writeFileSync(outputPath, lines.join('\n'), 'utf-8')
  console.log('[export] Markdown exported: %s', outputPath)
}

// ── HTML generation (shared by HTML export and PDF) ──

function generateHtml(steps: Step[]): string {
  const tocEntries = steps.map((s) => {
    const title = s.title || `Step ${s.index + 1}`
    return `<li><a href="#step-${s.index + 1}">${escapeHtml(title)}</a></li>`
  }).join('\n      ')

  const stepSections = steps.map((step) => {
    const stepTitle = step.title || `Step ${step.index + 1}`
    let imgSrc = ''
    let imgWidth = 0
    let imgHeight = 0
    try {
      if (existsSync(step.screenshot)) {
        const ext = extname(step.screenshot).toLowerCase()
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
        const data = readFileSync(step.screenshot).toString('base64')
        imgSrc = `data:${mime};base64,${data}`

        const img = nativeImage.createFromPath(step.screenshot)
        const size = img.getSize()
        imgWidth = size.width
        imgHeight = size.height
      }
    } catch { /* skip missing screenshots */ }

    const text = step.editedText || step.rawTranscript || ''

    // Determine visible region (crop or full)
    const crop = step.cropRect
    const viewX = crop ? crop.x : 0
    const viewY = crop ? crop.y : 0
    const viewW = crop ? crop.width : imgWidth
    const viewH = crop ? crop.height : imgHeight

    // Highlight rect translated to cropped coordinates
    const selectionOverlay = step.selectionRect && viewW > 0
      ? renderSelectionSvg(
          {
            ...step.selectionRect,
            x: step.selectionRect.x - viewX,
            y: step.selectionRect.y - viewY
          },
          viewW, viewH
        )
      : ''

    let imgHtml = ''
    if (imgSrc && crop && imgWidth > 0) {
      // Cropped: use overflow:hidden wrapper with offset image
      // Scale crop to fit max 800px wide for export
      const scale = Math.min(1, 800 / crop.width)
      const dispW = Math.round(crop.width * scale)
      const dispH = Math.round(crop.height * scale)
      const fullW = Math.round(imgWidth * scale)
      const fullH = Math.round(imgHeight * scale)
      const offX = Math.round(crop.x * scale)
      const offY = Math.round(crop.y * scale)
      imgHtml = `<div class="img-container" style="position:relative;overflow:hidden;width:${dispW}px;height:${dispH}px;">
        <img src="${imgSrc}" alt="${escapeHtml(stepTitle)}" style="position:absolute;top:${-offY}px;left:${-offX}px;width:${fullW}px;height:${fullH}px;max-width:none;max-height:none;" />
        ${selectionOverlay}
      </div>`
    } else if (imgSrc) {
      imgHtml = `<div class="img-container">
        <img src="${imgSrc}" alt="${escapeHtml(stepTitle)}" />
        ${selectionOverlay}
      </div>`
    }

    return `
    <div class="step" id="step-${step.index + 1}">
      <h2>${escapeHtml(stepTitle)}</h2>
      ${imgHtml}
      <p>${escapeHtml(text)}</p>
    </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>XOVR Toolpath Documentation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 32px 24px; color: #1f2937; line-height: 1.6; }
    h1 { font-size: 24px; margin-bottom: 16px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
    nav { margin-bottom: 32px; }
    nav h3 { font-size: 14px; color: #6b7280; margin-bottom: 8px; }
    nav ol { padding-left: 20px; }
    nav li { margin-bottom: 4px; font-size: 14px; }
    nav a { color: #2563eb; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    .step { margin-bottom: 40px; }
    .step h2 { font-size: 18px; margin-bottom: 12px; color: #374151; }
    .img-container { position: relative; display: inline-block; margin-bottom: 12px; }
    .img-container img { max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 4px; display: block; }
    .selection-overlay { position: absolute; top: 0; left: 0; pointer-events: none; }
    .step p { font-size: 15px; white-space: pre-wrap; }
    @media print { body { max-width: none; padding: 16px; } .step { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>XOVR Toolpath Documentation</h1>
  <nav>
    <h3>Table of Contents</h3>
    <ol>
      ${tocEntries}
    </ol>
  </nav>
  ${stepSections}
</body>
</html>`
}

function renderSelectionSvg(rect: Rect, imgWidth: number, imgHeight: number): string {
  const strokeWidth = Math.max(3, Math.round(Math.max(imgWidth, imgHeight) / 400))
  return `<svg class="selection-overlay" width="100%" height="100%" viewBox="0 0 ${imgWidth} ${imgHeight}" preserveAspectRatio="xMinYMin meet">
    <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="none" stroke="red" stroke-width="${strokeWidth}" />
  </svg>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br />')
}

// ── HTML export ──

export async function exportHtml(outputPath: string): Promise<void> {
  const state = stateBus.getState()
  const html = generateHtml(state.steps)
  writeFileSync(outputPath, html, 'utf-8')
  console.log('[export] HTML exported: %s', outputPath)
}

// ── PDF export ──

export async function exportPdf(outputPath: string): Promise<void> {
  const state = stateBus.getState()
  const html = generateHtml(state.steps)

  // Write HTML to temp file (avoids data URL length limits)
  const { tmpdir } = await import('os')
  const tempHtmlPath = join(tmpdir(), `xovr-export-${Date.now()}.html`)
  writeFileSync(tempHtmlPath, html, 'utf-8')

  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { offscreen: true }
  })

  try {
    await win.loadFile(tempHtmlPath)

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    })

    writeFileSync(outputPath, pdfBuffer)
    console.log('[export] PDF exported: %s (%d bytes)', outputPath, pdfBuffer.length)
  } finally {
    win.destroy()
    try { const { unlinkSync } = await import('fs'); unlinkSync(tempHtmlPath) } catch { /* ignore */ }
  }
}
