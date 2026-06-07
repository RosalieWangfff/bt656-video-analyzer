const Y_MIN = 0x040, Y_MAX = 0x3BF
const C_MIN = 0x040, C_MAX = 0x3C0

const SMPTE_REF_Y = [0x3AC, 0x340, 0x2DC, 0x270, 0x21C, 0x1B0, 0x154, 0x040]
const SMPTE_REF_NAMES = ['白', '黄', '青', '绿', '品红', '红', '蓝', '黑']

function stripQuotes(val) {
  if (!val) return val
  val = val.trim()
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1).trim()
  }
  return val
}

function parseValue(raw) {
  const val = stripQuotes(raw)
  if (!val || val === '') return NaN

  if (val.startsWith('0x') || val.startsWith('0X')) {
    return parseInt(val.substring(2), 16)
  }
  if (val.startsWith('x') || val.startsWith('X')) {
    return parseInt(val.substring(1), 16)
  }
  return parseInt(val, 10)
}

function parseWFM8300CSV(text) {
  const lines = text.split(/\r?\n/)
  const header = {}
  const events = {}
  let dataStartIdx = -1
  let headerLine = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('USB Capture Filename:')) {
      header.captureFilename = line.replace('USB Capture Filename:', '').trim()
    } else if (line.startsWith('Header Version:')) {
      header.headerVersion = line.replace('Header Version:', '').trim()
    } else if (line.startsWith('Captured')) {
      header.capturedTime = line.replace(/^"Captured\s*--\s*/, '').replace(/"$/, '').trim()
    } else if (line.startsWith('Frame Count:')) {
      header.frameCount = parseInt(line.replace('Frame Count:', '').trim()) || 0
    } else if (line.startsWith('Video Format:')) {
      header.videoFormat = line.replace('Video Format:', '').trim()
    } else if (line.startsWith('Total Lines:')) {
      header.totalLines = parseInt(line.replace('Total Lines:', '').trim()) || 0
    } else if (line.startsWith('Active Lines:')) {
      header.activeLines = parseInt(line.replace('Active Lines:', '').trim()) || 0
    } else if (line.startsWith('Total Luma Samples per Line:')) {
      header.totalLumaSamples = parseInt(line.replace('Total Luma Samples per Line:', '').trim()) || 0
    } else if (line.startsWith('Active Luma Samples per Line:')) {
      header.activeLumaSamples = parseInt(line.replace('Active Luma Samples per Line:', '').trim()) || 0
    } else if (line.match(/^\d+\s+(EAV|SAV|Line Number|Luma CRC|Chroma CRC|Luma Checksum|Chroma Checksum|Signal Lock|Active Picture CRC|Full Field CRC|Video Standard|Luma Out of Gamut|Composite Out of Gamut|RGB Out of Gamut|Manual Trigger)\s+Error/i)) {
      const parts = line.split(/\s+/)
      const val = parseInt(parts[0]) || 0
      const evtName = parts.slice(1, -1).join(' ')
      events[evtName] = val
    } else if (line.startsWith('Line Count,')) {
      headerLine = line
      dataStartIdx = i + 1
      break
    }
  }

  if (dataStartIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Cb') && lines[i].includes('Yc') && lines[i].includes('Cr')) {
        headerLine = lines[i]
        dataStartIdx = i + 1
        break
      }
    }
  }

  if (dataStartIdx === -1) {
    throw new Error('无法识别WFM8300 CSV格式：未找到数据列头')
  }

  const colHeaders = headerLine.split(',')
  const channelMap = buildChannelMap(colHeaders)

  const dataRows = []
  for (let i = dataStartIdx; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = line.split(',')
    const lineCount = parseInt(stripQuotes(cols[0]))
    if (isNaN(lineCount)) continue

    const lineSamp = cols[2] ? stripQuotes(cols[2]) : ''
    const row = {
      lineCount,
      lineSamp,
      rawCols: cols,
      samples: []
    }

    let sampleOffset = 0
    for (const mapping of channelMap) {
      const rawVal = cols[mapping.colIdx]
      if (rawVal === undefined || rawVal.trim() === '') continue

      const decVal = parseValue(rawVal)
      if (isNaN(decVal)) continue

      row.samples.push({
        colIdx: mapping.colIdx,
        channel: mapping.channel,
        sampleGroupIdx: mapping.groupIdx,
        decValue: decVal,
        hexValue: '0x' + decVal.toString(16).toUpperCase().padStart(3, '0'),
        binValue: decVal.toString(2).padStart(10, '0'),
        sampleOffset: sampleOffset++,
        errorInfo: checkRange(decVal, mapping.channel)
      })
    }

    if (row.samples.length > 0) {
      dataRows.push(row)
    }
  }

  return { header, events, dataRows, totalDataRows: dataRows.length }
}

