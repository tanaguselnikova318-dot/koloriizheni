import { useState, useRef, useCallback } from 'react'
import './App.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const TODAY = new Date().toDateString()
const HISTORY_KEY = 'kalorai_history'
const BUDGET_KEY  = 'kalorai_budget'
const ACCENTS = ['#6366f1','#f43f5e','#10b981','#f59e0b','#38bdf8','#8b5cf6','#fb923c','#ec4899']

// ── Storage ───────────────────────────────────────────────────────────────────

function loadHistory() {
  try {
    const old = localStorage.getItem('kalorai_meals')
    if (old) {
      const { date, meals } = JSON.parse(old)
      const h = { [date]: meals }
      localStorage.setItem(HISTORY_KEY, JSON.stringify(h))
      localStorage.removeItem('kalorai_meals')
      return h
    }
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}')
  } catch { return {} }
}

function loadBudget() {
  return parseInt(localStorage.getItem(BUDGET_KEY) || '2000', 10)
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function accentFor(id) { return ACCENTS[id % ACCENTS.length] }

function statusInfo(pct, over) {
  if (over)      return { text: 'Лимит превышен!',            emoji: '🚨' }
  if (pct === 0) return { text: 'Сфотографируй первое блюдо', emoji: '🌅' }
  if (pct < 25)  return { text: 'Отличный старт!',            emoji: '🌱' }
  if (pct < 50)  return { text: 'Хороший темп',               emoji: '💪' }
  if (pct < 75)  return { text: 'Уже на полпути',             emoji: '⚡' }
  if (pct < 90)  return { text: 'Притормози немного',         emoji: '🎯' }
  return               { text: 'Почти лимит!',                emoji: '⚠️' }
}

function getStreak(history) {
  let s = 0
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    if ((history[d.toDateString()] || []).length > 0) s++
    else if (i > 0) break
  }
  return s
}

function getWeeklyAvg(history) {
  let total = 0, days = 0
  for (let i = 1; i <= 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const cal = (history[d.toDateString()] || []).reduce((s, m) => s + m.calories, 0)
    if (cal > 0) { total += cal; days++ }
  }
  return days > 0 ? Math.round(total / days) : 0
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Resize + compress image to keep base64 under Vercel's 4.5MB body limit
function compressImage(file, maxPx = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('compress failed')); return }
        const reader = new FileReader()
        reader.onload = () => resolve({
          base64: reader.result.split(',')[1],
          mimeType: 'image/jpeg'
        })
        reader.onerror = reject
        reader.readAsDataURL(blob)
      }, 'image/jpeg', quality)
    }
    img.onerror = reject
    img.src = url
  })
}

async function createThumbnail(url, size = 160) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const sc = Math.min(size / img.width, size / img.height)
      const c = document.createElement('canvas')
      c.width = img.width * sc; c.height = img.height * sc
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', 0.75))
    }
    img.onerror = () => resolve(url)
    img.src = url
  })
}

// ── Voice Hook ────────────────────────────────────────────────────────────────

function useVoice() {
  const [listening, setListening]   = useState(false)
  const [transcript, setTranscript] = useState('')
  const recRef = useRef(null)
  const cbRef  = useRef(null)
  const supported = typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  const start = useCallback((onFinal) => {
    if (!supported) return
    cbRef.current = onFinal
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    rec.lang = 'ru-RU'
    rec.continuous = false
    rec.interimResults = true
    rec.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('')
      setTranscript(t)
      if (e.results[e.results.length - 1].isFinal) {
        cbRef.current?.(t)
        setListening(false)
      }
    }
    rec.onerror = () => setListening(false)
    rec.onend   = () => setListening(false)
    recRef.current = rec
    setTranscript('')
    rec.start()
    setListening(true)
  }, [supported])

  const stop  = useCallback(() => { recRef.current?.stop(); setListening(false) }, [])
  const clear = useCallback(() => setTranscript(''), [])

  return { listening, transcript, start, stop, clear, supported }
}

// ── Fuel Meter ────────────────────────────────────────────────────────────────

