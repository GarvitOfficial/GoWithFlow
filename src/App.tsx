import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { Check, CheckCircle2, Download, FileArchive, FileCode, FileText, FileUp, FolderArchive, Image as ImageIcon, Music2, Pin, Plus, Save, Search, Sparkles, Table, Upload, Video, X, Zap } from 'lucide-react'
import { archiveTargets, convertAudioToWav, convertCsvToJson, convertFileToBase64, convertImage, convertImageToGrayscale, convertImageToIco, convertImageToPdf, convertJsonToCsv, convertMediaWithFfmpeg, convertPdfToImages, convertPdfToText, convertText, convertToGz, convertToTar, convertToZip, convertUnzip, imageTargets, textTargets, videoTargets, type Conversion, type Output } from './converters'
import { saveAs } from 'file-saver'
import { catalog, catalogFormats } from './catalog'

type Status = 'idle' | 'processing' | 'done' | 'error'
type FlowData = {
  label: string
  type: 'input' | 'convert' | 'output'
  file?: File
  previewUrl?: string
  textPreview?: string
  target?: string
  status?: Status
  result?: Output
  error?: string
  onFile?: (f: File, id: string) => void
  onRun?: (id: string) => void
  onDownload?: (id: string) => void
}
type FlowNode = Node<FlowData>

export function GoWithFlowLogo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id="gwf-grad" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="50%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#111c33" stroke="#2a3d60" strokeWidth="1.5" />
      <path d="M22 11C20.5 9.2 18.2 8 15.5 8C11.35 8 8 11.58 8 16C8 20.42 11.35 24 15.5 24C19.64 24 23 20.6 23 16.5V15.5H16" stroke="url(#gwf-grad)" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 13L22 15.5L19 18" stroke="url(#gwf-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const fileKind = (f?: File) => {
  if (!f) return '—'
  if (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|ico|svg|tiff)$/i.test(f.name)) return 'image'
  if (f.type.startsWith('video/') || /\.(mp4|mkv|avi|mov|webm|flv)$/i.test(f.name)) return 'video'
  if (f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(f.name)) return 'audio'
  if (/\.csv$/i.test(f.name)) return 'csv'
  if (/\.json$/i.test(f.name)) return 'json'
  if (/\.pdf$/i.test(f.name)) return 'pdf'
  if (/\.(zip|tar|gz|tgz|rar|7z)$/i.test(f.name)) return 'archive'
  if (/\.(md|markdown|html|htm|txt|xml|js|ts|py)$/i.test(f.name) || f.type.startsWith('text/')) return 'text'
  return 'file'
}

const allowed = (kind: string): Conversion[] => {
  const archives: Conversion[] = ['zip', 'tar', 'gz']
  if (kind === 'image') return ['png', 'jpeg', 'webp', 'gif', 'ico', 'grayscale', 'pdf', 'base64', ...archives]
  if (kind === 'text') return ['md', 'txt', 'html', 'json', 'csv', 'docx', 'pdf', 'base64', ...archives]
  if (kind === 'csv') return ['json', 'txt', 'html', 'pdf', 'base64', ...archives]
  if (kind === 'json') return ['csv', 'txt', 'html', 'pdf', 'base64', ...archives]
  if (kind === 'audio') return ['wav', 'mp3', 'base64', ...archives]
  if (kind === 'video') return ['gif', 'mp3', 'wav', 'mp4', 'webm', 'base64', ...archives]
  if (kind === 'pdf') return ['pdf-text', 'pdf-images', 'png', 'jpeg', 'txt', 'docx', 'base64', ...archives]
  if (kind === 'archive') return ['unzip', 'zip', 'tar', 'gz']
  return ['pdf', 'png', 'jpeg', 'webp', 'gif', 'ico', 'csv', 'json', 'mp3', 'wav', 'zip', 'tar', 'gz', 'base64']
}