function buildChannelMap(colHeaders) {
  const channelMap = []

  let dataStartCol = -1
  for (let i = 0; i < colHeaders.length; i++) {
    const h = colHeaders[i].trim()
    if (h.startsWith('Cb')) {
      dataStartCol = i
      break
    }
  }

  if (dataStartCol === -1) {
    return channelMap
  }

  let groupIdx = 0
  let posInGroup = 0
  const CHANNEL_PATTERN = ['Cb', 'Y', 'Cr', 'Y']

  for (let i = dataStartCol; i < colHeaders.length; i++) {
    const h = colHeaders[i].trim()
    if (h === '') continue

    let channel = null
    if (h.startsWith('Cb')) {
      channel = 'Cb'
    } else if (h.startsWith('Yc')) {
      channel = 'Y'
    } else if (h.startsWith('Cr')) {
      channel = 'Cr'
    } else if (h.startsWith('Y')) {
      channel = 'Y'
    } else {
      continue
    }

    if (channel === 'Cb' && posInGroup > 0) {
      groupIdx++
      posInGroup = 0
    }

    channelMap.push({
      colIdx: i,
      channel,
      groupIdx
    })

    posInGroup++
    if (posInGroup >= 4) {
      posInGroup = 0
    }
  }

  return channelMap
}

