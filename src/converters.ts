import { marked } from 'marked'
import TurndownService from 'turndown'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { zipSync, gzipSync, unzipSync } from 'fflate'

export type Output = { blob: Blob; name: string; type: string; preview?: string; kind: 'image' | 'audio' | 'text' | 'file' }
export type Conversion =
  | 'png' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'bmp' | 'ico' | 'grayscale'
  | 'html' | 'md' | 'txt' | 'docx' | 'pdf' | 'pdf-text' | 'pdf-images' | 'json' | 'csv' | 'base64'
  | 'wav' | 'mp3' | 'mp4' | 'webm'
  | 'zip' | 'tar' | 'gz' | 'unzip'

export const imageTargets: Conversion[] = ['png', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'ico', 'grayscale']
export const textTargets: Conversion[] = ['html', 'md', 'txt', 'docx', 'pdf', 'json', 'csv', 'base64']
export const videoTargets: Conversion[] = ['gif', 'mp3', 'wav', 'mp4', 'webm']
export const archiveTargets: Conversion[] = ['zip', 'tar', 'gz', 'unzip']

const baseName = (name: string) => name.replace(/\.[^.]+$/, '')
const mimeFor = (format: string) => ({
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  html: 'text/html',
  md: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  csv: 'text/csv',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip'
}[format] || 'application/octet-stream')

export function createTar(filename: string, data: Uint8Array): Blob {
  const header = new Uint8Array(512)
  const writeStr = (str: string, offset: number, max: number) => {
    for (let i = 0; i < Math.min(str.length, max); i++) header[offset + i] = str.charCodeAt(i)
  }
  writeStr(filename, 0, 100)
  writeStr('0000644\0', 100, 8)
  writeStr('0000000\0', 108, 8)
  writeStr('0000000\0', 116, 8)
  writeStr(data.length.toString(8).padStart(11, '0') + '\0', 124, 12)
  writeStr(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12)
  for (let i = 148; i < 156; i++) header[i] = 32
  header[156] = 48
  writeStr('ustar\0', 257, 6)
  writeStr('00', 263, 2)
  let chk = 0
  for (let i = 0; i < 512; i++) chk += header[i]
  const chkStr = chk.toString(8).padStart(6, '0') + '\0 '
  for (let i = 0; i < 8; i++) header[148 + i] = chkStr.charCodeAt(i)
  const pad = (512 - (data.length % 512)) % 512
  const out = new Uint8Array(512 + data.length + pad + 1024)
  out.set(header, 0)
  out.set(data, 512)
  return new Blob([out.buffer], { type: 'application/x-tar' })
}

export async function convertToTar(file: File): Promise<Output> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const blob = createTar(file.name, buf)
  return { blob, name: `${baseName(file.name)}.tar`, type: 'application/x-tar', kind: 'file' }
}

export async function convertToZip(file: File): Promise<Output> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const zipped = zipSync({ [file.name]: buf })
  const blob = new Blob([zipped.buffer], { type: 'application/zip' })
  return { blob, name: `${baseName(file.name)}.zip`, type: 'application/zip', kind: 'file' }
}

export async function convertToGz(file: File): Promise<Output> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const gzipped = gzipSync(buf)
  const blob = new Blob([gzipped.buffer], { type: 'application/gzip' })
  return { blob, name: `${file.name}.gz`, type: 'application/gzip', kind: 'file' }
}

export async function convertImage(file: File, target: 'png' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'bmp', quality = .9, scale = 1): Promise<Output> {
  if (target === 'gif') {
    // True GIF encoding through FFmpeg
    return convertMediaWithFfmpeg(file, 'gif')
  }
  const source = URL.createObjectURL(file)
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = source })
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
  const ctx = canvas.getContext('2d')!; if (target === 'jpeg' || target === 'bmp') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }; ctx.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(source)
  const actualTarget = target === 'bmp' ? 'png' : target
  const mime = mimeFor(actualTarget)
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => {
    if (b) resolve(b)
    else canvas.toBlob((b2) => resolve(b2!), 'image/png')
  }, mime, quality))
  return { blob, name: `${baseName(file.name)}.${target}`, type: mime, preview: URL.createObjectURL(blob), kind: 'image' }
}