const labelFor = (format: string) => {
  if (format === 'md') return 'Markdown'
  if (format === 'txt') return 'Plain text'
  if (format === 'csv') return 'CSV Spreadsheet'
  if (format === 'json') return 'JSON Data'
  if (format === 'ico') return 'Favicon (.ico)'
  if (format === 'grayscale') return 'Grayscale B&W'
  if (format === 'base64') return 'Base64 Text'
  if (format === 'unzip') return 'Extract ZIP'
  if (format === 'pdf-text') return 'PDF to Text'
  if (format === 'pdf-images') return 'PDF to Images'
  if (format === 'zip') return 'ZIP Archive'
  if (format === 'tar') return 'TAR Archive'
  if (format === 'gz') return 'GZ Compressed'
  if (format === 'gif') return 'GIF Animation'
  if (format === 'mp3') return 'MP3 Audio'
  if (format === 'wav') return 'WAV Audio'
  if (format === 'docx') return 'Word (.docx)'
  return format.toUpperCase()
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const isExperimental = (format: string) => format === 'bmp' || format === 'avif'
const catalogTarget = (format: string) =>
  format === 'PDF → text' ? 'pdf-text' :
  format === 'PDF → images' ? 'pdf-images' :
  format === 'Image → text' ? 'ocr-image' :
  format === 'ICO' ? 'ico' :
  format === 'CSV' ? 'csv' :
  format.toLowerCase().replace(/\s.*/, '')

function Card({ data, id }: NodeProps<FlowNode>) {
  const result = data.result
  const isDone = data.status === 'done' || (data.type === 'input' && !!data.file) || (data.type === 'output' && !!result)

  return (
    <div className={`card ${data.status || 'idle'} ${data.type}`}>
      {data.type !== 'input' && <Handle type="target" position={Position.Left} />}
      <div className="card-top">
        <span className="node-icon">
          {data.type === 'input' ? <FileUp size={16} /> :
           data.type === 'output' ? <Download size={16} /> :
           data.target === 'wav' || data.target === 'mp3' ? <Music2 size={16} /> :
           data.target === 'zip' || data.target === 'tar' || data.target === 'unzip' || data.target === 'gz' ? <FileArchive size={16} /> :
           data.target === 'pdf' || data.target === 'docx' || data.target === 'pdf-text' ? <FileText size={16} /> :
           data.target === 'csv' || data.target === 'json' ? <Table size={16} /> :
           data.target === 'base64' ? <FileCode size={16} /> :
           data.target === 'png' || data.target === 'jpeg' || data.target === 'webp' || data.target === 'ico' || data.target === 'grayscale' || data.target === 'pdf-images' ? <ImageIcon size={16} /> :
           data.target === 'gif' || data.target === 'mp4' || data.target === 'webm' ? <Video size={16} /> :
           <Zap size={16} />}
        </span>
        <b>{data.label}</b>
        {isDone && (
          <span className="done-tick" title={data.type === 'input' ? 'File uploaded & ready' : data.type === 'output' ? 'File ready to save' : 'Conversion completed successfully'}>
            <Check size={12} strokeWidth={3} /> {data.type === 'input' ? 'Ready' : data.type === 'output' ? 'Ready' : 'Done'}
          </span>
        )}
        {data.type === 'output' && <span className="pin-tag"><Pin size={10}/> Pin</span>}
        <span className="status-dot" />
      </div>

      {data.type === 'input' && (
        <>
          <label className="dropzone">
            <Upload size={17}/>
            <span>{data.file ? data.file.name : 'Drop a file or browse'}</span>
            <input type="file" onChange={(e) => e.target.files?.[0] && data.onFile?.(e.target.files[0], id)} />
          </label>
          {data.file && (
            <div className="done-banner">
              <CheckCircle2 size={13} />
              <span>Uploaded · {formatSize(data.file.size)}</span>
            </div>
          )}
          {data.previewUrl && (data.file?.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|ico|svg)$/i.test(data.file?.name || '')) && (
            <img className="preview" src={data.previewUrl} alt="Uploaded preview" />
          )}
          {data.previewUrl && (data.file?.type.startsWith('video/') || /\.(mp4|webm)$/i.test(data.file?.name || '')) && (
            <video className="preview" controls src={data.previewUrl} />
          )}
          {data.previewUrl && (data.file?.type.startsWith('audio/') || /\.(mp3|wav|ogg)$/i.test(data.file?.name || '')) && (
            <audio className="audio" controls src={data.previewUrl} />
          )}
          {data.textPreview && (
            <div className="text-preview"><b>Source Preview</b>{data.textPreview.slice(0, 150)}</div>
          )}
          {data.file && !data.previewUrl && !data.textPreview && (
            <div className="file-preview-card">
              {data.file.name.endsWith('.pdf') ? <FileText size={16} /> : <FileArchive size={16} />}
              <span>{data.file.name}</span>
              <small>{formatSize(data.file.size)}</small>
            </div>
          )}
        </>
      )}

      {data.type === 'convert' && (
        <>
          <div className="conversion">Convert to <strong>{labelFor(data.target || '')}</strong></div>
          {data.target === 'bmp' && <div className="hint">Experimental: exported as PNG payload</div>}
          {data.target === 'pdf-text' && <div className="hint">Extracts selectable text layer</div>}
          {data.target === 'ico' && <div className="hint">Generates 32x32 Favicon icon</div>}
          {data.target === 'csv' && <div className="hint">Transforms structured rows into CSV</div>}
          {data.target === 'json' && <div className="hint">Transforms CSV into JSON data</div>}
          <button className="run" onClick={() => data.onRun?.(id)} disabled={data.status === 'processing'}>
            {data.status === 'processing' ? 'Converting…' : 'Run conversion'}
          </button>
        </>
      )}

      {data.type === 'output' && (
        <>
          <div className="conversion">{result ? `Ready: ${result.name}` : 'Connect a converter or file node'}</div>
          <button className="run" onClick={() => data.onDownload?.(id)} disabled={!result}>
            <Download size={14} style={{ display: 'inline', marginRight: 4 }} />
            {result ? `Save ${result.name}` : 'Waiting for input'}
          </button>
        </>
      )}

      {data.status === 'processing' && <div className="progress"><i /></div>}
      {data.status === 'error' && <div className="error-text">{data.error}</div>}

      {data.type !== 'input' && result && (
        <>
          <div className="done-banner">
            <CheckCircle2 size={13} />
            <span>{data.type === 'output' ? 'Ready to save' : 'Converted'} · {formatSize(result.blob.size)}</span>
          </div>
          {result.preview && (result.kind === 'image' || result.type === 'application/zip') && (
            <img className="preview" src={result.preview} alt="Converted preview" />
          )}
          {result.preview && (result.type.startsWith('video/') || result.name.match(/\.(mp4|webm)$/i)) && (
            <video className="preview" controls src={result.preview} />
          )}
          {result.kind === 'audio' && <audio className="audio" controls src={result.preview} />}
          {result.kind === 'text' && <div className="text-preview"><b>Preview</b>{result.preview?.slice(0, 160)}</div>}
          {result.kind === 'file' && result.type !== 'application/zip' && (
            <div className="file-preview-card">
              <FileArchive size={16} />
              <span>{result.name}</span>
              <small>{formatSize(result.blob.size)}</small>
            </div>
          )}
        </>
      )}

      {data.type !== 'output' && <Handle type="source" position={Position.Right} />}
    </div>
  )
}
const nodeTypes = { flow: Card }
const start: FlowNode[] = []

