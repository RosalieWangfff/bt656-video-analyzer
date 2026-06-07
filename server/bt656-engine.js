const SAV_EAV_WORDS = new Set([
  0x200, 0x20D, 0x27C, 0x279,
  0x1B4, 0x1B1, 0x168, 0x165
])

const SMPTE_REF_Y = [0x3AC, 0x340, 0x2DC, 0x270, 0x21C, 0x1B0, 0x154, 0x040]
const SMPTE_REF_NAMES = ['白', '黄', '青', '绿', '品红', '红', '蓝', '黑']

const Y_MIN = 0x040, Y_MAX = 0x3BF
const C_MIN = 0x040, C_MAX = 0x3C0

const CHANNEL_CYCLE = ['Cb', 'Y', 'Cr', 'Y']
const CHANNEL_CYCLE_Y_POS = [false, true, false, true]

const LINE_TIMING = {
  720:  { totalPerLine: 858,    eavPosition: 720,  savPosition: 800 },
  1280: { totalPerLine: 1650,   eavPosition: 1280, savPosition: 1360 },
  1440: { totalPerLine: 1980,   eavPosition: 1440, savPosition: 1520 },
  1920: { totalPerLine: 2200,   eavPosition: 1920, savPosition: 2000 },
}

function getTimingForWidth(width) {
  return LINE_TIMING[width] || {
    totalPerLine: Math.round(width * 1.15),
    eavPosition: width,
    savPosition: Math.round(width * 1.05)
  }
}

function unpack10bitPacked(rawBytes) {
  const samples = []
  for (let i = 0; i + 4 < rawBytes.length; i += 5) {
    const b0 = rawBytes[i], b1 = rawBytes[i + 1], b2 = rawBytes[i + 2]
    const b3 = rawBytes[i + 3], b4 = rawBytes[i + 4]
    samples.push(
      (b0 << 2) | (b4 >> 6),
      (b1 << 2) | ((b4 >> 4) & 0x03),
      (b2 << 2) | ((b4 >> 2) & 0x03),
      (b3 << 2) | (b4 & 0x03)
    )
  }
  return samples
}

function unpack10bitRaw(rawBytes) {
  const samples = []
  for (let i = 0; i + 1 < rawBytes.length; i += 2) {
    samples.push((rawBytes[i] << 2) | (rawBytes[i + 1] >> 6))
  }
  return samples
}

function detectSAV_EAV(samples) {
  const markers = []
  const incompleteTRS = []
  const corruptedTRS = []

  for (let i = 0; i < samples.length; i++) {
    if (samples[i] !== 0x3FF) continue

    const remaining = samples.length - i

    if (remaining >= 4) {
      if (samples[i + 1] === 0x000 && samples[i + 2] === 0x000) {
        const xyz = samples[i + 3]
        if (SAV_EAV_WORDS.has(xyz)) {
          const hBit = xyz & 0x01
          const fBit = (xyz >> 1) & 0x01
          const vBit = (xyz >> 2) & 0x01
          markers.push({
            index: i,
            type: hBit ? 'SAV' : 'EAV',
            xyz,
            fBit,
            vBit,
            hBit,
            fieldInfo: `${fBit ? 'F2' : 'F1'} / ${vBit ? 'VBLANK' : 'ACTIVE'}`
          })
        } else {
          corruptedTRS.push({
            index: i,
            xyz,
            xyzHex: '0x' + xyz.toString(16).toUpperCase().padStart(3, '0'),
            reason: `TRS 序列完整但 XYZ=0x${xyz.toString(16).toUpperCase().padStart(3, '0')} 不在有效集合中`
          })
        }
      }
    } else if (remaining < 4) {
      if (remaining === 1) {
        incompleteTRS.push({ index: i, pattern: ['3FF'], status: '数据末尾截断: 仅有 3FF' })
      } else if (remaining === 2 && samples[i + 1] === 0x000) {
        incompleteTRS.push({ index: i, pattern: ['3FF', '000'], status: '数据末尾截断: 仅有 3FF 000' })
      } else if (remaining === 3 && samples[i + 1] === 0x000 && samples[i + 2] === 0x000) {
        incompleteTRS.push({ index: i, pattern: ['3FF', '000', '000'], status: '数据末尾截断: 缺少 XYZ' })
      }
    }
  }

  return { markers, incompleteTRS, corruptedTRS }
}

