const express = require('express')
const multer = require('multer')
const cors = require('cors')
const crypto = require('crypto')
const path = require('path')
const XLSX = require('xlsx')
const { analyze, parseHexText } = require('./bt656-engine')
const {
  parseWFM8300CSV,
  parseGenericCSV,
  analyzeCSVData,
  detectCSVFormat
} = require('./csv-engine')

const app = express()
const upload = multer({ limits: { fileSize: 500 * 1024 * 1024 } })

app.use(cors())
app.use(express.json({ limit: '200mb' }))
app.use(express.static(path.join(__dirname, '..', 'public')))

const csvCache = new Map()

function cacheResult(result) {
  const sessionId = crypto.randomBytes(8).toString('hex')
  csvCache.set(sessionId, {
    result,
    createdAt: Date.now()
  })
  if (csvCache.size > 20) {
    const oldest = [...csvCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]
    csvCache.delete(oldest[0])
  }
  return sessionId
}

function getCachedResult(sessionId) {
  const entry = csvCache.get(sessionId)
  if (!entry) return null
  return entry.result
}

app.post('/api/analyze/file', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' })
    const rawData = new Uint8Array(req.file.buffer)
    const options = JSON.parse(req.body.options || '{}')
    const result = analyze(rawData, options)
    result.fileName = req.file.originalname
    result.fileSize = req.file.size
    res.json(result)
  } catch (err) {
    console.error('[API] 文件分析错误:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/analyze/hex', (req, res) => {
  try {
    const { hexText, options } = req.body
    if (!hexText || !hexText.trim()) return res.status(400).json({ error: '未提供Hex数据' })
    const rawData = parseHexText(hexText)
    if (rawData.length === 0) return res.status(400).json({ error: '解析后无有效数据' })
    const result = analyze(rawData, options || {})
    res.json(result)
  } catch (err) {
    console.error('[API] Hex分析错误:', err.message)
    res.status(500).json({ error: err.message })
  }
})

function buildInitialResponse(result) {
  const sessionId = cacheResult(result)
  result.sessionId = sessionId

  const resp = {
    sessionId,
    fileName: result.fileName,
    fileSize: result.fileSize,
    format: result.format,
    header: result.header,
    events: result.events,
    stats: result.stats,
    sheetNames: result.sheetNames,
    activeSheet: result.activeSheet,
    totalDataRowsAvailable: result.dataRows.length,
    totalErrorsAvailable: result.errors.length,
    totalLineStatsAvailable: result.lineStats.length
  }

  const maxDataRows = 100
  const maxErrors = 500
  const maxLineStats = 500

  resp.dataRows = result.dataRows.slice(0, maxDataRows)
  resp.dataRowsTruncated = result.dataRows.length > maxDataRows

  resp.errors = result.errors.slice(0, maxErrors)
  resp.errorsTruncated = result.errors.length > maxErrors

  resp.lineStats = result.lineStats.slice(0, maxLineStats)
  resp.lineStatsTruncated = result.lineStats.length > maxLineStats

  return resp
}

app.post('/api/analyze/csv', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' })

    const text = req.file.buffer.toString('utf-8')
    const format = detectCSVFormat(text)
    console.log(`[API] CSV格式检测: ${format}, 文件: ${req.file.originalname}, 大小: ${(req.file.size / 1024 / 1024).toFixed(1)}MB`)

    let parsedData
    if (format === 'wfm8300') {
      parsedData = parseWFM8300CSV(text)
    } else {
      parsedData = parseGenericCSV(text)
    }

    const csvOptions = JSON.parse(req.body.options || '{}')
    const result = analyzeCSVData(parsedData, csvOptions)
    result.fileName = req.file.originalname
    result.fileSize = req.file.size
    result.format = format

    const resp = buildInitialResponse(result)
    console.log(`[API] CSV分析完成: ${result.stats.totalDataRows}行, ${result.stats.totalSamples}样点, ${result.stats.totalErrors}错误, sessionId=${resp.sessionId}`)
    res.json(resp)
  } catch (err) {
    console.error('[API] CSV分析错误:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/analyze/excel', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' })

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' })
    const requestedSheet = req.body.sheetName || ''
    const sheetName = (requestedSheet && workbook.SheetNames.includes(requestedSheet))
      ? requestedSheet
      : workbook.SheetNames[0]
    console.log(`[API] Excel文件: ${req.file.originalname}, 工作表: ${sheetName}`)

    const sheet = workbook.Sheets[sheetName]
    const csvText = XLSX.utils.sheet_to_csv(sheet)

    const format = detectCSVFormat(csvText)
    console.log(`[API] Excel内容CSV格式检测: ${format}`)

    let parsedData
    if (format === 'wfm8300') {
      parsedData = parseWFM8300CSV(csvText)
    } else {
      parsedData = parseGenericCSV(csvText)
    }

    const excelOptions = JSON.parse(req.body.options || '{}')
    const result = analyzeCSVData(parsedData, excelOptions)
    result.fileName = req.file.originalname
    result.fileSize = req.file.size
    result.format = format
    result.sheetNames = workbook.SheetNames
    result.activeSheet = sheetName

    const resp = buildInitialResponse(result)
    console.log(`[API] Excel分析完成: ${result.stats.totalDataRows}行, ${result.stats.totalSamples}样点, ${result.stats.totalErrors}错误, sessionId=${resp.sessionId}`)
    res.json(resp)
  } catch (err) {
    console.error('[API] Excel分析错误:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/csv/data/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const result = getCachedResult(sessionId)
    if (!result) return res.status(404).json({ error: '会话已过期，请重新上传文件' })

    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 50
    const allRows = result.dataRows

    const totalRows = allRows.length
    const totalPages = Math.ceil(totalRows / pageSize)
    const startIdx = (page - 1) * pageSize
    const endIdx = Math.min(startIdx + pageSize, totalRows)
    const pageRows = allRows.slice(startIdx, endIdx)

    res.json({
      page,
      pageSize,
      totalRows,
      totalPages,
      dataRows: pageRows
    })
  } catch (err) {
    console.error('[API] 分页数据获取错误:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/csv/errors/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const result = getCachedResult(sessionId)
    if (!result) return res.status(404).json({ error: '会话已过期' })

    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 200
    const errorType = req.query.errorType || 'all'
    const channel = req.query.channel || 'all'

    let filtered = result.errors
    if (errorType !== 'all') filtered = filtered.filter(e => e.errorType === errorType)
    if (channel !== 'all') filtered = filtered.filter(e => e.channel === channel)

    const totalErrors = filtered.length
    const totalPages = Math.ceil(totalErrors / pageSize)
    const startIdx = (page - 1) * pageSize
    const endIdx = Math.min(startIdx + pageSize, totalErrors)

    res.json({
      page,
      pageSize,
      totalErrors,
      totalPages,
      errors: filtered.slice(startIdx, endIdx)
    })
  } catch (err) {
    console.error('[API] 错误分页获取错误:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/csv/linestats/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const result = getCachedResult(sessionId)
    if (!result) return res.status(404).json({ error: '会话已过期' })

    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 200

    const allStats = result.lineStats
    const totalStats = allStats.length
    const totalPages = Math.ceil(totalStats / pageSize)
    const startIdx = (page - 1) * pageSize
    const endIdx = Math.min(startIdx + pageSize, totalStats)

    res.json({
      page,
      pageSize,
      totalStats,
      totalPages,
      lineStats: allStats.slice(startIdx, endIdx)
    })
  } catch (err) {
    console.error('[API] 行统计分页获取错误:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/csv/row/:sessionId/:lineIndex', (req, res) => {
  try {
    const { sessionId, lineIndex } = req.params
    const result = getCachedResult(sessionId)
    if (!result) return res.status(404).json({ error: '会话已过期' })

    const idx = parseInt(lineIndex)
    if (idx < 0 || idx >= result.dataRows.length) return res.status(404).json({ error: '行不存在' })
    const row = result.dataRows[idx]

    res.json({ row, lineIndex: idx, totalRows: result.dataRows.length })
  } catch (err) {
    console.error('[API] 行数据获取错误:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/excel/sheets', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' })
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' })
    res.json({
      fileName: req.file.originalname,
      sheetNames: workbook.SheetNames,
      sheetCount: workbook.SheetNames.length
    })
  } catch (err) {
    console.error('[API] Excel工作表读取错误:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', engine: 'bt656-analyzer v1.0', features: ['binary-stream', 'csv-wfm8300', 'excel'], cacheSize: csvCache.size })
})

const PORT = process.env.PORT || 3210
app.listen(PORT, () => {
  console.log(`\n🔬 BT.656 Analyzer Server running at http://localhost:${PORT}`)
  console.log(`   API: POST /api/analyze/file       (二进制流分析)`)
  console.log(`   API: POST /api/analyze/hex        (Hex文本分析)`)
  console.log(`   API: POST /api/analyze/csv        (CSV分析)`)
  console.log(`   API: POST /api/analyze/excel      (Excel文件分析)`)
  console.log(`   API: POST /api/excel/sheets       (Excel工作表列表)`)
  console.log(`   API: GET  /api/csv/data/:id       (分页数据获取)`)
  console.log(`   API: GET  /api/csv/errors/:id     (分页错误获取)`)
  console.log(`   API: GET  /api/csv/linestats/:id  (分页行统计获取)`)
  console.log(`   API: GET  /api/csv/row/:id/:n     (单行数据获取)`)
})