export function App() {
  const [nodes, setNodes] = useState<FlowNode[]>(start)
  const [edges, setEdges] = useState<Edge[]>([])
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState(false)
  const [wireMenu, setWireMenu] = useState<{ source: string; x: number; y: number } | null>(null)
  const [wireSearch, setWireSearch] = useState('')
  const counter = useRef(0)
  const nodesRef = useRef<FlowNode[]>([])
  const edgesRef = useRef<Edge[]>([])
  const mainRef = useRef<HTMLDivElement>(null)

  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { edgesRef.current = edges }, [edges])

  const kindForNode = (node?: FlowNode) =>
    node?.data.file ? fileKind(node.data.file) :
    node?.data.result?.kind === 'image' ? 'image' :
    node?.data.result?.kind === 'audio' ? 'audio' :
    node?.data.result?.kind === 'text' ? 'text' : 'file'

  const sourceFor = useCallback((id: string): { file?: File; output?: Output } => {
    const parent = edgesRef.current.find((e) => e.target === id)?.source
    if (!parent) return {}
    const node = nodesRef.current.find((n) => n.id === parent)
    return { file: node?.data.file, output: node?.data.result }
  }, [])

  const setFile = useCallback(async (file: File, id: string) => {
    let previewUrl: string | undefined
    let textPreview: string | undefined
    if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|ico|svg)$/i.test(file.name)) {
      previewUrl = URL.createObjectURL(file)
    } else if (file.type.startsWith('video/') || /\.(mp4|webm)$/i.test(file.name)) {
      previewUrl = URL.createObjectURL(file)
    } else if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg)$/i.test(file.name)) {
      previewUrl = URL.createObjectURL(file)
    } else if (/\.(md|markdown|html|htm|txt|json|csv|xml)$/i.test(file.name) || file.type.startsWith('text/')) {
      try {
        textPreview = await file.slice(0, 500).text()
      } catch { /* ignore */ }
    }
    setNodes((ns) => ns.map((n) => n.id === id ? { ...n, data: { ...n.data, file, previewUrl, textPreview, label: file.name, status: 'done' } } : n))
  }, [])

  const runNode = useCallback(async (id: string) => {
    const node = nodesRef.current.find((n) => n.id === id)
    if (!node || node.data.type !== 'convert' || !node.data.target) return
    const upstream = sourceFor(id)
    const input = upstream.file || (upstream.output ? new File([upstream.output.blob], upstream.output.name, { type: upstream.output.type }) : undefined)
    if (!input) return setNodes((ns) => ns.map((n) => n.id === id ? { ...n, data: { ...n.data, status: 'error', error: 'Connect an uploaded file first.' } } : n))

    setNodes((ns) => ns.map((n) => n.id === id ? { ...n, data: { ...n.data, status: 'processing', error: undefined } } : n))
    try {
      const kind = fileKind(input)
      const target = node.data.target as Conversion
      let result: Output

      if (target === 'zip') {
        result = await convertToZip(input)
      } else if (target === 'tar') {
        result = await convertToTar(input)
      } else if (target === 'gz') {
        result = await convertToGz(input)
      } else if (target === 'unzip') {
        result = await convertUnzip(input)
      } else if (target === 'csv') {
        result = await convertJsonToCsv(input)
      } else if (target === 'json' && (input.name.endsWith('.csv') || kind === 'csv')) {
        result = await convertCsvToJson(input)
      } else if (target === 'ico') {
        result = await convertImageToIco(input)
      } else if (target === 'grayscale') {
        result = await convertImageToGrayscale(input)
      } else if (target === 'base64') {
        result = await convertFileToBase64(input)
      } else if (target === 'pdf-text') {
        result = await convertPdfToText(input)
      } else if (target === 'pdf-images') {
        result = await convertPdfToImages(input)
      } else if (kind === 'image' && target === 'pdf') {
        result = await convertImageToPdf(input)
      } else if (kind === 'video' || target === 'gif' || target === 'mp4' || target === 'webm') {
        result = await convertMediaWithFfmpeg(input, target)
      } else if (kind === 'image' && imageTargets.includes(target)) {
        result = await convertImage(input, target as 'png' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'bmp')
      } else if (kind === 'text' && textTargets.includes(target)) {
        result = await convertText(input, target as 'html' | 'md' | 'txt' | 'docx' | 'pdf' | 'json')
      } else if (target === 'wav' || target === 'mp3') {
        result = (kind === 'audio' && target === 'wav') ? await convertAudioToWav(input) : await convertMediaWithFfmpeg(input, target)
      } else {
        result = await convertMediaWithFfmpeg(input, target)
      }

      const children = new Set(edgesRef.current.filter((e) => e.source === id).map((e) => e.target))
      setNodes((ns) => ns.map((n) => n.id === id || children.has(n.id) ? { ...n, data: { ...n.data, result, status: 'done' } } : n))
    } catch (e) {
      setNodes((ns) => ns.map((n) => n.id === id ? { ...n, data: { ...n.data, status: 'error', error: e instanceof Error ? e.message : 'Conversion failed.' } } : n))
    }
  }, [sourceFor])

  const downloadNode = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id)
    const up = sourceFor(id)
    const out = node?.data.result || up.output
    if (out) {
      saveAs(out.blob, out.name)
    } else if (up.file) {
      saveAs(up.file, up.file.name)
    }
  }, [sourceFor])

  const add = useCallback((type: FlowData['type'], target?: string, position = { x: 150 + counter.current * 35, y: 180 + counter.current * 28 }) => {
    const id = `node-${Date.now()}-${counter.current++}`
    const label = type === 'input' ? 'Upload file' : type === 'output' ? 'Download' : `Convert to ${labelFor(target || '')}`
    setNodes((current) => [...current, { id, type: 'flow', position, data: { label, type, target, status: 'idle', onFile: setFile, onRun: runNode, onDownload: downloadNode } }])
    return id
  }, [downloadNode, runNode, setFile])

  const insertPipeline = (target: string) => { add('convert', target); setQuery(''); setMenu(false) }
  const insertFromWire = (type: FlowData['type'], target?: string) => {
    if (!wireMenu) return
    const convert = add(type, target, { x: wireMenu.x - 20, y: wireMenu.y - 20 })
    setEdges((es) => [...es, { id: `e${wireMenu.source}${convert}`, source: wireMenu.source, target: convert, markerEnd: { type: MarkerType.ArrowClosed } }])
    setWireMenu(null)
    setWireSearch('')
  }
  const handleDragStart = (e: React.DragEvent, nodeData: { type: FlowData['type']; target?: string }) => {
    e.dataTransfer.setData('application/reactflow', JSON.stringify(nodeData))
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const flowData = event.dataTransfer.getData('application/reactflow')
    const bounds = mainRef.current?.getBoundingClientRect() || { left: 0, top: 0 }
    const x = Math.max(30, event.clientX - bounds.left - 100)
    const y = Math.max(30, event.clientY - bounds.top - 40)
    if (flowData) {
      try {
        const { type, target } = JSON.parse(flowData)
        add(type, target, { x, y })
        return
      } catch { /* ignore */ }
    }
    const f = event.dataTransfer.files[0]
    if (f) {
      const id = add('input', undefined, { x, y })
      setTimeout(() => setFile(f, id))
    }
  }
  const latestFile = nodes.find((n) => n.data.file)?.data.file
  const suggestions = useMemo(() => {
    const a = latestFile ? allowed(fileKind(latestFile)) : [...imageTargets, ...textTargets, ...videoTargets, ...archiveTargets]
    return a.filter((x) => `convert to ${x}`.includes(query.toLowerCase()) || x.includes(query.toLowerCase())).slice(0, 8)
  }, [latestFile, query])
  const catalogMatches = useMemo(() => catalogFormats.filter((entry) => `${entry.group} ${entry.format}`.toLowerCase().includes(query.trim().toLowerCase())).filter((entry) => !suggestions.some((x) => x.toLowerCase() === entry.format.toLowerCase())).slice(0, 8), [query, suggestions])

  const sourceWireNode = nodes.find((n) => n.id === wireMenu?.source)
  const sourceWireKind = kindForNode(sourceWireNode)
  const sourceAllowed = useMemo(() => allowed(sourceWireKind), [sourceWireKind])

  const filteredWireOptions = useMemo(() => {
    const q = wireSearch.trim().toLowerCase()
    const allowedItems = sourceAllowed.map((target) => ({
      target,
      label: labelFor(target),
      group: 'Recommended'
    }))
    const catalogItems = catalogFormats.map((c) => ({
      target: catalogTarget(c.format),
      label: c.format,
      group: c.group
    }))
    const seen = new Set<string>()
    const combined: { target: string; label: string; group: string }[] = []
    for (const item of [...allowedItems, ...catalogItems]) {
      if (!seen.has(item.target)) {
        seen.add(item.target)
        combined.push(item)
      }
    }
    if (!q) return allowedItems
    return combined.filter((item) =>
      item.target.toLowerCase().includes(q) ||
      item.label.toLowerCase().includes(q) ||
      item.group.toLowerCase().includes(q)
    ).slice(0, 16)
  }, [wireSearch, sourceAllowed])

  const saveRecipe = () => { const recipe = { version: 1, nodes: nodes.map(({ id, position, data }) => ({ id, position, data: { label: data.label, type: data.type, target: data.target } })), edges }; saveAs(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }), 'gowithflow-recipe.json') }
  const loadRecipe = async (f: File) => { try { const r = await f.text(); const recipe = JSON.parse(r); setEdges(recipe.edges || []); setNodes((recipe.nodes || []).map((n: FlowNode) => ({ ...n, type: 'flow', data: { ...n.data, status: 'idle', onFile: setFile, onRun: runNode, onDownload: downloadNode } }))) } catch { alert('That is not a valid GoWithFlow recipe.') } }
  return <main ref={mainRef} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
    <header>
      <div className="brand">
        <GoWithFlowLogo size={28} />
        <span>GoWithFlow</span>
        <em>browser-native</em>
      </div>
      <div className="privacy">Files stay on your device</div>
      <div className="actions">
        <button draggable onDragStart={(e) => handleDragStart(e, { type: 'input' })} onClick={() => add('input')}><Plus size={16}/> Add file</button>
        <button className="pin-node-btn" draggable onDragStart={(e) => handleDragStart(e, { type: 'output' })} onClick={() => add('output')} title="Drag & drop to canvas or click to add Download node"><Download size={15}/> Pin Download Node</button>
        <button onClick={saveRecipe}><Save size={15}/> Save recipe</button>
        <label className="icon-button" title="Load recipe"><Upload size={15}/><input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && loadRecipe(e.target.files[0])}/></label>
      </div>
    </header>
    <section className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ maxZoom: 0.66, padding: 0.45 }}
        minZoom={0.2}
        maxZoom={1.35}
        defaultViewport={{ x: 0, y: 0, zoom: 0.62 }}
        onNodesChange={(c) => setNodes((ns) => applyNodeChanges(c, ns))}
        onEdgesChange={(c) => setEdges((es) => applyEdgeChanges(c, es))}
        onConnect={(c: Connection) => {
          setWireMenu(null)
          setEdges((es) => addEdge({ ...c, markerEnd: { type: MarkerType.ArrowClosed } }, es))
          if (c.source && c.target) {
            const src = nodesRef.current.find((n) => n.id === c.source)
            if (src?.data.result) {
              setNodes((ns) => ns.map((n) => n.id === c.target && n.data.type === 'output' ? { ...n, data: { ...n.data, result: src.data.result, status: 'done' } } : n))
            }
          }
        }}
        onConnectEnd={(event, state) => {
          if (state.toNode) return
          const point = 'changedTouches' in event ? event.changedTouches[0] : event
          if (state.fromNode) {
            setWireMenu({ source: state.fromNode.id, x: point.clientX, y: point.clientY })
            setWireSearch('')
          }
        }}
        deleteKeyCode="Backspace"
      >
        <Background gap={22} size={1} color="#25324b"/><MiniMap/><Controls/>
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="empty">
          <div className="orb"><GoWithFlowLogo size={38} /></div>
          <h1>Go with the flow</h1>
          <p>Drop any file here, or drag & drop nodes from the sidebar.</p>
          <div className="quick-start">
            <span>Quick starts</span>
            <div>
              {['pdf', 'png', 'jpeg', 'webp', 'gif', 'mp3', 'wav', 'zip', 'tar', 'csv', 'json', 'html', 'md'].map((f) => (
                <button key={f} draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: f })} onClick={() => insertPipeline(f as Conversion)}>
                  → {labelFor(f as Conversion)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {wireMenu && (
        <div className="wire-picker" style={{ left: Math.min(window.innerWidth - 320, Math.max(20, wireMenu.x - 30)), top: Math.min(window.innerHeight - 390, Math.max(20, wireMenu.y - 30)) }}>
          <div className="wire-picker-head">
            <b>Connect connection to:</b>
            <button aria-label="Close" onClick={() => setWireMenu(null)}><X size={14}/></button>
          </div>

          <div className="wire-search-box">
            <Search size={14} className="wire-search-icon" />
            <input
              autoFocus
              value={wireSearch}
              onChange={(e) => setWireSearch(e.target.value)}
              placeholder="Search format (gif, zip, mp3, pdf...)"
              onKeyDown={(e) => { if (e.key === 'Escape') setWireMenu(null) }}
            />
            {wireSearch && <button onClick={() => setWireSearch('')}><X size={12}/></button>}
          </div>

          <div className="wire-picker-scroll">
            {(!wireSearch || 'download'.includes(wireSearch.toLowerCase())) && (
              <button className="wire-action-btn wire-download-btn" onClick={() => insertFromWire('output')}>
                <Download size={14} />
                <span>Connect to <strong>Download Node</strong></span>
                <Pin size={11} className="pin-hint" />
              </button>
            )}

            <div className="wire-section-title">
              {wireSearch ? 'Matching Conversions' : `Suggested for ${sourceWireKind} files`}
            </div>

            {filteredWireOptions.map((f) => (
              <button key={f.target} className="wire-action-btn" onClick={() => insertFromWire('convert', f.target)}>
                {f.target === 'zip' || f.target === 'tar' ? <FileArchive size={13} /> : f.target === 'pdf' || f.target === 'docx' ? <FileText size={13} /> : f.target === 'mp3' || f.target === 'wav' ? <Music2 size={13} /> : <Zap size={13} />}
                <span>Convert to <strong>{f.label}</strong></span>
                <small>{f.group}</small>
              </button>
            ))}

            {filteredWireOptions.length === 0 && (
              <div className="wire-empty">No formats found for "{wireSearch}"</div>
            )}
          </div>
          <span className="hint">Drag and release anywhere to auto-wire new nodes.</span>
        </div>
      )}

      <aside className="node-library">
        <div className="library-head"><b>All nodes</b><span>Drag & drop to canvas</span></div>
        <div className="library-scroll">
          <section className="pinned-section">
            <div className="library-group"><b><Pin size={12} style={{ display: 'inline', marginRight: 4, color: '#a78bfa' }} /> Pinned Common Nodes</b><small>Drag to canvas</small></div>
            <div className="pinned-nodes-list">
              <div className="pinned-chip output-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'output' })} onClick={() => add('output')} title="Drag & drop to canvas or click to add Download Output Node">
                <Download size={14} />
                <span>Pin Download Node</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip input-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'input' })} onClick={() => add('input')} title="Drag & drop to canvas or click to add Upload File Node">
                <FileUp size={14} />
                <span>Upload File Node</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip pdf-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'pdf' })} onClick={() => insertPipeline('pdf')} title="Convert Documents or Images to PDF">
                <FileText size={14} />
                <span>Convert to PDF</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip png-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'png' })} onClick={() => insertPipeline('png')} title="Convert Images to PNG">
                <ImageIcon size={14} />
                <span>Convert to PNG</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip jpg-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'jpeg' })} onClick={() => insertPipeline('jpeg')} title="Convert Images to JPG">
                <ImageIcon size={14} />
                <span>Convert to JPG</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip webp-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'webp' })} onClick={() => insertPipeline('webp')} title="Convert Images to WebP">
                <Zap size={14} />
                <span>Convert to WebP</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip gif-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'gif' })} onClick={() => insertPipeline('gif')} title="Convert Video or Images to GIF">
                <Video size={14} />
                <span>Convert to GIF</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip mp3-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'mp3' })} onClick={() => insertPipeline('mp3')} title="Convert Video or Audio to MP3">
                <Music2 size={14} />
                <span>Convert to MP3</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip wav-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'wav' })} onClick={() => insertPipeline('wav')} title="Convert Audio to WAV">
                <Music2 size={14} />
                <span>Convert to WAV</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip zip-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'zip' })} onClick={() => insertPipeline('zip')} title="Create ZIP Archive">
                <FileArchive size={14} />
                <span>Create ZIP Archive</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip tar-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'tar' })} onClick={() => insertPipeline('tar')} title="Create TAR Archive">
                <FolderArchive size={14} />
                <span>Create TAR Archive</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'pdf-text' })} onClick={() => insertPipeline('pdf-text')} title="Extract text from PDF">
                <FileText size={14} />
                <span>PDF to Text</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'pdf-images' })} onClick={() => insertPipeline('pdf-images')} title="Extract all PDF pages to Images Archive">
                <ImageIcon size={14} />
                <span>PDF to Images</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip ico-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'ico' })} onClick={() => insertPipeline('ico')} title="Generate 32x32 Favicon icon (.ico) from image">
                <Sparkles size={14} />
                <span>Favicon (.ico)</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip csv-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'csv' })} onClick={() => insertPipeline('csv')} title="Convert JSON or structured data to CSV">
                <Table size={14} />
                <span>JSON to CSV</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip json-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'json' })} onClick={() => insertPipeline('json')} title="Convert CSV to JSON Data">
                <FileCode size={14} />
                <span>CSV to JSON</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip zip-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'unzip' })} onClick={() => insertPipeline('unzip')} title="Extract files from ZIP archive">
                <FolderArchive size={14} />
                <span>Extract ZIP (Unzip)</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip gray-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'grayscale' })} onClick={() => insertPipeline('grayscale')} title="Convert color image to Black & White / Grayscale">
                <ImageIcon size={14} />
                <span>Image to Grayscale</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'base64' })} onClick={() => insertPipeline('base64')} title="Convert file to Base64 text">
                <FileCode size={14} />
                <span>Base64 Text</span>
                <Pin size={10} className="chip-pin" />
              </div>
              <div className="pinned-chip" draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target: 'gz' })} onClick={() => insertPipeline('gz')} title="Gzip compress any file">
                <FileArchive size={14} />
                <span>GZ Compressed</span>
                <Pin size={10} className="chip-pin" />
              </div>
            </div>
          </section>
          {catalog.map((group) => <section key={group.name}><div className="library-group"><b>{group.name}</b>{group.note && <small>{group.note}</small>}</div><div className="format-chips">{group.formats.map((format) => { const target = catalogTarget(format); return <button key={format} draggable onDragStart={(e) => handleDragStart(e, { type: 'convert', target })} onClick={() => insertPipeline(target)} title={`Drag to canvas or click to add ${format}`}>{format}</button> })}</div></section>)}
        </div>
      </aside>
      <div className="palette"><div className="search"><Zap size={17}/><input autoFocus value={query} onChange={(e) => { const value = e.target.value; setQuery(value); setMenu(value.trim().length > 0) }} onKeyDown={(e) => { if (e.key === 'Escape') { setMenu(false); setQuery('') } }} placeholder="Search all conversion nodes…"/><kbd>⌘ K</kbd><button onClick={() => { setMenu(!menu); if (!menu) setQuery(' ') }}><Plus size={17}/></button></div>{menu && <div className="suggestions"><div className="suggestion-title">{latestFile ? `Suggested for ${fileKind(latestFile)} files` : 'Conversion types'}</div>{suggestions.map((s) => <button key={s} onClick={() => insertPipeline(s)}><span>{s === 'wav' ? <Music2 size={15}/> : <Zap size={15}/>}</span> Convert to <b>{labelFor(s)}</b><small>{isExperimental(s) ? 'Experimental' : 'Reliable'}</small></button>)}{catalogMatches.map((entry) => <button key={`${entry.group}-${entry.format}`} onClick={() => insertPipeline(catalogTarget(entry.format))}><span><Plus size={15}/></span> Convert to <b>{entry.format}</b><small>{entry.group} · planned</small></button>)}<div className="experimental">Planned nodes will run entirely with bundled browser WASM engines—never a server.</div></div>}</div>
    </section><footer><span>Canvas conversions are private and run locally.</span><span>MP4 → GIF / MP3 uses bundled FFmpeg.wasm; processing runs inside your browser.</span></footer>
  </main>
}