function extractActiveVideo(samples, markers, lineWidth) {
  const regions = []
  let globalLineNum = 0

  for (let i = 0; i < markers.length; i++) {
    if (markers[i].type === 'SAV') {
      const savIdx = markers[i].index
      let eavIdx = -1
      let eavMarker = null
      for (let j = i + 1; j < markers.length; j++) {
        if (markers[j].type === 'EAV') {
          eavIdx = markers[j].index
          eavMarker = markers[j]
          break
        }
      }

      if (eavIdx > savIdx + 4) {
        globalLineNum++
        const timing = getTimingForWidth(lineWidth)

        regions.push({
          startSample: savIdx + 4,
          endSample: eavIdx,
          lineNumber: globalLineNum,
          savIndex: savIdx,
          eavIndex: eavIdx,
          savMarker: markers[i],
          eavMarker,
          activeLength: eavIdx - savIdx - 4,
          baseSampleIndex: (globalLineNum - 1) * timing.totalPerLine + timing.savPosition + 4
        })
      }
    }
  }

  return regions
}

function checkRange(val, channel) {
  if (val === 0x000 || val === 0x3FF) {
    return { hasError: false, errorType: null, reason: null }
  }
  if (channel === 'Y') {
    if (val < Y_MIN || val > Y_MAX) {
      return { hasError: true, errorType: 'out_of_range', reason: '越界' }
    }
  } else {
    if (val < C_MIN || val > C_MAX) {
      return { hasError: true, errorType: 'out_of_range', reason: '越界' }
    }
  }
  return { hasError: false, errorType: null, reason: null }
}

function analyzeStaircase(yValues, tolerance) {
  const numSteps = 8
  const stepSize = Math.floor(yValues.length / numSteps)
  if (stepSize < 4) return null

  const bars = []
  for (let s = 0; s < numSteps; s++) {
    const start = s * stepSize
    const end = s === numSteps - 1 ? yValues.length : (s + 1) * stepSize
    const segment = yValues.slice(start, end)
    const mean = segment.reduce((a, b) => a + b, 0) / segment.length
    const variance = segment.reduce((acc, v) => acc + (v - mean) ** 2, 0) / segment.length
    const stdDev = Math.sqrt(variance)
    const refVal = SMPTE_REF_Y[s]
    const deviation = Math.round(mean - refVal)
    const isError = Math.abs(deviation) > tolerance || stdDev > tolerance * 2

    bars.push({
      name: SMPTE_REF_NAMES[s],
      refValue: refVal,
      refHex: '0x' + refVal.toString(16).toUpperCase(),
      meanValue: Math.round(mean),
      meanHex: '0x' + Math.round(mean).toString(16).toUpperCase(),
      deviation,
      stdDev: Number(stdDev.toFixed(3)),
      isError,
      heightPx: Math.max(10, Math.round((mean / 1024) * 180))
    })
  }

  const pointErrors = []
  for (let s = 0; s < numSteps; s++) {
    const start = s * stepSize
    const end = s === numSteps - 1 ? yValues.length : (s + 1) * stepSize
    const refVal = SMPTE_REF_Y[s]
    for (let k = start; k < end; k++) {
      if (Math.abs(yValues[k] - refVal) > tolerance * 3) {
        pointErrors.push({ indexInLine: k, expected: refVal, got: yValues[k] })
      }
    }
  }

  return { bars, pointErrors, hasAnyError: bars.some(b => b.isError) || pointErrors.length > 0 }
}

function parseHexText(text) {
  text = text.replace(/[^0-9A-Fa-f]/g, '')
  const bytes = new Uint8Array(text.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(text.substr(i * 2, 2), 16)
  }
  return bytes
}