function FuelMeter({ consumed, budget }) {
  const pct  = Math.min((consumed / budget) * 100, 100)
  const over = consumed > budget
  const rem  = budget - consumed
  const R = 82, C = 2 * Math.PI * R
  const offset = C - (pct / 100) * C
  const color = over ? '#f43f5e' : pct >= 75 ? '#fb923c' : pct >= 50 ? '#facc15' : '#10b981'
  const glow  = over ? 'rgba(244,63,94,0.45)' : pct >= 75 ? 'rgba(251,146,60,0.4)' : pct >= 50 ? 'rgba(250,204,21,0.3)' : 'rgba(16,185,129,0.38)'
  const { text, emoji } = statusInfo(pct, over)

  return (
    <div className="fuel-meter">
      <div className="fuel-ring" style={{ '--glow': glow, '--color': color }}>
        <svg width="224" height="224" viewBox="0 0 224 224">
          <defs>
            <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.45" />
            </linearGradient>
          </defs>
          <circle cx="112" cy="112" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" />
          <circle cx="112" cy="112" r={R} fill="none" stroke="url(#rg)" strokeWidth="14" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={offset} transform="rotate(-90 112 112)"
            style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease' }}
          />
        </svg>
        <div className="fuel-center">
          <span className="fuel-number" style={{ color }}>
            {over ? `+${Math.abs(rem).toLocaleString()}` : rem.toLocaleString()}
          </span>
          <span className="fuel-label">{over ? 'сверх нормы' : 'ккал осталось'}</span>
          <span className="fuel-sub">{consumed.toLocaleString()} / {budget.toLocaleString()}</span>
        </div>
      </div>
      <div className="status-msg">
        <span className="status-emoji">{emoji}</span>
        <span className="status-text">{text}</span>
      </div>
    </div>
  )
}

// ── Stats Row ─────────────────────────────────────────────────────────────────

function StatsRow({ streak, mealsToday, weeklyAvg }) {
  return (
    <div className="stats-row">
      <div className="stat-card">
        <span className="stat-icon">🔥</span>
        <span className="stat-value">{streak}</span>
        <span className="stat-label">дней подряд</span>
      </div>
      <div className="stat-card">
        <span className="stat-icon">🍽️</span>
        <span className="stat-value">{mealsToday}</span>
        <span className="stat-label">блюд сегодня</span>
      </div>
      <div className="stat-card">
        <span className="stat-icon">📊</span>
        <span className="stat-value">{weeklyAvg > 0 ? weeklyAvg.toLocaleString() : '—'}</span>
        <span className="stat-label">ср. за неделю</span>
      </div>
    </div>
  )
}

// ── Macro Bar ─────────────────────────────────────────────────────────────────

function MacroBar({ label, value, max, gradient }) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div className="macro-bar">
      <div className="macro-bar-head">
        <span>{label}</span>
        <span>{Math.round(value)}г</span>
      </div>
      <div className="macro-track">
        <div className="macro-fill" style={{ width: `${pct}%`, background: gradient }} />
      </div>
    </div>
  )
}

// ── History Chart ─────────────────────────────────────────────────────────────