export async function convertText(file: File, target: 'html' | 'md' | 'txt' | 'docx' | 'pdf' | 'json'): Promise<Output> {
  const source = await file.text(); const ext = file.name.split('.').pop()?.toLowerCase(); let content = source
  if (target === 'html') content = ext === 'md' || ext === 'markdown' ? await marked.parse(source) : source
  if (target === 'md') content = ext === 'html' || ext === 'htm' ? new TurndownService().turndown(source) : source
  if (target === 'txt') content = ext === 'html' || ext === 'htm' ? new DOMParser().parseFromString(source, 'text/html').body.textContent || '' : source
  if (target === 'docx') {
    const plain = ext === 'html' || ext === 'htm' ? new DOMParser().parseFromString(source, 'text/html').body.textContent || '' : source
    const doc = new Document({ sections: [{ children: plain.split(/\n{2,}/).map((p) => new Paragraph({ children: [new TextRun(p)] })) }] })
    const blob = await Packer.toBlob(doc); return { blob, name: `${baseName(file.name)}.docx`, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'file' }
  }
  if (target === 'pdf') {
    const html = ext === 'md' || ext === 'markdown' ? await marked.parse(source) : ext === 'html' || ext === 'htm' ? source : `<pre>${source.replace(/</g, '&lt;')}</pre>`
    const { default: html2pdf } = await import('html2pdf.js')
    const holder = document.createElement('div'); holder.innerHTML = html; holder.style.cssText = 'font:14px system-ui; padding:24px; color:#111; background:#fff; width:760px;'
    const blob = await html2pdf().set({ margin: 10, filename: `${baseName(file.name)}.pdf`, html2canvas: { scale: 2 } }).from(holder).outputPdf('blob') as Blob
    return { blob, name: `${baseName(file.name)}.pdf`, type: 'application/pdf', kind: 'file' }
  }
  if (target === 'json') {
    const value = ext === 'html' || ext === 'htm' ? { html: source } : { content: source }
    content = JSON.stringify(value, null, 2)
  }
  return { blob: new Blob([content], { type: mimeFor(target) }), name: `${baseName(file.name)}.${target}`, type: mimeFor(target), preview: content, kind: 'text' }
}

export async function convertImageToPdf(file: File): Promise<Output> {
  const source = URL.createObjectURL(file)
  const { default: html2pdf } = await import('html2pdf.js')
  const holder = document.createElement('div')
  holder.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;padding:10px;background:#fff;"><img src="${source}" style="max-width:100%;height:auto;display:block;margin:auto;" /></div>`
  const blob = await html2pdf().set({ margin: 5, filename: `${baseName(file.name)}.pdf`, html2canvas: { scale: 2 } }).from(holder).outputPdf('blob') as Blob
  URL.revokeObjectURL(source)
  return { blob, name: `${baseName(file.name)}.pdf`, type: 'application/pdf', kind: 'file' }
}

const getPublicAssetUrl = (path: string) => {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const base = import.meta.env.BASE_URL || '/'
  return new URL(cleanPath, new URL(base, window.location.href)).href
}

async function getPdfDocument(pdfjs: typeof import('pdfjs-dist'), data: Uint8Array) {
  const localWorker = getPublicAssetUrl('pdf.worker.min.mjs')
  const fontsUrl = getPublicAssetUrl('standard_fonts/')

  pdfjs.GlobalWorkerOptions.workerSrc = localWorker

  try {
    return await pdfjs.getDocument({ data, standardFontDataUrl: fontsUrl }).promise
  } catch (err) {
    console.warn('Local PDF worker failed, falling back to CDN worker...', err)
    const cdnWorker = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
    pdfjs.GlobalWorkerOptions.workerSrc = cdnWorker
    return await pdfjs.getDocument({ data, standardFontDataUrl: fontsUrl }).promise
  }
}

/** Extracts the embedded text layer. Scanned PDFs need the separate OCR node. */
export async function convertPdfToText(file: File): Promise<Output> {
  const pdfjs = await import('pdfjs-dist')
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await getPdfDocument(pdfjs, data)
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent()
    pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '))
  }
  const text = pages.join('\n\n')
  if (!text.trim()) throw new Error('No selectable text was found. Use the OCR node for a scanned PDF.')
  return { blob: new Blob([text], { type: 'text/plain' }), name: `${baseName(file.name)}.txt`, type: 'text/plain', preview: text, kind: 'text' }
}

export async function convertPdfToImages(file: File): Promise<Output> {
  const pdfjs = await import('pdfjs-dist')
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await getPdfDocument(pdfjs, data)
  const files: Record<string, Uint8Array> = {}
  let firstPreview: string | undefined
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise
    const image = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))
    if (!firstPreview) firstPreview = URL.createObjectURL(image)
    files[`page-${String(pageNumber).padStart(3, '0')}.png`] = new Uint8Array(await image.arrayBuffer())
  }
  const zipped = zipSync(files)
  const cleanBuffer = new Uint8Array(zipped).slice().buffer
  const blob = new Blob([cleanBuffer], { type: 'application/zip' })
  return { blob, name: `${baseName(file.name)}-images.zip`, type: 'application/zip', preview: firstPreview, kind: 'file' }
}