function analyze(rawData, options = {}) {
  const {
    width = 1920,
    tolerance = 5,
    packMode = 'packed_4to5',
    initialOffset = 0
  } = options

  let allSamples
  if (packMode === 'packed_4to5') {
    allSamples = unpack10bitPacked(rawData)
  } else {
    allSamples = unpack10bitRaw(rawData)
  }

  if (allSamples.length === 0) throw new Error('解包后无有效样本')

  const { markers, incompleteTRS, corruptedTRS } = detectSAV_EAV(allSamples)
  console.log(`[BT.656 Engine] 检测到 ${markers.length} 个 SAV/EAV 同步头`)
  if (incompleteTRS.length > 0) {
    console.log(`[BT.656 Engine] 警告: 检测到 ${incompleteTRS.length} 个截断的 TRS`)
    incompleteTRS.forEach(t => console.log(`  [截断] idx=${t.index} ${t.status}`))
  }
  if (corruptedTRS.length > 0) {
    console.log(`[BT.656 Engine] 警告: 检测到 ${corruptedTRS.length} 个损坏的 TRS`)
    corruptedTRS.forEach(t => console.log(`  [损坏] idx=${t.index} ${t.reason}`))
  }
  markers.forEach(m => {
    console.log(`  [${m.type}] idx=${m.index} XYZ=0x${m.xyz.toString(16).toUpperCase()} F=${m.fBit} V=${m.vBit} H=${m.hBit} ${m.fieldInfo}`)
  })

  const regions = extractActiveVideo(allSamples, markers, width)
  console.log(`[BT.656 Engine] 提取到 ${regions.length} 个有效视频区域`)

  let lineWidth = width
  if (lineWidth === 0 && regions.length > 0) {
    const firstLen = regions[0].endSample - regions[0].startSample
    lineWidth = Math.floor(firstLen / 2)
  }
  if (lineWidth === 0) lineWidth = 1920

  const timing = getTimingForWidth(lineWidth)
  const errors = []
  const stairResults = []
  let totalY = 0, totalCbCr = 0, totalSamp = 0
  let rangeErrCount = 0, stairErrCount = 0
  const isPacked = packMode === 'packed_4to5'
  const bytePerSample = isPacked ? 1.25 : 2

  for (const region of regions) {
    const regionSamples = allSamples.slice(region.startSample, region.endSample)
    const lineY = [], lineCb = [], lineCr = []

    const baseByteOffset = region.startSample * bytePerSample
    const isVBlank = region.savMarker && region.savMarker.vBit === 1

    let computedBaseIndex
    if (initialOffset !== 0) {
      computedBaseIndex = initialOffset + (region.lineNumber - 1) * timing.totalPerLine
    } else {
      computedBaseIndex = region.baseSampleIndex
    }

    for (let i = 0; i + 3 < regionSamples.length; i += 4) {
      const cb = regionSamples[i]
      const y0 = regionSamples[i + 1]
      const cr = regionSamples[i + 2]
      const y1 = regionSamples[i + 3]

      const localSampleBase = computedBaseIndex + i

      function addError(channel, val, cycleOff, type, label) {
        errors.push({
          byteOffset: Math.round(baseByteOffset + (i + cycleOff) * bytePerSample),
          sampleIndex: localSampleBase + cycleOff,
          channel,
          decValue: val,
          hexValue: '0x' + val.toString(16).toUpperCase().padStart(3, '0'),
          type,
          typeLabel: label,
          lineNumber: region.lineNumber,
          index: errors.length
        })
      }

      if (!isVBlank) {
        totalCbCr++
        const cbCheck = checkRange(cb, 'Cb')
        if (cbCheck.hasError) {
          rangeErrCount++
          addError('Cb', cb, 0, cbCheck.errorType, cbCheck.reason)
        }

        totalY++; totalSamp++
        const y0Check = checkRange(y0, 'Y')
        if (y0Check.hasError) {
          rangeErrCount++
          addError('Y', y0, 1, y0Check.errorType, y0Check.reason)
        }

        totalCbCr++
        const crCheck = checkRange(cr, 'Cr')
        if (crCheck.hasError) {
          rangeErrCount++
          addError('Cr', cr, 2, crCheck.errorType, crCheck.reason)
        }

        totalY++; totalSamp++
        const y1Check = checkRange(y1, 'Y')
        if (y1Check.hasError) {
          rangeErrCount++
          addError('Y', y1, 3, y1Check.errorType, y1Check.reason)
        }
      } else {
        totalCbCr += 2
        totalY += 2; totalSamp += 4
      }

      lineY.push(y0); lineY.push(y1)
      lineCb.push(cb); lineCr.push(cr)
    }

    if (!isVBlank && lineY.length >= 16) {
      const stairResult = analyzeStaircase(lineY, tolerance)
      if (stairResult) {
        for (const pe of stairResult.pointErrors) {
          stairErrCount++
          const yVal = lineY[pe.indexInLine]
          const sampleIdxInRegion = pe.indexInLine
          const globalSampleIdx = computedBaseIndex + sampleIdxInRegion * 2 + 1
          errors.push({
            byteOffset: Math.round(baseByteOffset + (sampleIdxInRegion * 2 + 1) * bytePerSample),
            sampleIndex: globalSampleIdx,
            channel: 'Y',
            decValue: yVal,
            hexValue: '0x' + yVal.toString(16).toUpperCase().padStart(3, '0'),
            type: 'staircase',
            typeLabel: '非标准位阶',
            lineNumber: region.lineNumber,
            index: errors.length
          })
        }
        if (stairResult.hasAnyError) {
          for (let bi = 0; bi < stairResult.bars.length; bi++) {
            const bar = stairResult.bars[bi]
            if (bar.isError) {
              const stepSize = Math.floor(lineY.length / 8)
              const repIdx = Math.min(bi * stepSize + Math.floor(stepSize / 2), lineY.length - 1)
              const repY = lineY[repIdx]
              stairErrCount++
              errors.push({
                byteOffset: Math.round(baseByteOffset + (repIdx * 2 + 1) * bytePerSample),
                sampleIndex: computedBaseIndex + repIdx * 2 + 1,
                channel: 'Y',
                decValue: repY,
                hexValue: '0x' + repY.toString(16).toUpperCase().padStart(3, '0'),
                type: 'staircase',
                typeLabel: `阶梯异常(${bar.name})`,
                lineNumber: region.lineNumber,
                index: errors.length
              })
            }
          }
        }
        stairResults.push({ lineNumber: region.lineNumber, ...stairResult })
      }
    }
  }

  if (regions.length === 0) {
    let fallbackBaseIndex = initialOffset
    for (let i = 0; i + 3 < allSamples.length; i += 4) {
      const channels = [
        { val: allSamples[i], name: 'Cb' },
        { val: allSamples[i + 1], name: 'Y' },
        { val: allSamples[i + 2], name: 'Cr' },
        { val: allSamples[i + 3], name: 'Y' }
      ]
      for (let c = 0; c < channels.length; c++) {
        const ch = channels[c]; totalSamp++
        if (ch.name === 'Y') totalY++; else totalCbCr++
        const chk = checkRange(ch.val, ch.name)
        if (chk.hasError) {
          rangeErrCount++
          errors.push({
            byteOffset: Math.round((i + c) * bytePerSample),
            sampleIndex: fallbackBaseIndex + i + c,
            channel: ch.name,
            decValue: ch.val,
            hexValue: '0x' + ch.val.toString(16).toUpperCase().padStart(3, '0'),
            type: chk.errorType,
            typeLabel: chk.reason,
            lineNumber: -1,
            index: errors.length
          })
        }
      }
    }
  }

  return {
    stats: {
      totalSamples: totalSamp,
      totalY,
      totalCbCr,
      totalErrors: rangeErrCount + stairErrCount,
      rangeErrors: rangeErrCount,
      staircaseErrors: stairErrCount,
      validSamples: totalSamp - (rangeErrCount + stairErrCount),
      linesDetected: regions.length,
      rawSampleCount: allSamples.length,
      rawDataLength: rawData.length,
      lineWidth,
      timing,
      initialOffsetUsed: initialOffset
    },
    errors,
    stairResults,
    markers,
    regions: regions.map(r => ({
      ...r,
      baseSampleIndex: r.baseSampleIndex,
      computedBaseIndex: initialOffset !== 0
        ? initialOffset + (r.lineNumber - 1) * timing.totalPerLine
        : r.baseSampleIndex
    })),
    incompleteTRS,
    corruptedTRS,
    rawData: Array.from(rawData),
    allSamples: allSamples.slice(0, 50000)
  }
}

module.exports = { analyze, parseHexText, LINE_TIMING, getTimingForWidth, CHANNEL_CYCLE }
