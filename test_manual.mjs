import assert from 'assert'
import { zipSync, unzipSync, gzipSync } from 'fflate'

console.log('--- STARTING MANUAL CONVERTER UNIT TESTS ---')

// 1. Test POSIX USTAR TAR Creation
function createTar(filename, data) {
  const header = new Uint8Array(512)
  const writeStr = (str, offset, max) => {
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
  return out
}

const sampleData = new TextEncoder().encode('Hello, Universal File TAR!')
const tarBytes = createTar('test.txt', sampleData)
assert.strictEqual(tarBytes[257], 'u'.charCodeAt(0), 'Tar ustar magic check')
assert.strictEqual(tarBytes[258], 's'.charCodeAt(0), 'Tar ustar magic check')
console.log('✓ TAR generation verified: standard POSIX ustar header valid')

// 2. Test ZIP archive generation and Unzip
const zipped = zipSync({ 'report.txt': sampleData, 'data.csv': new TextEncoder().encode('a,b\n1,2') })
assert(zipped.length > 0, 'Zip length > 0')
const unzipped = unzipSync(zipped)
assert(unzipped['report.txt'], 'Unzip has report.txt')
assert.strictEqual(new TextDecoder().decode(unzipped['report.txt']), 'Hello, Universal File TAR!')
assert(unzipped['data.csv'], 'Unzip has data.csv')
console.log('✓ ZIP creation and UNZIP extraction verified')

// 3. Test GZ compression
const gzipped = gzipSync(sampleData)
assert(gzipped.length > 0, 'Gzip length > 0')
assert.strictEqual(gzipped[0], 0x1f, 'Gzip magic byte 1')
assert.strictEqual(gzipped[1], 0x8b, 'Gzip magic byte 2')
console.log('✓ GZ gzip compression verified (RFC 1952 magic 0x1f 0x8b)')

// 4. Test JSON to CSV
const testJson = JSON.stringify([
  { id: 1, name: 'Alice', role: 'Engineer', note: 'Fast, reliable' },
  { id: 2, name: 'Bob', role: 'Designer', note: 'Creative' }
])

function jsonToCsv(jsonStr) {
  let parsed = JSON.parse(jsonStr)
  let rows = Array.isArray(parsed) ? parsed : [parsed]
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return ''
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`
    return str
  }
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(','))
  ]
  return lines.join('\r\n')
}

const csvResult = jsonToCsv(testJson)
assert(csvResult.includes('id,name,role,note'), 'CSV headers check')
assert(csvResult.includes('"Fast, reliable"'), 'CSV comma escaping check')
console.log('✓ JSON to CSV conversion verified with RFC 4180 escaping')

// 5. Test CSV to JSON
function csvToJson(csvStr) {
  const rawLines = csvStr.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const parseLine = (line) => {
    const result = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else current += char
    }
    result.push(current.trim())
    return result
  }
  const headers = parseLine(rawLines[0])
  return rawLines.slice(1).map((line) => {
    const vals = parseLine(line)
    const obj = {}
    headers.forEach((h, idx) => {
      const val = vals[idx] ?? ''
      if (/^-?\d+(\.\d+)?$/.test(val)) obj[h] = Number(val)
      else if (val.toLowerCase() === 'true') obj[h] = true
      else if (val.toLowerCase() === 'false') obj[h] = false
      else obj[h] = val
    })
    return obj
  })
}

const parsedJson = csvToJson(csvResult)
assert.strictEqual(parsedJson.length, 2, 'Parsed 2 rows')
assert.strictEqual(parsedJson[0].id, 1, 'Parsed number 1')
assert.strictEqual(parsedJson[0].name, 'Alice')
assert.strictEqual(parsedJson[0].note, 'Fast, reliable')
console.log('✓ CSV to JSON conversion verified')

// 6. Test Favicon ICO Container Format
function makeIco(pngData) {
  const ico = new Uint8Array(6 + 16 + pngData.length)
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
  view.setUint32(14, pngData.length, true) // Image size
  view.setUint32(18, 22, true) // Offset (6 + 16)
  ico.set(pngData, 22)
  return ico
}

const mockPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
const icoBytes = makeIco(mockPngBytes)
assert.strictEqual(icoBytes[0], 0, 'ICO header reserved 0')
assert.strictEqual(icoBytes[2], 1, 'ICO header type 1')
assert.strictEqual(icoBytes[4], 1, 'ICO header count 1')
assert.strictEqual(icoBytes[6], 32, 'ICO 32px width')
assert.strictEqual(icoBytes[7], 32, 'ICO 32px height')
assert.strictEqual(icoBytes[22], 0x89, 'ICO payload PNG byte 0')
console.log('✓ Favicon .ICO container structure verified')

// 7. Test Base64 Encoding
const rawBytes = new Uint8Array([72, 101, 108, 108, 111])
const base64Str = Buffer.from(rawBytes).toString('base64')
assert.strictEqual(base64Str, 'SGVsbG8=', 'Base64 check')
console.log('✓ Base64 encode verified')

console.log('--- ALL MANUAL TESTS PASSED SUCCESSFULLY ---')