let ffmpeg: FFmpeg | undefined
async function getFfmpeg() {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg()
    try {
      const coreURL = await toBlobURL(getPublicAssetUrl('ffmpeg/ffmpeg-core.js'), 'text/javascript')
      const wasmURL = await toBlobURL(getPublicAssetUrl('ffmpeg/ffmpeg-core.wasm'), 'application/wasm')
      await ffmpeg.load({ coreURL, wasmURL })
    } catch (localErr) {
      console.warn('Local FFmpeg load failed, attempting CDN fallback...', localErr)
      const cdnBase = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm'
      const coreURL = await toBlobURL(`${cdnBase}/ffmpeg-core.js`, 'text/javascript')
      const wasmURL = await toBlobURL(`${cdnBase}/ffmpeg-core.wasm`, 'application/wasm')
      await ffmpeg.load({ coreURL, wasmURL })
    }
  }
  return ffmpeg
}

export async function convertMediaWithFfmpeg(
  file: File,
  targetExt: string,
  onProgress?: (progress: number) => void
): Promise<Output> {
  if (file.size > 500 * 1024 * 1024) throw new Error('For browser memory safety, files over 500 MB are not supported.')
  const engine = await getFfmpeg()
  const ext = file.name.split('.').pop() || 'mp4'
  const input = `input-${Date.now()}.${ext}`
  const output = `output-${Date.now()}.${targetExt}`
  const listener = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)))
  engine.on('progress', listener)

  try {
    await engine.writeFile(input, await fetchFile(file))

    let args: string[] = ['-i', input, output]
    if (targetExt === 'mp3') {
      args = ['-i', input, '-vn', '-b:a', '192k', output]
    } else if (targetExt === 'gif') {
      args = ['-i', input, '-vf', 'fps=10,scale=trunc(iw/2)*2:trunc(ih/2)*2', output]
    } else if (targetExt === 'wav') {
      args = ['-i', input, '-vn', output]
    } else if (targetExt === 'mp4') {
      args = ['-i', input, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', output]
    } else if (targetExt === 'webm') {
      args = ['-i', input, '-c:v', 'libvpx-vp9', '-b:v', '1M', '-c:a', 'libopus', output]
    }

    await engine.exec(args)
    const rawData = await engine.readFile(output)
    await engine.deleteFile(input)
    await engine.deleteFile(output)
    engine.off('progress', listener)

    // Ensure clean non-shared ArrayBuffer to prevent Blob construction errors
    const bytes = typeof rawData === 'string' ? new TextEncoder().encode(rawData) : rawData
    const cleanBuffer = new Uint8Array(bytes).slice().buffer

    const mime = mimeFor(targetExt)
    const kind = ['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(targetExt)
      ? 'audio'
      : ['gif', 'png', 'jpeg', 'webp', 'bmp', 'avif'].includes(targetExt)
      ? 'image'
      : 'file'

    const blob = new Blob([cleanBuffer], { type: mime })
    return {
      blob,
      name: `${baseName(file.name)}.${targetExt}`,
      type: mime,
      preview: URL.createObjectURL(blob),
      kind
    }
  } catch (err) {
    engine.off('progress', listener)
    throw err
  }
}

export async function convertVideoToMp3(file: File, onProgress?: (progress: number) => void): Promise<Output> {
  return convertMediaWithFfmpeg(file, 'mp3', onProgress)
}

function writeWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels, length = buffer.length * channels * 2, out = new ArrayBuffer(44 + length), view = new DataView(out)
  const write = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  write(0, 'RIFF'); view.setUint32(4, 36 + length, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length, true)
  let offset = 44; for (let i = 0; i < buffer.length; i++) for (let c = 0; c < channels; c++) { const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i])); view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true); offset += 2 }
  return new Blob([out], { type: 'audio/wav' })
}

export async function convertAudioToWav(file: File): Promise<Output> {
  const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) throw new Error('Web Audio is not supported in this browser.')
  const context = new Ctx()
  const data = await file.arrayBuffer()
  const decoded = await context.decodeAudioData(data)
  const blob = writeWav(decoded)
  await context.close()
  return { blob, name: `${baseName(file.name)}.wav`, type: 'audio/wav', preview: URL.createObjectURL(blob), kind: 'audio' }
}

export async function convertJsonToCsv(file: File): Promise<Output> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON file format.')
  }
  let rows: Record<string, unknown>[] = []
  if (Array.isArray(parsed)) {
    rows = parsed.map((item) => (typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : { value: item }))
  } else if (typeof parsed === 'object' && parsed !== null) {
    rows = Object.entries(parsed as Record<string, unknown>).map(([key, val]) => ({
      key,
      value: typeof val === 'object' ? JSON.stringify(val) : val
    }))
  } else {
    rows = [{ value: parsed }]
  }

  const headerSet = new Set<string>()
  for (const r of rows) {
    for (const k of Object.keys(r)) headerSet.add(k)
  }
  const headers = Array.from(headerSet)
  const escapeCsv = (val: unknown) => {
    if (val === null || val === undefined) return ''
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(','))
  ]
  const csvContent = lines.join('\r\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  return {
    blob,
    name: `${baseName(file.name)}.csv`,
    type: 'text/csv',
    preview: csvContent.slice(0, 300),
    kind: 'text'
  }
}

