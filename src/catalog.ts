export type CatalogGroup = { name: string; formats: string[]; note?: string }

// The complete local-first roadmap. Formats marked experimental have a node in
// the library now; their WASM engine is deliberately not claimed as shipped.
export const catalog: CatalogGroup[] = [
  { name: 'Documents', formats: ['DOC', 'DOCX', 'TXT', 'RTF', 'ODT', 'PDF'] },
  { name: 'Video', formats: ['MP4', 'MKV', 'AVI', 'MOV', 'WebM', 'FLV', '+50 codecs'], note: 'FFmpeg.wasm' },
  { name: 'Audio', formats: ['MP3', 'FLAC', 'AAC', 'WAV', 'OGG', 'Opus', 'WMA', '+30 codecs'], note: 'WAV is available now' },
  { name: 'Spreadsheets', formats: ['CSV', 'XLS', 'XLSX', 'ODS'] },
  { name: 'Presentations', formats: ['PPTX', 'PPT', 'ODP'] },
  { name: 'Images', formats: ['JPG', 'PNG', 'GIF', 'WebP', 'SVG', 'ICO', 'HEIC'], note: 'JPG/PNG/WebP available now' },
  { name: 'Archives', formats: ['ZIP', 'RAR', '7Z', 'TAR', 'GZ', 'BZ2'] },
  { name: 'E-Books', formats: ['EPUB', 'MOBI', 'AZW', 'AZW3', 'AZW4'] },
  { name: '3D Models', formats: ['OBJ', 'STL', 'DXF', 'Collada', 'PLY'] },
  { name: 'Technical', formats: ['OpenSCAD', 'CAD drawings', 'Vector graphics'] },
  { name: 'Bootable ISO', formats: ['x86', 'ARM', 'UEFI', 'MBR/GPT hybrid'] },
  { name: 'OCR', formats: ['Image → text', 'PDF → text', 'PDF → images'], note: 'PDF text is available now' },
  { name: 'Live Streams', formats: ['M3U8 capture', 'Stream → file'], note: 'Browser capture limits apply' },
  { name: 'Subtitles', formats: ['SRT', 'VTT', 'ASS', 'SUB', 'SBV', 'TTML', '+more'] }
]

export const catalogFormats = catalog.flatMap((group) => group.formats.filter((format) => !format.startsWith('+')).map((format) => ({ group: group.name, format })))