function HistoryChart({ history, budget }) {
  const [period, setPeriod] = useState('week')

  // 7 days
  const weekData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i))
    const key = d.toDateString()
    const calories = (history[key] || []).reduce((s, m) => s + m.calories, 0)
    const label = 6 - i === 0 ? 'Сег' : d.toLocaleDateString('ru-RU', { weekday: 'short' })
    return { key, calories, label, isToday: 6 - i === 0 }
  })

  // 30 days
  const monthData = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i))
    const key = d.toDateString()
    const calories = (history[key] || []).reduce((s, m) => s + m.calories, 0)
    const dayNum = d.getDate()
    const label = i === 0 || i === 29 || dayNum % 5 === 0 ? String(dayNum) : ''
    return { key, calories, label, isToday: i === 29 }
  })

  // 12 months (average per day in each month)
  const yearData = Array.from({ length: 12 }, (_, i) => {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1)
    const yr = target.getFullYear(), mo = target.getMonth()
    const daysInMonth = new Date(yr, mo + 1, 0).getDate()
    let total = 0, days = 0
    for (let day = 1; day <= daysInMonth; day++) {
      const cal = (history[new Date(yr, mo, day).toDateString()] || []).reduce((s, m) => s + m.calories, 0)
      if (cal > 0) { total += cal; days++ }
    }
    const isCurrent = yr === now.getFullYear() && mo === now.getMonth()
    return {
      key: `${yr}-${mo}`,
      calories: days > 0 ? Math.round(total / days) : 0,
      label: target.toLocaleDateString('ru-RU', { month: 'short' }),
      isToday: isCurrent
    }
  })

  const data   = period === 'week' ? weekData : period === 'month' ? monthData : yearData
  const maxCal = Math.max(...data.map(d => d.calories), budget)

  const subLabel = period === 'year'
    ? 'средн. ккал/день по месяцам'
    : `норма ${budget.toLocaleString()} ккал`

  return (
    <div className="history-chart glass">
      <div className="history-header">
        <span className="section-title">История</span>
        <div className="period-tabs">
          {[['week','7д'],['month','30д'],['year','Год']].map(([p, lbl]) => (
            <button key={p}
              className={`period-tab ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      <p className="history-sub">{subLabel}</p>
      <div className={`chart-area ${period === 'month' ? 'chart-dense' : ''}`}>
        {data.map(day => {
          const barH   = day.calories > 0 ? Math.max((day.calories / maxCal) * 100, 4) : 0
          const budgetH = (budget / maxCal) * 100
          const over   = day.calories > budget
          return (
            <div key={day.key} className={`chart-col ${day.isToday ? 'today' : ''}`}>
              <div className="bar-wrap">
                {day.calories > 0 && period !== 'month' && (
                  <span className="bar-val">{(day.calories / 1000).toFixed(1)}к</span>
                )}
                <div className="bar-track">
                  <div className="budget-line" style={{ bottom: `${budgetH}%` }} />
                  <div className="bar-fill" style={{
                    height: `${barH}%`,
                    background: over
                      ? 'linear-gradient(to top,#f43f5e,#fb7185)'
                      : day.isToday
                      ? 'linear-gradient(to top,#6366f1,#a5b4fc)'
                      : period === 'year'
                      ? 'linear-gradient(to top,rgba(34,211,238,0.7),rgba(103,232,249,0.35))'
                      : 'linear-gradient(to top,rgba(99,102,241,0.55),rgba(165,180,252,0.3))'
                  }} />
                </div>
              </div>
              {day.label && <span className="bar-label">{day.label}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Meal Card ─────────────────────────────────────────────────────────────────

function MealCard({ meal, onDelete }) {
  const accent = accentFor(meal.id % ACCENTS.length)
  return (
    <div className="meal-card" style={{ '--accent': accent }}>
      <div className="meal-img-wrap">
        {meal.imageUrl ? (
          <>
            <img src={meal.imageUrl} alt={meal.foodName}
              onError={e => { e.target.style.display='none'; e.target.nextElementSibling.style.display='flex' }}
            />
            <div className="meal-img-fallback" style={{ background: accent }}>
              {meal.foodName?.[0] ?? '🍽'}
            </div>
          </>
        ) : (
          <div className="meal-img-fallback" style={{ background: accent, display:'flex' }}>
            🎙️
          </div>
        )}
        <button className="meal-del" onClick={() => onDelete(meal.id)}>×</button>
      </div>
      <div className="meal-body">
        <span className="meal-name">{meal.foodName}</span>
        <span className="meal-kcal" style={{ color: accent }}>{meal.calories} ккал</span>
        <div className="meal-macros">
          <span className="tag protein">Б {meal.protein}г</span>
          <span className="tag carbs">У {meal.carbs}г</span>
          <span className="tag fat">Ж {meal.fat}г</span>
        </div>
        <span className="meal-time">{meal.time}</span>
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [history,        setHistory]        = useState(loadHistory)
  const [budget,         setBudget]         = useState(loadBudget)
  const [analyzing,      setAnalyzing]      = useState(false)
  const [dragOver,       setDragOver]       = useState(false)
  const [pendingResult,  setPendingResult]  = useState(null)
  const [pendingImage,   setPendingImage]   = useState(null)
  const [pendingBase64,  setPendingBase64]  = useState(null)
  const [pendingMime,    setPendingMime]    = useState(null)
  const [showSettings,   setShowSettings]   = useState(false)
  const [error,          setError]          = useState(null)
  const [voiceCommitted, setVoiceCommitted] = useState('')
  const fileRef = useRef(null)
  const voice   = useVoice()

  const meals        = history[TODAY] || []
  const consumed     = meals.reduce((s, m) => s + m.calories, 0)
  const totalProtein = meals.reduce((s, m) => s + (m.protein || 0), 0)
  const totalCarbs   = meals.reduce((s, m) => s + (m.carbs   || 0), 0)
  const totalFat     = meals.reduce((s, m) => s + (m.fat     || 0), 0)
  const streak       = getStreak(history)
  const weeklyAvg    = getWeeklyAvg(history)
  const hasHistory   = Object.keys(history).length > 0

  const saveHistory = (h) => {
    setHistory(h)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h))
  }

  const callAPI = async (body) => {
    const res  = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data
  }

  // Photo analysis (+ optional voice hint)
  const analyzeImage = async (file, hint = '') => {
    if (!file?.type.startsWith('image/')) return
    setError(null); setAnalyzing(true)
    const imageUrl = URL.createObjectURL(file)
    setPendingImage(imageUrl)
    try {
      const { base64, mimeType } = await compressImage(file)
      setPendingBase64(base64); setPendingMime(mimeType)
      const data = await callAPI({ base64, mimeType, voiceHint: hint })
      setPendingResult({ ...data, imageUrl })
    } catch (e) {
      setError(e.message); setPendingImage(null)
    } finally { setAnalyzing(false) }
  }

  // Voice-only (no photo)
  const analyzeText = async (text) => {
    if (!text.trim()) return
    setError(null); setAnalyzing(true)
    setPendingImage(null); setPendingBase64(null)
    try {
      const data = await callAPI({ voiceHint: text, textOnly: true })
      setPendingResult({ ...data, imageUrl: null })
    } catch (e) {
      setError(e.message)
    } finally { setAnalyzing(false) }
  }

  // Re-analyze with voice correction (same photo)
  const refineResult = async (hint) => {
    if (!hint.trim()) return
    setError(null); setAnalyzing(true)
    const prevImg = pendingResult?.imageUrl
    try {
      const body = pendingBase64
        ? { base64: pendingBase64, mimeType: pendingMime, voiceHint: hint }
        : { voiceHint: hint, textOnly: true }
      const data = await callAPI(body)
      setPendingResult({ ...data, imageUrl: prevImg })
    } catch (e) {
      setError(e.message)
    } finally { setAnalyzing(false) }
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false)
    analyzeImage(e.dataTransfer.files[0])
  }, [])

  const addMeal = async () => {
    const thumb = pendingResult.imageUrl ? await createThumbnail(pendingResult.imageUrl) : null
    const id = Date.now()
    const meal = {
      id, ...pendingResult, imageUrl: thumb,
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    }
    saveHistory({ ...history, [TODAY]: [meal, ...meals] })
    setPendingResult(null); setPendingImage(null)
    setPendingBase64(null); setPendingMime(null)
    setVoiceCommitted(''); voice.clear()
  }

  const deleteMeal  = (id) => saveHistory({ ...history, [TODAY]: meals.filter(m => m.id !== id) })
  const updateBudget = (val) => {
    const v = Math.max(500, Math.min(10000, parseInt(val) || 2000))
    setBudget(v); localStorage.setItem(BUDGET_KEY, v)
  }
  const cancelPending = () => {
    setPendingResult(null); setPendingImage(null)
    setPendingBase64(null); setPendingMime(null)
    setVoiceCommitted(''); voice.clear(); setError(null)
  }

  // Voice button handlers
  const handleVoiceRecord = () => {
    if (voice.listening) { voice.stop(); return }
    voice.start((final) => setVoiceCommitted(final))
  }

  const handleVoiceSubmit = () => {
    const txt = voiceCommitted || voice.transcript
    if (txt.trim()) { analyzeText(txt); setVoiceCommitted(''); voice.clear() }
  }

  const handleVoiceRefine = () => {
    if (voice.listening) { voice.stop(); return }
    voice.start((final) => refineResult(final))
  }

  const showUpload   = !analyzing && !pendingResult
  const voiceDisplay = voice.listening ? voice.transcript : voiceCommitted
  const proteinMax   = budget * 0.25 / 4
  const carbsMax     = budget * 0.50 / 4
  const fatMax       = budget * 0.25 / 9

  return (
    <div className="app">
      <div className="bg-blobs" />

      <header className="header">
        <div className="logo">
          <span className="logo-icon">🔥</span>
          <span>KalorAI</span>
        </div>
        <button className={`icon-btn ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings(s => !s)}>⚙️</button>
      </header>

      {showSettings && (
        <div className="settings glass slide-down">
          <label className="settings-label">Дневная норма калорий</label>
          <div className="settings-row">
            <input className="settings-input" type="number"
              value={budget} min="500" max="10000" step="50"
              onChange={e => updateBudget(e.target.value)} />
            <span className="settings-unit">ккал</span>
          </div>
        </div>
      )}

      <main className="main">
        <FuelMeter consumed={consumed} budget={budget} />
        <StatsRow streak={streak} mealsToday={meals.length} weeklyAvg={weeklyAvg} />

        {meals.length > 0 && (
          <div className="macros-panel glass">
            <MacroBar label="Белки"    value={totalProtein} max={proteinMax} gradient="linear-gradient(90deg,#818cf8,#6366f1)" />
            <MacroBar label="Углеводы" value={totalCarbs}   max={carbsMax}   gradient="linear-gradient(90deg,#38bdf8,#22d3ee)" />
            <MacroBar label="Жиры"     value={totalFat}     max={fatMax}     gradient="linear-gradient(90deg,#fb923c,#f59e0b)" />
          </div>
        )}

        {error && (
          <div className="error-box glass">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* ── Upload + Voice ── */}
        {showUpload && (
          <div className="upload-area">
            <div className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}>
              <div className="upload-icon">📸</div>
              <p className="upload-title">Сфотографируй еду</p>
              <p className="upload-hint">или перетащи фото сюда</p>
              <input ref={fileRef} type="file" accept="image/*" hidden
                onChange={e => analyzeImage(e.target.files[0])} />
            </div>

            {voice.supported && (
              <div className="voice-section">
                <div className="voice-divider"><span>или опиши голосом</span></div>
                <div className="voice-row">
                  <button
                    className={`voice-btn ${voice.listening ? 'listening' : ''}`}
                    onClick={handleVoiceRecord}>
                    <span className="voice-icon">{voice.listening ? '⏹' : '🎙️'}</span>
                    <span>{voice.listening ? 'Остановить' : 'Уточнить'}</span>
                    {voice.listening && <span className="voice-pulse" />}
                  </button>
                  {voiceDisplay && (
                    <button className="btn-primary voice-submit-btn" onClick={handleVoiceSubmit}>
                      Анализировать
                    </button>
                  )}
                </div>
                {voiceDisplay && (
                  <div className="voice-transcript">
                    <span className="voice-transcript-text">
                      {voiceDisplay || '...'}
                    </span>
                  </div>
                )}
                {voice.listening && !voiceDisplay && (
                  <div className="voice-transcript">
                    <span className="voice-transcript-text muted">Слушаю...</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Analyzing ── */}
        {analyzing && (
          <div className="analyzing glass">
            {pendingImage ? (
              <>
                <img src={pendingImage} alt="preview" className="analyzing-img" />
                <div className="analyzing-overlay">
                  <div className="spinner" />
                  <p>Анализирую состав...</p>
                </div>
              </>
            ) : (
              <div className="analyzing-text">
                <div className="spinner" />
                <p>Определяю калории...</p>
              </div>
            )}
          </div>
        )}

        {/* ── Result ── */}
        {pendingResult && (
          <div className="result glass slide-up">
            {pendingResult.imageUrl && (
              <img src={pendingResult.imageUrl} alt={pendingResult.foodName} className="result-img" />
            )}
            <div className="result-body">
              <div className="result-head">
                <div>
                  <h2 className="result-name">{pendingResult.foodName}</h2>
                  <p className="result-desc">{pendingResult.description}</p>
                </div>
                {pendingResult.confidence === 'low' && (
                  <span className="confidence-badge">~приблизительно</span>
                )}
              </div>
              <div className="result-kcal">{pendingResult.calories}<span> ккал</span></div>
              <div className="result-tags">
                <span className="tag protein">Б {pendingResult.protein}г</span>
                <span className="tag carbs">У {pendingResult.carbs}г</span>
                <span className="tag fat">Ж {pendingResult.fat}г</span>
              </div>
              {pendingResult.items?.length > 1 && (
                <div className="result-items">
                  {pendingResult.items.map((item, i) => (
                    <div key={i} className="result-item">
                      <span>{item.name}</span>
                      <span>{item.calories} ккал</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Voice refinement */}
              {voice.supported && (
                <div className="voice-refine">
                  <button
                    className={`voice-refine-btn ${voice.listening ? 'listening' : ''}`}
                    onClick={handleVoiceRefine}>
                    {voice.listening
                      ? <><span>⏹</span> Остановить</>
                      : <><span>🎙️</span> Уточнить вес или состав</>}
                    {voice.listening && <span className="voice-pulse-sm" />}
                  </button>
                  {voice.transcript && (
                    <div className="voice-transcript-sm">«{voice.transcript}»</div>
                  )}
                </div>
              )}

              <div className="result-actions">
                <button className="btn-primary" onClick={addMeal}>+ В журнал</button>
                <button className="btn-ghost" onClick={cancelPending}>Отмена</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Meal Log ── */}
        {meals.length > 0 && (
          <section className="meal-log">
            <h3 className="section-title">Сегодня</h3>
            <div className="meal-list">
              {meals.map(m => <MealCard key={m.id} meal={m} onDelete={deleteMeal} />)}
            </div>
          </section>
        )}

        {hasHistory && <HistoryChart history={history} budget={budget} />}

        {meals.length === 0 && showUpload && (
          <p className="empty">Сфотографируй первое блюдо, чтобы начать 🍽️</p>
        )}
      </main>
    </div>
  )
}
