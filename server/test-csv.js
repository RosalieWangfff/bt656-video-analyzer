const http = require('http')
const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, '..', 'A001.csv')
const data = fs.readFileSync(filePath)

const boundary = '----FormBoundary' + Date.now()
const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="A001.csv"\r\nContent-Type: text/csv\r\n\r\n`
const footer = `\r\n--${boundary}--\r\n`
const body = Buffer.concat([Buffer.from(header), data, Buffer.from(footer)])

const req = http.request({
  hostname: 'localhost',
  port: 3210,
  path: '/api/analyze/csv',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length
  }
}, res => {
  let d = ''
  res.on('data', c => d += c)
  res.on('end', () => {
    try {
      const j = JSON.parse(d)
      console.log('=== CSV Analysis Test ===')
      console.log('Format:', j.format)
      console.log('Stats:', JSON.stringify(j.stats, null, 2))
      console.log('SessionId:', j.sessionId)
      console.log('DataRowsTruncated:', j.dataRowsTruncated)
      console.log('TotalDataRowsAvailable:', j.totalDataRowsAvailable)
      console.log('TotalErrorsAvailable:', j.totalErrorsAvailable)
      console.log('TotalLineStatsAvailable:', j.totalLineStatsAvailable)
      console.log('DataRows returned:', j.dataRows.length)
      console.log('Errors returned:', j.errors.length)
      console.log('LineStats returned:', j.lineStats.length)

      if (j.dataRows.length > 0) {
        const firstRow = j.dataRows[0]
        console.log('\nFirst row samples (first 4):', firstRow.samples.slice(0, 4).map(s => ({
          channel: s.channel,
          decValue: s.decValue,
          hexValue: s.hexValue,
          binValue: s.binValue,
          errorInfo: s.errorInfo
        })))
      }

      if (j.sessionId) {
        testPagination(j.sessionId)
      }
    } catch (e) {
      console.error('Parse error:', e.message)
      console.log('Raw response (first 500 chars):', d.substring(0, 500))
    }
  })
})

function testPagination(sessionId) {
  console.log('\n=== Testing Pagination API ===')

  const testPage = http.request({
    hostname: 'localhost',
    port: 3210,
    path: `/api/csv/data/${sessionId}?page=2&pageSize=10`,
    method: 'GET'
  }, res => {
    let d = ''
    res.on('data', c => d += c)
    res.on('end', () => {
      try {
        const j = JSON.parse(d)
        console.log('Page:', j.page, 'PageSize:', j.pageSize)
        console.log('TotalRows:', j.totalRows, 'TotalPages:', j.totalPages)
        console.log('DataRows returned:', j.dataRows.length)
        if (j.dataRows.length > 0) {
          console.log('First row of page 2:', j.dataRows[0].lineCount, j.dataRows[0].lineSamp)
        }
      } catch (e) {
        console.error('Pagination test error:', e.message)
      }

      testErrors(sessionId)
    })
  })
  testPage.end()
}

function testErrors(sessionId) {
  console.log('\n=== Testing Errors API ===')

  const testErr = http.request({
    hostname: 'localhost',
    port: 3210,
    path: `/api/csv/errors/${sessionId}?page=1&pageSize=5&errorType=out_of_range`,
    method: 'GET'
  }, res => {
    let d = ''
    res.on('data', c => d += c)
    res.on('end', () => {
      try {
        const j = JSON.parse(d)
        console.log('TotalErrors (out_of_range):', j.totalErrors)
        console.log('Errors returned:', j.errors.length)
        if (j.errors.length > 0) {
          console.log('First error:', JSON.stringify(j.errors[0]))
        }
      } catch (e) {
        console.error('Errors test error:', e.message)
      }

      testRow(sessionId)
    })
  })
  testErr.end()
}

function testRow(sessionId) {
  console.log('\n=== Testing Row API ===')

  const testRowReq = http.request({
    hostname: 'localhost',
    port: 3210,
    path: `/api/csv/row/${sessionId}/5`,
    method: 'GET'
  }, res => {
    let d = ''
    res.on('data', c => d += c)
    res.on('end', () => {
      try {
        const j = JSON.parse(d)
        console.log('Row index:', j.lineIndex, 'Total rows:', j.totalRows)
        console.log('Row lineCount:', j.row.lineCount, 'lineSamp:', j.row.lineSamp)
        console.log('Row samples count:', j.row.samples.length)
        console.log('First 3 samples:', j.row.samples.slice(0, 3).map(s => ({
          channel: s.channel, decValue: s.decValue, hexValue: s.hexValue
        })))
      } catch (e) {
        console.error('Row test error:', e.message)
      }

      console.log('\n=== All Tests Complete ===')
    })
  })
  testRowReq.end()
}

req.on('error', e => console.error('Request error:', e.message))
req.write(body)
req.end()