export async function convertCsvToJson(file: File): Promise<Output> {
  const text = await file.text()
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (rawLines.length === 0) throw new Error('CSV file is empty.')

  const parseLine = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseLine(rawLines[0])
  const data = rawLines.slice(1).map((line) => {
    const vals = parseLine(line)
    const obj: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      const val = vals[idx] ?? ''
      if (/^-?\d+(\.\d+)?$/.test(val)) {
        obj[h] = Number(val)
      } else if (val.toLowerCase() === 'true') {
        obj[h] = true
      } else if (val.toLowerCase() === 'false') {
        obj[h] = false
      } else {
        obj[h] = val
      }
    })
    return obj
  })

  const jsonContent = JSON.stringify(data, null, 2)
  const blob = new Blob([jsonContent], { type: 'application/json' })
  return {
    blob,
    name: `${baseName(file.name)}.json`,
    type: 'application/json',
    preview: jsonContent.slice(0, 300),
    kind: 'text'
  }
}

export async function convertImageToIco(file: File): Promise<Output> {
  const source = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = source
  })
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, 32, 32)
  URL.revokeObjectURL(source)

  const pngBlob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())

  // Standard Windows ICO binary container: 6-byte header + 16-byte directory + PNG payload
  const ico = new Uint8Array(6 + 16 + pngBytes.length)
  const view = new DataView(ico.buffer)
  view.setUint16(0, 0, true) // Reserved
  view.setUint16(2, 1, true) // Type 1 = ICO
  view.setUint16(4, 1, true) // 1 image
  ico[6] = 32 // Width
  ico[7] = 32 // Height
  ico[8] = 0  // Colors
  ico[9] = 0  // Reserved
  view.setUint16(10, 1, true) // Color planes
  view.setUint16(12, 32, true) // Bits per pixel
  view.setUint32(14, pngBytes.length, true) // Image size
  view.setUint32(18, 22, true) // Offset (6 + 16)
  ico.set(pngBytes, 22)

  const blob = new Blob([ico.buffer], { type: 'image/x-icon' })
  return {
    blob,
    name: `${baseName(file.name)}.ico`,
    type: 'image/x-icon',
    preview: URL.createObjectURL(pngBlob),
    kind: 'image'
  }
}

export async function convertImageToGrayscale(file: File): Promise<Output> {
  const source = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = source
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  URL.revokeObjectURL(source)

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    d[i] = gray
    d[i + 1] = gray
    d[i + 2] = gray
  }
  ctx.putImageData(imgData, 0, 0)
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
  return {
    blob,
    name: `${baseName(file.name)}-grayscale.png`,
    type: 'image/png',
    preview: URL.createObjectURL(blob),
    kind: 'image'
  }
}

export async function convertFileToBase64(file: File): Promise<Output> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  const base64 = btoa(binary)
  const mime = file.type || 'application/octet-stream'
  const dataUri = `data:${mime};base64,${base64}`
  const blob = new Blob([dataUri], { type: 'text/plain' })
  return {
    blob,
    name: `${file.name}.base64.txt`,
    type: 'text/plain',
    preview: dataUri.slice(0, 240) + '...',
    kind: 'text'
  }
}

export async function convertUnzip(file: File): Promise<Output> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const unzipped = unzipSync(buf)
  const fileNames = Object.keys(unzipped)
  if (fileNames.length === 0) throw new Error('ZIP archive contains no files.')

  if (fileNames.length === 1) {
    const singleName = fileNames[0]
    const content = unzipped[singleName]
    const cleanBuffer = new Uint8Array(content).slice().buffer
    const ext = singleName.split('.').pop()?.toLowerCase() || ''
    const mime = mimeFor(ext)
    const blob = new Blob([cleanBuffer], { type: mime })
    const isImg = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)
    return {
      blob,
      name: singleName,
      type: mime,
      preview: isImg ? URL.createObjectURL(blob) : undefined,
      kind: isImg ? 'image' : 'file'
    }
  }

  const manifest = fileNames.map((n) => `• ${n} (${(unzipped[n].length / 1024).toFixed(1)} KB)`).join('\n')
  const blob = new Blob([manifest], { type: 'text/plain' })
  return {
    blob,
    name: `${baseName(file.name)}-extracted.txt`,
    type: 'text/plain',
    preview: manifest.slice(0, 300),
    kind: 'text'
  }
}