function parseGenericCSV(text) {
  const lines = text.split(/\r?\n/)
  const dataRows = []
  let startIdx = 0

  if (lines.length > 0 && lines[0].includes(',')) {
    const firstCols = lines[0].split(',')
    if (firstCols.some(c => isNaN(parseValue(c)))) {
      startIdx = 1
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = line.split(',')
    const row = {
      lineCount: i - startIdx + 1,
      lineSamp: '',
      rawCols: cols,
      samples: []
    }

    let sampleOffset = 0
    for (let c = 0; c < cols.length; c++) {
      const rawVal = cols[c]
      if (!rawVal || rawVal.trim() === '') continue

      const decVal = parseValue(rawVal)
      if (isNaN(decVal)) continue

      const channelCycle = ['Cb', 'Y', 'Cr', 'Y']
      const channel = channelCycle[sampleOffset % 4]

      row.samples.push({
        colIdx: c,
        channel,
        decValue: decVal,
        hexValue: '0x' + decVal.toString(16).toUpperCase().padStart(3, '0'),
        binValue: decVal.toString(2).padStart(10, '0'),
        sampleOffset: sampleOffset++,
        errorInfo: checkRange(decVal, channel)
      })
    }

    if (row.samples.length > 0) {
      dataRows.push(row)
    }
  }

  return {
    header: { videoFormat: 'Generic CSV' },
    events: {},
    dataRows,
    totalDataRows: dataRows.length
  }
}

function isBlankingLine(lineCount, videoFormat) {
  if (!videoFormat || !lineCount) return false
  const vf = String(videoFormat).toLowerCase()

  if (vf.includes('1080i')) {
    return (lineCount >= 1 && lineCount <= 21) ||
           (lineCount >= 311 && lineCount <= 312) ||
           (lineCount >= 561 && lineCount <= 583) ||
           (lineCount >= 624 && lineCount <= 625) ||
           (lineCount >= 1124)
  }
  if (vf.includes('1080p')) {
    return (lineCount >= 1 && lineCount <= 42) ||
           (lineCount >= 1124)
  }
  if (vf.includes('720p')) {
    return (lineCount >= 1 && lineCount <= 25) ||
           (lineCount >= 746)
  }
  if (vf.includes('576') || vf.includes('625')) {
    return (lineCount >= 1 && lineCount <= 22) ||
           (lineCount >= 311 && lineCount <= 335) ||
           (lineCount >= 624)
  }
  if (vf.includes('480') || vf.includes('525')) {
    return (lineCount >= 1 && lineCount <= 20) ||
           (lineCount >= 264 && lineCount <= 282) ||
           (lineCount >= 525)
  }
  return false
}

function analyzeCSVData(parsedData, options = {}) {
  const { dataRows, header } = parsedData
  const { width = 0 } = options
  const videoFormat = header.videoFormat || ''
  let totalSamples = 0
  let rangeErrors = 0
  let staircaseErrors = 0
  const allErrors = []
  const lineStats = []

  for (const row of dataRows) {
    const rowIsBlanking = isBlankingLine(row.lineCount, videoFormat)
    let lineRange = 0
    let lineStaircase = 0
    let lineTotal = 0
    let lineYTotal = 0
    let lineCbCrTotal = 0

    for (const sample of row.samples) {
      totalSamples++
      lineTotal++
      if (sample.channel === 'Y') lineYTotal++; else lineCbCrTotal++

      if (!rowIsBlanking && sample.errorInfo.hasError) {
        if (sample.errorInfo.errorType === 'out_of_range') {
          rangeErrors++
          lineRange++
        } else if (sample.errorInfo.errorType === 'staircase') {
          staircaseErrors++
          lineStaircase++
        }

        allErrors.push({
          lineCount: row.lineCount,
          lineSamp: row.lineSamp,
          colIdx: sample.colIdx,
          channel: sample.channel,
          decValue: sample.decValue,
          hexValue: sample.hexValue,
          binValue: sample.binValue,
          sampleOffset: sample.sampleOffset,
          errorType: sample.errorInfo.errorType,
          errorReason: sample.errorInfo.reason,
          index: allErrors.length
        })
      }
    }

    lineStats.push({
      lineCount: row.lineCount,
      lineSamp: row.lineSamp,
      totalSamples: lineTotal,
      yCount: lineYTotal,
      cbCrCount: lineCbCrTotal,
      rangeErrors: lineRange,
      staircaseErrors: lineStaircase,
      totalErrors: lineRange + lineStaircase,
      hasError: (lineRange + lineStaircase) > 0
    })
  }

  return {
    header,
    events: parsedData.events,
    stats: {
      totalSamples,
      totalY: dataRows.reduce((s, r) => s + r.samples.filter(sp => sp.channel === 'Y').length, 0),
      totalCbCr: dataRows.reduce((s, r) => s + r.samples.filter(sp => sp.channel !== 'Y').length, 0),
      totalErrors: rangeErrors + staircaseErrors,
      rangeErrors,
      staircaseErrors,
      validSamples: totalSamples - rangeErrors - staircaseErrors,
      totalDataRows: dataRows.length,
      videoFormat: header.videoFormat || 'Unknown',
      width
    },
    errors: allErrors,
    lineStats,
    dataRows: dataRows.map(row => ({
      lineCount: row.lineCount,
      lineSamp: row.lineSamp,
      samples: row.samples
    }))
  }
}

function checkRange(val, channel) {
  if (val === 0x000 || val === 0x3FF) {
    return { hasError: false, errorType: null, reason: null }
  }
  if (channel === 'Y') {
    if (val < Y_MIN || val > Y_MAX) {
      return { hasError: true, errorType: 'out_of_range', reason: 'Y越界(' + val.toString(16).toUpperCase() + ')' }
    }
  } else {
    if (val < C_MIN || val > C_MAX) {
      return { hasError: true, errorType: 'out_of_range', reason: channel + '越界(' + val.toString(16).toUpperCase() + ')' }
    }
  }
  return { hasError: false, errorType: null, reason: null }
}

function detectCSVFormat(text) {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    if (lines[i].includes('USB Capture Filename') || lines[i].includes('Video Format')) {
      return 'wfm8300'
    }
    if (lines[i].includes('Cb') && lines[i].includes('Yc') && lines[i].includes('Cr')) {
      return 'wfm8300'
    }
  }
  return 'generic'
}

module.exports = {
  parseWFM8300CSV,
  parseGenericCSV,
  analyzeCSVData,
  detectCSVFormat,
  checkRange
}
