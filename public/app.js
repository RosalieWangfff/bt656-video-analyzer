const { createApp, ref, reactive, computed, watch, onMounted } = Vue

createApp({
  setup() {
    const fileInput = ref(null)
    const fileName = ref('')
    const fileSize = ref(0)
    const selectedFile = ref(null)
    const hexText = ref('')
    const isDragging = ref(false)

    const inputMode = ref('stream')

    const config = reactive({ width: 1920, tolerance: 5, packMode: 'packed_4to5', initialOffset: 0 })

    const analyzing = ref(false)
    const analysisDone = ref(false)
    const activeTab = ref('table')
    const currentPage = ref(1)
    const pageSize = 200
    const serverOk = ref(false)
    const apiUrl = ref('http://localhost:3210')

    const filterType = ref('all')
    const filterChannel = ref('all')
    const hexDisplayBytes = ref(2048)
    const selectedStairLine = ref(0)

    const errors = ref([])
    const stairResults = ref([])
    const stats = reactive({
      totalSamples: 0, totalY: 0, totalCbCr: 0,
      totalErrors: 0, rangeErrors: 0, staircaseErrors: 0,
      validSamples: 0, linesDetected: 0
    })
    const rawDataLength = ref(0)
    const rawDataArray = ref([])

    const csvInput = ref(null)
    const csvFileName = ref('')
    const csvFileSize = ref(0)
    const csvSelectedFile = ref(null)
    const csvFormat = ref('')
    const csvDisplayBase = ref('hex')
    const csvPageSize = ref(20)
    const csvPage = ref(1)
    const csvErrorFilter = ref('all')
    const csvErrorChannelFilter = ref('all')
    const csvErrorPage = ref(1)
    const csvErrorPageSize = 100
    const csvTab = ref('browse')
    const csvAnalysisDone = ref(false)
    const csvVisibleCols = ref(40)
    const rowDetailChannel = ref('all')
    const selectedRow = ref(null)
    const tvLineModalOpen = ref(false)
    const tvLineModalRow = ref(null)
    const csvSearchQuery = ref('')
    const jumpToLine = ref(null)
    const excelSheetNames = ref([])
    const selectedSheetName = ref('')

    const csvSessionId = ref('')
    const csvTotalDataRowsAvailable = ref(0)
    const csvTotalErrorsAvailable = ref(0)
    const csvTotalLineStatsAvailable = ref(0)
    const csvDataRowsTruncated = ref(false)
    const csvLoading = ref(false)

    const csvStats = reactive({
      totalSamples: 0, totalY: 0, totalCbCr: 0,
      totalErrors: 0, rangeErrors: 0, staircaseErrors: 0,
      validSamples: 0, totalDataRows: 0, videoFormat: ''
    })
    const csvHeader = reactive({})
    const csvEvents = reactive({})
    const showWfmHeader = ref(true)
    const csvErrors = ref([])
    const csvLineStats = ref([])
    const csvDataRows = ref([])

    onMounted(() => {
      checkServerHealth()
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && tvLineModalOpen.value) {
          closeTvLineModal()
        }
      })
    })

    async function checkServerHealth() {
      try {
        const res = await fetch(`${apiUrl.value}/api/health`)
        if (res.ok) {
          serverOk.value = true
          console.log('[Frontend] 后端已连接:', await res.json())
        }
      } catch { serverOk.value = false }
    }

    const hasData = computed(() => {
      if (inputMode.value === 'stream') {
        return selectedFile.value || hexText.value.trim().length > 0
      }
      return csvSelectedFile.value !== null
    })

    const errorRatePercent = computed(() => {
      if (stats.totalSamples === 0) return '0.00'
      return ((stats.totalErrors / stats.totalSamples) * 100).toFixed(3)
    })
    const errorRateColor = computed(() => {
      const rate = parseFloat(errorRatePercent.value)
      if (rate === 0) return 'var(--accent-green)'
      if (rate < 1) return 'var(--accent-orange)'
      return 'var(--accent-red)'
    })
    const filteredErrors = computed(() => {
      let list = errors.value
      if (filterType.value !== 'all') list = list.filter(e => e.type === filterType.value)
      if (filterChannel.value !== 'all') list = list.filter(e => e.channel === filterChannel.value)
      return list
    })
    const totalPages = computed(() => Math.max(1, Math.ceil(filteredErrors.value.length / pageSize)))
    const paginatedErrors = computed(() => {
      const start = (currentPage.value - 1) * pageSize
      return filteredErrors.value.slice(start, start + pageSize)
    })
    watch([filterType, filterChannel], () => { currentPage.value = 1 })

    const hexLines = computed(() => {
      if (!rawDataArray.value.length) return []
      const bytesPerLine = 16
      const total = Math.min(hexDisplayBytes.value, rawDataArray.value.length)
      const lines = []
      for (let i = 0; i < total; i += bytesPerLine) {
        const rowBytes = []
        for (let j = 0; j < bytesPerLine && (i + j) < total; j++) {
          const bval = rawDataArray.value[i + j]
          const byteIdx = i + j
          const hasErr = errors.value.some(e =>
            e.byteOffset <= byteIdx && byteIdx < e.byteOffset + (config.packMode === 'packed_4to5' ? 5 : 2)
          )
          rowBytes.push({ hex: bval.toString(16).toUpperCase().padStart(2, '0'), val: bval, offset: byteIdx, hasError: hasErr })
        }
        lines.push({ offsetStr: i.toString(16).toUpperCase().padStart(8, '0'), bytes: rowBytes })
      }
      return lines
    })
    const currentStair = computed(() => {
      if (!stairResults.value.length) return null
      return stairResults.value[selectedStairLine.value] || stairResults.value[0]
    })

    const csvErrorRatePercent = computed(() => {
      if (csvStats.totalSamples === 0) return '0.00'
      return ((csvStats.totalErrors / csvStats.totalSamples) * 100).toFixed(3)
    })
    const csvErrorRateColor = computed(() => {
      const rate = parseFloat(csvErrorRatePercent.value)
      if (rate === 0) return 'var(--accent-green)'
      if (rate < 1) return 'var(--accent-orange)'
      return 'var(--accent-red)'
    })

    const csvTotalPages = computed(() => {
      const total = csvDataRowsTruncated.value ? csvTotalDataRowsAvailable.value : csvDataRows.value.length
      return Math.max(1, Math.ceil(total / csvPageSize.value))
    })

    const csvPageData = computed(() => {
      if (csvDataRowsTruncated.value) {
        return csvDataRows.value
      }
      const start = (csvPage.value - 1) * csvPageSize.value
      return csvDataRows.value.slice(start, start + csvPageSize.value)
    })

    watch([csvErrorFilter, csvPageSize], () => {
      csvPage.value = 1
      if (csvDataRowsTruncated.value && csvSessionId.value) {
        fetchCSVPage(1)
      }
    })

    const filteredCSVErrors = computed(() => {
      let list = csvErrors.value
      if (csvErrorFilter.value !== 'all' && csvErrorFilter.value !== 'errors') {
        list = list.filter(e => e.errorType === csvErrorFilter.value)
      }
      if (csvErrorChannelFilter.value !== 'all') {
        list = list.filter(e => e.channel === csvErrorChannelFilter.value)
      }
      return list
    })
    const csvErrorTotalPages = computed(() => Math.max(1, Math.ceil(filteredCSVErrors.value.length / csvErrorPageSize)))
    const paginatedCSVErrors = computed(() => {
      const start = (csvErrorPage.value - 1) * csvErrorPageSize
      return filteredCSVErrors.value.slice(start, start + csvErrorPageSize)
    })

    const filteredRowSamples = computed(() => {
      if (!selectedRow.value) return []
      if (rowDetailChannel.value === 'all') return selectedRow.value.samples
      return selectedRow.value.samples.filter(s => s.channel === rowDetailChannel.value)
    })

    const sampleGroups = computed(() => {
      if (!tvLineModalRow.value || !tvLineModalRow.value.samples) return []
      const samples = tvLineModalRow.value.samples
      const groups = []
      for (let i = 0; i < samples.length; i += 4) {
        groups.push({
          groupIndex: Math.floor(i / 4),
          samples: samples.slice(i, i + 4)
        })
      }
      return groups
    })

    const waveformWidth = computed(() => Math.min(800, Math.max(300, selectedRow.value ? selectedRow.value.samples.length : 300)))

    const yWaveformPoints = computed(() => {
      if (!selectedRow.value) return ''
      const ySamples = selectedRow.value.samples.filter(s => s.channel === 'Y')
      if (ySamples.length === 0) return ''
      const step = waveformWidth.value / ySamples.length
      return ySamples.map((s, i) => {
        const x = i * step
        const y = 120 - (s.decValue / 1024) * 120
        return `${x},${y}`
      }).join(' ')
    })

    const cbWaveformPoints = computed(() => {
      if (!selectedRow.value) return ''
      const cbSamples = selectedRow.value.samples.filter(s => s.channel === 'Cb')
      if (cbSamples.length === 0) return ''
      const step = waveformWidth.value / cbSamples.length
      return cbSamples.map((s, i) => {
        const x = i * step
        const y = 120 - (s.decValue / 1024) * 120
        return `${x},${y}`
      }).join(' ')
    })

    const crWaveformPoints = computed(() => {
      if (!selectedRow.value) return ''
      const crSamples = selectedRow.value.samples.filter(s => s.channel === 'Cr')
      if (crSamples.length === 0) return ''
      const step = waveformWidth.value / crSamples.length
      return crSamples.map((s, i) => {
        const x = i * step
        const y = 120 - (s.decValue / 1024) * 120
        return `${x},${y}`
      }).join(' ')
    })

    const rowChannelStats = computed(() => {
      if (!selectedRow.value || !selectedRow.value.samples) {
        return { Y: { mean: '-', min: '-', max: '-' }, Cb: { mean: '-' }, Cr: { mean: '-' } }
      }
      const samples = selectedRow.value.samples
      const calcStats = (arr) => {
        if (arr.length === 0) return { mean: '-', min: '-', max: '-' }
        const vals = arr.map(s => s.decValue)
        const mean = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
        const min = Math.min(...vals)
        const max = Math.max(...vals)
        return { mean, min, max }
      }
      return {
        Y: calcStats(samples.filter(s => s.channel === 'Y')),
        Cb: calcStats(samples.filter(s => s.channel === 'Cb')),
        Cr: calcStats(samples.filter(s => s.channel === 'Cr'))
      }
    })

    const rowErrorRate = computed(() => {
      if (!selectedRow.value || !selectedRow.value.samples) return '0.00'
      const total = selectedRow.value.samples.length
      const errCount = selectedRow.value.samples.filter(s => s.errorInfo && s.errorInfo.hasError).length
      if (total === 0) return '0.00'
      return ((errCount / total) * 100).toFixed(2)
    })

    const errorDistPercent = computed(() => {
      const total = csvStats.rangeErrors + csvStats.staircaseErrors
      if (total === 0) return { range: 0, staircase: 0 }
      return {
        range: (csvStats.rangeErrors / total) * 100,
        staircase: (csvStats.staircaseErrors / total) * 100
      }
    })

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
      return (bytes / 1048576).toFixed(2) + ' MB'
    }

    function handleDrop(e) {
      isDragging.value = false
      const f = e.dataTransfer.files[0]
      if (f) loadFile(f)
    }
    function handleFileSelect(e) {
      const f = e.target.files[0]
      if (f) loadFile(f)
    }
    function loadFile(file) {
      fileName.value = file.name
      fileSize.value = file.size
      selectedFile.value = file
    }
    function clearFile() {
      fileName.value = ''
      fileSize.value = 0
      selectedFile.value = null
      if (fileInput.value) fileInput.value.value = ''
    }

    function handleCSVDrop(e) {
      isDragging.value = false
      const f = e.dataTransfer.files[0]
      if (f) loadCSVFile(f)
    }
    function handleCSVSelect(e) {
      const f = e.target.files[0]
      if (f) loadCSVFile(f)
    }
    function loadCSVFile(file) {
      csvFileName.value = file.name
      csvFileSize.value = file.size
      csvSelectedFile.value = file
      csvFormat.value = ''
      excelSheetNames.value = []
      selectedSheetName.value = ''

      const ext = file.name.toLowerCase().split('.').pop()
      if ((ext === 'xlsx' || ext === 'xls') && serverOk.value) {
        const formData = new FormData()
        formData.append('file', file)
        fetch(`${apiUrl.value}/api/excel/sheets`, { method: 'POST', body: formData })
          .then(res => res.json())
          .then(data => {
            if (data.sheetNames && data.sheetNames.length > 0) {
              excelSheetNames.value = data.sheetNames
              selectedSheetName.value = data.sheetNames[0]
            }
          })
          .catch(() => {})
      }
    }
    function clearCSVFile() {
      csvFileName.value = ''
      csvFileSize.value = 0
      csvSelectedFile.value = null
      csvFormat.value = ''
      excelSheetNames.value = []
      selectedSheetName.value = ''
      if (csvInput.value) csvInput.value.value = ''
    }

    function formatSampleValue(sample) {
      if (csvDisplayBase.value === 'hex') return sample.hexValue
      if (csvDisplayBase.value === 'dec') return String(sample.decValue)
      return sample.binValue
    }

    function wfmRowClass(sample) {
      if (sample.decValue === 0 || sample.decValue === 0x3FF) return 'wfm-sav'
      if (sample.errorInfo && sample.errorInfo.hasError) return 'wfm-err'
      return ''
    }

    function sampleClass(sample) {
      if (sample.decValue === 0 || sample.decValue === 0x3FF) return 'sample-sav-eav'
      if (!sample.errorInfo || !sample.errorInfo.hasError) return 'sample-normal'
      if (sample.errorInfo.errorType === 'out_of_range') return 'sample-out-of-range'
      if (sample.errorInfo.errorType === 'staircase') return 'sample-staircase'
      return 'sample-normal'
    }

    function sampleTooltip(sample) {
      let tip = `${sample.channel} | Dec:${sample.decValue} | Hex:${sample.hexValue} | Bin:${sample.binValue}`
      if (sample.errorInfo && sample.errorInfo.hasError) {
        tip += ` | ⚠ ${sample.errorInfo.reason}`
      }
      return tip
    }

    function rowHasError(row) {
      return row.samples && row.samples.some(s => s.errorInfo && s.errorInfo.hasError)
    }

    function rowErrorCount(row, type) {
      if (!row.samples) return 0
      return row.samples.filter(s => s.errorInfo && s.errorInfo.hasError && s.errorInfo.errorType === type).length
    }

    function rowIsBlanking(row) {
      if (!row || !row.lineCount) return false
      const lc = row.lineCount
      const fmt = csvStats.videoFormat || ''
      if (fmt.includes('1080i') || fmt.includes('1080p')) {
        return lc <= 42 || (lc >= 563 && lc <= 583) || lc >= 1124
      }
      if (fmt.includes('720p')) {
        return lc <= 25 || lc >= 746
      }
      if (fmt.includes('576i') || fmt.includes('480i')) {
        return lc <= 23 || lc >= 623
      }
      return false
    }

    function rowFieldInfo(row) {
      if (!row || !row.lineCount) return '—'
      const lc = row.lineCount
      const fmt = csvStats.videoFormat || ''
      if (fmt.includes('1080i')) {
        return lc <= 562 ? 'F1' : 'F2'
      }
      if (fmt.includes('576i') || fmt.includes('480i')) {
        return lc <= 312 ? 'F1' : 'F2'
      }
      if (fmt.includes('720p') || fmt.includes('1080p')) {
        return '逐行'
      }
      return '—'
    }

    function selectRow(row) {
      selectedRow.value = row
      tvLineModalRow.value = row
      tvLineModalOpen.value = true
    }

    function openTvLineModal(row) {
      tvLineModalRow.value = row
      selectedRow.value = row
      tvLineModalOpen.value = true
    }

    function closeTvLineModal() {
      tvLineModalOpen.value = false
      tvLineModalRow.value = null
    }

    function selectRowByLineIndex(idx) {
      if (csvDataRows.value[idx]) {
        openTvLineModal(csvDataRows.value[idx])
      }
    }

    async function fetchCSVPage(page) {
      if (!csvSessionId.value || !csvDataRowsTruncated.value) return
      csvLoading.value = true
      try {
        const res = await fetch(`${apiUrl.value}/api/csv/data/${csvSessionId.value}?page=${page}&pageSize=${csvPageSize.value}`)
        if (res.ok) {
          const data = await res.json()
          csvDataRows.value = data.dataRows
        }
      } catch (err) {
        console.error('[Frontend] 分页数据加载错误:', err.message)
      }
      csvLoading.value = false
    }

    watch(csvPage, (newPage) => {
      if (csvDataRowsTruncated.value && csvSessionId.value) {
        fetchCSVPage(newPage)
      }
    })

    async function fetchCSVErrors(page) {
      if (!csvSessionId.value) return
      csvLoading.value = true
      try {
        const params = new URLSearchParams({
          page: page || csvErrorPage.value,
          pageSize: csvErrorPageSize,
          errorType: csvErrorFilter.value !== 'errors' ? csvErrorFilter.value : 'all',
          channel: csvErrorChannelFilter.value
        })
        const res = await fetch(`${apiUrl.value}/api/csv/errors/${csvSessionId.value}?${params}`)
        if (res.ok) {
          const data = await res.json()
          csvErrors.value = data.errors
        }
      } catch (err) {
        console.error('[Frontend] 错误数据加载错误:', err.message)
      }
      csvLoading.value = false
    }

    async function fetchCSVLineStats(page) {
      if (!csvSessionId.value) return
      csvLoading.value = true
      try {
        const params = new URLSearchParams({
          page: page || 1,
          pageSize: 500
        })
        const res = await fetch(`${apiUrl.value}/api/csv/linestats/${csvSessionId.value}?${params}`)
        if (res.ok) {
          const data = await res.json()
          csvLineStats.value = data.lineStats
        }
      } catch (err) {
        console.error('[Frontend] 行统计数据加载错误:', err.message)
      }
      csvLoading.value = false
    }

    async function fetchCSVRow(lineIndex) {
      if (!csvSessionId.value) return null
      try {
        const res = await fetch(`${apiUrl.value}/api/csv/row/${csvSessionId.value}/${lineIndex}`)
        if (res.ok) {
          const data = await res.json()
          return data.row
        }
      } catch (err) {
        console.error('[Frontend] 行数据加载错误:', err.message)
      }
      return null
    }

    function csvSearchGo() {
      const q = csvSearchQuery.value.trim()
      if (!q) return
      const lineNum = parseInt(q)
      if (!isNaN(lineNum) && csvDataRowsTruncated.value && csvSessionId.value) {
        const targetPage = Math.ceil(lineNum / csvPageSize.value)
        csvPage.value = targetPage
        return
      }
      if (!isNaN(lineNum)) {
        const idx = csvDataRows.value.findIndex(r => r.lineCount === lineNum)
        if (idx >= 0) {
          csvPage.value = Math.floor(idx / csvPageSize.value) + 1
          return
        }
      }
      const hexQ = q.toUpperCase().replace(/^0X/, '')
      const idx = csvDataRows.value.findIndex(r =>
        r.samples && r.samples.some(s => {
          const hex = s.hexValue.toUpperCase().replace(/^0X/, '')
          return hex === hexQ || String(s.decValue) === q
        })
      )
      if (idx >= 0) {
        csvPage.value = Math.floor(idx / csvPageSize.value) + 1
      } else {
        alert('未找到匹配的数据行')
      }
    }

    async function jumpToRow() {
      if (!jumpToLine.value || jumpToLine.value < 1) return
      const idx = csvDataRows.value.findIndex(r => r.lineCount === jumpToLine.value)
      if (idx >= 0) {
        selectedRow.value = csvDataRows.value[idx]
        csvTab.value = 'rowDetail'
      } else if (csvSessionId.value) {
        const row = await fetchCSVRow(jumpToLine.value - 1)
        if (row) {
          selectedRow.value = row
          csvTab.value = 'rowDetail'
        } else {
          alert('未找到行号 ' + jumpToLine.value)
        }
      } else {
        alert('未找到行号 ' + jumpToLine.value)
      }
    }

    function navigateRow(direction) {
      if (!selectedRow.value) return
      const curIdx = csvDataRows.value.findIndex(r =>
        r.lineCount === selectedRow.value.lineCount && r.lineSamp === selectedRow.value.lineSamp
      )
      const newIdx = curIdx + direction
      if (newIdx >= 0 && newIdx < csvDataRows.value.length) {
        const row = csvDataRows.value[newIdx]
        selectedRow.value = row
        tvLineModalRow.value = row
      }
    }

    function canNavigateRow(direction) {
      if (!selectedRow.value) return false
      const curIdx = csvDataRows.value.findIndex(r =>
        r.lineCount === selectedRow.value.lineCount && r.lineSamp === selectedRow.value.lineSamp
      )
      const newIdx = curIdx + direction
      return newIdx >= 0 && newIdx < csvDataRows.value.length
    }

    function jumpToErrorRow(err) {
      const idx = csvDataRows.value.findIndex(r =>
        r.lineCount === err.lineCount && r.lineSamp === err.lineSamp
      )
      if (idx >= 0) {
        selectedRow.value = csvDataRows.value[idx]
        csvTab.value = 'rowDetail'
      }
    }

    function lineStatsBarHeight(count) {
      if (!csvLineStats.value.length) return 0
      const maxErrors = Math.max(...csvLineStats.value.map(ls => ls.totalErrors), 1)
      return Math.max(2, (count / maxErrors) * 100)
    }

    function exportCSVData() {
      if (!csvPageData.value.length) return
      const rows = csvPageData.value
      let csvContent = '行号,行/样点,'
      if (rows[0] && rows[0].samples) {
        const headers = rows[0].samples.map((s, i) => `${s.channel}_${i}`)
        csvContent += headers.join(',') + '\n'
      }
      for (const row of rows) {
        let line = `${row.lineCount},${row.lineSamp},`
        if (row.samples) {
          line += row.samples.map(s => {
            if (csvDisplayBase.value === 'hex') return s.hexValue
            if (csvDisplayBase.value === 'dec') return s.decValue
            return s.binValue
          }).join(',')
        }
        csvContent += line + '\n'
      }

      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `bt656_export_${csvDisplayBase.value}.csv`
      link.click()
      URL.revokeObjectURL(link.href)
    }

    function exportFullReport() {
      let report = 'BT.656 视频数据分析报告\n'
      report += '=' .repeat(60) + '\n\n'
      report += `文件: ${csvFileName.value}\n`
      report += `格式: ${csvFormat.value}\n`
      if (csvHeader.videoFormat) report += `视频格式: ${csvHeader.videoFormat}\n`
      if (csvHeader.totalLines) report += `总行数: ${csvHeader.totalLines}\n`
      if (csvHeader.activeLines) report += `有效行: ${csvHeader.activeLines}\n`
      if (csvHeader.capturedTime) report += `采集时间: ${csvHeader.capturedTime}\n`
      report += '\n--- 统计概要 ---\n'
      report += `总样点: ${csvStats.totalSamples}\n`
      report += `Y样点: ${csvStats.totalY}\n`
      report += `Cb/Cr样点: ${csvStats.totalCbCr}\n`
      report += `异常数据: ${csvStats.totalErrors}\n`
      report += `  越界: ${csvStats.rangeErrors}\n`
      report += `  阶梯: ${csvStats.staircaseErrors}\n`
      report += `异常比例: ${csvErrorRatePercent.value}%\n`
      report += `正常样点: ${csvStats.validSamples}\n`

      if (csvErrors.value.length > 0) {
        report += '\n--- 错误明细 ---\n'
        report += '序号,行号,行/样点,通道,Hex,Dec,Bin,错误类型,错误原因\n'
        csvErrors.value.forEach((err, i) => {
          report += `${i + 1},${err.lineCount},${err.lineSamp},${err.channel},${err.hexValue},${err.decValue},${err.binValue},${err.errorType},${err.errorReason}\n`
        })
      }

      if (csvLineStats.value.length > 0) {
        report += '\n--- 行统计 ---\n'
        report += '行号,行/样点,总样点,Y,Cb/Cr,越界,阶梯,总错误\n'
        csvLineStats.value.forEach(ls => {
          report += `${ls.lineCount},${ls.lineSamp},${ls.totalSamples},${ls.yCount},${ls.cbCrCount},${ls.rangeErrors},${ls.staircaseErrors},${ls.totalErrors}\n`
        })
      }

      const blob = new Blob(['\uFEFF' + report], { type: 'text/plain;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `bt656_full_report_${Date.now()}.txt`
      link.click()
      URL.revokeObjectURL(link.href)
    }

    function exportRowDetail() {
      if (!selectedRow.value) return
      const row = selectedRow.value
      let content = `行 #${row.lineCount} ${row.lineSamp} 详细数据\n`
      content += '=' .repeat(60) + '\n\n'
      content += '序号,通道,Hex,Dec,Bin,状态,错误原因\n'
      if (row.samples) {
        row.samples.forEach((s, i) => {
          const status = s.errorInfo && s.errorInfo.hasError ? '异常' : '正常'
          const reason = s.errorInfo && s.errorInfo.reason ? s.errorInfo.reason : ''
          content += `${i},${s.channel},${s.hexValue},${s.decValue},${s.binValue},${status},${reason}\n`
        })
      }

      const blob = new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `bt656_row_${row.lineCount}_detail.txt`
      link.click()
      URL.revokeObjectURL(link.href)
    }

    function exportErrors() {
      if (!filteredCSVErrors.value.length) return
      let content = '序号,行号,行/样点,通道,Hex,Dec,Bin,错误类型,错误原因\n'
      filteredCSVErrors.value.forEach((err, i) => {
        content += `${i + 1},${err.lineCount},${err.lineSamp},${err.channel},${err.hexValue},${err.decValue},${err.binValue},${err.errorType},${err.errorReason}\n`
      })

      const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `bt656_errors_${Date.now()}.csv`
      link.click()
      URL.revokeObjectURL(link.href)
    }

    function exportLineStats() {
      if (!csvLineStats.value.length) return
      let content = '行号,行/样点,总样点,Y,Cb/Cr,越界,阶梯,总错误\n'
      csvLineStats.value.forEach(ls => {
        content += `${ls.lineCount},${ls.lineSamp},${ls.totalSamples},${ls.yCount},${ls.cbCrCount},${ls.rangeErrors},${ls.staircaseErrors},${ls.totalErrors}\n`
      })

      const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `bt656_line_stats_${Date.now()}.csv`
      link.click()
      URL.revokeObjectURL(link.href)
    }

    async function startAnalysis() {
      if (!serverOk.value) { alert('后端服务未连接，请先启动服务器'); return }
      analyzing.value = true

      try {
        if (inputMode.value === 'stream') {
          analysisDone.value = false
          errors.value = []
          stairResults.value = []

          let result
          if (selectedFile.value) {
            const formData = new FormData()
            formData.append('file', selectedFile.value)
            formData.append('options', JSON.stringify(config))
            const res = await fetch(`${apiUrl.value}/api/analyze/file`, { method: 'POST', body: formData })
            if (!res.ok) throw new Error((await res.json()).error || '上传失败')
            result = await res.json()
          } else if (hexText.value.trim()) {
            const res = await fetch(`${apiUrl.value}/api/analyze/hex`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ hexText: hexText.value, options: config })
            })
            if (!res.ok) throw new Error((await res.json()).error || '分析失败')
            result = await res.json()
          } else { throw new Error('无输入数据') }

          Object.assign(stats, result.stats)
          errors.value = result.errors || []
          stairResults.value = result.stairResults || []
          rawDataArray.value = result.rawData || []
          rawDataLength.value = result.rawDataLength || 0
          analysisDone.value = true
          activeTab.value = 'table'

        } else if (inputMode.value === 'csv') {
          if (!csvSelectedFile.value) { throw new Error('请上传CSV/Excel文件') }
          csvAnalysisDone.value = false

          const formData = new FormData()
          formData.append('file', csvSelectedFile.value)
          formData.append('options', JSON.stringify({ width: config.width }))

          const ext = csvFileName.value.toLowerCase().split('.').pop()
          let endpoint = '/api/analyze/csv'
          if (ext === 'xlsx' || ext === 'xls') {
            endpoint = '/api/analyze/excel'
            if (selectedSheetName.value) {
              formData.append('sheetName', selectedSheetName.value)
            }
          }

          const res = await fetch(`${apiUrl.value}${endpoint}`, { method: 'POST', body: formData })
          if (!res.ok) throw new Error((await res.json()).error || '分析失败')
          const result = await res.json()

          Object.assign(csvStats, result.stats)
          Object.assign(csvHeader, result.header || {})
          Object.assign(csvEvents, result.events || {})
          csvErrors.value = result.errors || []
          csvLineStats.value = result.lineStats || []
          csvDataRows.value = result.dataRows || []
          csvFormat.value = result.format || 'unknown'

          csvSessionId.value = result.sessionId || ''
          csvTotalDataRowsAvailable.value = result.totalDataRowsAvailable || result.dataRows?.length || 0
          csvTotalErrorsAvailable.value = result.totalErrorsAvailable || result.errors?.length || 0
          csvTotalLineStatsAvailable.value = result.totalLineStatsAvailable || result.lineStats?.length || 0
          csvDataRowsTruncated.value = result.dataRowsTruncated || false

          if (result.sheetNames && result.sheetNames.length > 0) {
            excelSheetNames.value = result.sheetNames
            if (!selectedSheetName.value) {
              selectedSheetName.value = result.sheetNames[0]
            }
          }

          csvAnalysisDone.value = true
          csvTab.value = 'browse'
          csvPage.value = 1
          selectedRow.value = null
        }
      } catch (err) {
        console.error('[Frontend] 分析错误:', err.message)
        alert('分析出错: ' + err.message)
      }

      analyzing.value = false
    }

    function byteClass(byteInfo) {
      if (byteInfo.hasError) return 'error'
      if (byteInfo.val === 0xFF || byteInfo.val === 0x00) return 'sav-eav'
      return 'normal'
    }

    return {
      fileInput, fileName, fileSize, selectedFile, hexText, isDragging,
      inputMode, config,
      analyzing, analysisDone, activeTab, currentPage,
      filterType, filterChannel, hexDisplayBytes, selectedStairLine,
      errors, stairResults, stats, rawDataLength,
      serverOk, apiUrl,
      hasData, errorRatePercent, errorRateColor,
      filteredErrors, totalPages, paginatedErrors,
      hexLines, currentStair,
      csvInput, csvFileName, csvFileSize, csvSelectedFile, csvFormat,
      csvDisplayBase, csvPageSize, csvPage, csvErrorFilter,
      csvErrorChannelFilter, csvErrorPage, csvTab,
      csvAnalysisDone, csvVisibleCols, rowDetailChannel, selectedRow,
      csvStats, csvHeader, csvEvents, showWfmHeader, csvErrors, csvLineStats, csvDataRows,
      csvErrorRatePercent, csvErrorRateColor,
      csvTotalPages, csvPageData,
      filteredCSVErrors, csvErrorTotalPages, paginatedCSVErrors,
      filteredRowSamples, sampleGroups, waveformWidth,
      yWaveformPoints, cbWaveformPoints, crWaveformPoints,
      rowChannelStats, rowErrorRate, errorDistPercent,
      csvSearchQuery, jumpToLine, excelSheetNames, selectedSheetName,
      csvSessionId, csvTotalDataRowsAvailable, csvTotalErrorsAvailable,
      csvTotalLineStatsAvailable, csvDataRowsTruncated, csvLoading,
      tvLineModalOpen, tvLineModalRow,
      formatSize, handleDrop, handleFileSelect, loadFile, clearFile,
      handleCSVDrop, handleCSVSelect, loadCSVFile, clearCSVFile,
      formatSampleValue, sampleClass, sampleTooltip, rowHasError, rowErrorCount,
      rowIsBlanking, rowFieldInfo, wfmRowClass,
      selectRow, selectRowByLineIndex, openTvLineModal, closeTvLineModal, exportCSVData,
      startAnalysis, byteClass,
      csvSearchGo, jumpToRow, navigateRow, canNavigateRow,
      jumpToErrorRow, lineStatsBarHeight,
      exportFullReport, exportRowDetail, exportErrors, exportLineStats,
      fetchCSVPage, fetchCSVErrors, fetchCSVLineStats, fetchCSVRow
    }
  }
}).mount('#app')
