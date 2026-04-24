import { useState, useEffect, useRef } from 'react'
import { GOOGLE_CLIENT_ID } from './config'
import './FlappyMole.css'

const BOARD_W = 400
const BOARD_H = 640
const MOLE_SIZE = 32
const MOLE_SCREEN_Y = 180

const BUOYANCY = -0.22
const DIG_FORCE = 0.95
const VY_MAX = 11
const VY_MIN = -3.2

const STEER_ACCEL = 0.55
const STEER_MAX = 5.5
const STEER_DECAY = 0.88

const WALL_H = 22
const OBSTACLE_SPACING = 220
const FIRST_OBSTACLE_Y = 520
const GAP_W_START = 160
const GAP_W_MIN = 74

const PX_PER_METER = 10

// Ramps from 0.45 at surface to 1.0 at ~1800 world px, so early dig is slow.
function intensity(worldY) {
  return Math.min(1.0, 0.45 + (worldY / 1800) * 0.55)
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

function decodeJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(atob(base64).split('').map(c =>
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''))
    return JSON.parse(json)
  } catch { return null }
}

const firstName = (name) => (name || '').trim().split(/\s+/)[0] || name || ''

function Avatar({ src, name, size = 24 }) {
  const [failed, setFailed] = useState(false)
  const initials = (name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()
  if (!src || failed) {
    return (
      <div className="fm-avatar fm-avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.42 }}>
        {initials}
      </div>
    )
  }
  return (
    <img
      className="fm-avatar"
      src={src}
      alt={name}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

const LB_PER_PAGE = 10

function Leaderboard({ data, highlightSub }) {
  const [page, setPage] = useState(0)
  const totalPages = Math.ceil(data.length / LB_PER_PAGE)
  const slice = data.slice(page * LB_PER_PAGE, (page + 1) * LB_PER_PAGE)

  useEffect(() => {
    if (!highlightSub) return
    const idx = data.findIndex(r => r.sub === highlightSub)
    if (idx >= 0) setPage(Math.floor(idx / LB_PER_PAGE))
  }, [highlightSub, data])

  return (
    <div className="fm-lb">
      <p className="fm-label">Leaderboard</p>
      {data.length === 0
        ? <p className="fm-lb-empty">No scores yet. Be the first!</p>
        : (
          <>
            <ol className="fm-lb-list">
              {slice.map(r => (
                <li key={r.rank} className={`fm-lb-row ${highlightSub === r.sub ? 'fm-lb-me' : ''}`}>
                  <span className="fm-lb-rank">#{r.rank}</span>
                  <Avatar src={r.picture} name={r.name} size={28} />
                  <span className="fm-lb-nick" title={r.name}>{firstName(r.name)}</span>
                  <span className="fm-lb-score">{r.depth}m</span>
                </li>
              ))}
            </ol>
            {totalPages > 1 && (
              <div className="fm-lb-pages">
                <button
                  className="fm-lb-page-btn"
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                >←</button>
                <span className="fm-lb-page-info">{page + 1} / {totalPages}</span>
                <button
                  className="fm-lb-page-btn"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}
                >→</button>
              </div>
            )}
          </>
        )
      }
    </div>
  )
}

export default function FlappyMole() {
  const [phase, setPhase] = useState('gate')
  const [user, setUser] = useState(null)
  const [depth, setDepth] = useState(0)
  const [countdown, setCountdown] = useState(3)
  const [leaderboard, setLeaderboard] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [myRank, setMyRank] = useState(null)
  const [authError, setAuthError] = useState('')

  const canvasRef = useRef(null)
  const signInRef = useRef(null)
  const rafRef = useRef(null)
  const stateRef = useRef(null)
  const inputRef = useRef({ digging: false, left: false, right: false })
  const userRef = useRef(null)
  const audioCtxRef = useRef(null)
  const fnRef = useRef({})

  // Google Identity Services
  useEffect(() => {
    if (phase !== 'gate' || user) return
    const tryInit = () => {
      if (!window.google?.accounts?.id || !signInRef.current) return false
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          const payload = decodeJwt(response.credential)
          if (!payload) { setAuthError('Sign-in failed. Try again.'); return }
          const u = {
            idToken: response.credential,
            sub: payload.sub,
            name: payload.name || payload.email,
            picture: payload.picture || null,
          }
          userRef.current = u
          setUser(u)
          setAuthError('')
        },
        auto_select: false,
      })
      window.google.accounts.id.renderButton(signInRef.current, {
        theme: 'filled_black',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
      })
      return true
    }
    if (tryInit()) return
    const interval = setInterval(() => { if (tryInit()) clearInterval(interval) }, 100)
    return () => clearInterval(interval)
  }, [phase, user])

  // Fetch leaderboard on mount
  useEffect(() => {
    fetch('/api/flappy')
      .then(r => r.json())
      .then(d => setLeaderboard(d.leaderboard || []))
      .catch(() => {})
  }, [])

  // Countdown
  useEffect(() => {
    if (phase !== 'countdown') return
    fnRef.current.playBeep?.(countdown > 0 ? 440 : 880)
    if (countdown === 0) {
      const t = setTimeout(() => {
        setPhase('playing')
      }, 600)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, countdown])

  // Game loop
  useEffect(() => {
    if (phase !== 'playing') return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    canvas.width = BOARD_W * dpr
    canvas.height = BOARD_H * dpr
    ctx.scale(dpr, dpr)

    stateRef.current = {
      worldY: 0,
      moleX: BOARD_W / 2,
      vy: 0,
      vx: 0,
      obstacles: [],
      nextObstacleY: FIRST_OBSTACLE_Y,
      nextObstacleId: 1,
      dead: false,
      flash: 0,
      tilt: 0,
    }
    setDepth(0)

    const tick = () => {
      const s = stateRef.current
      const i = inputRef.current

      // Vertical physics — intensity ramps up with depth so early dig feels controllable
      const I = intensity(s.worldY)
      s.vy += BUOYANCY
      if (i.digging) s.vy += DIG_FORCE * I
      s.vy = clamp(s.vy, VY_MIN, VY_MAX * I)
      s.worldY = Math.max(0, s.worldY + s.vy)

      // Horizontal
      if (i.left)  s.vx -= STEER_ACCEL
      if (i.right) s.vx += STEER_ACCEL
      if (!i.left && !i.right) s.vx *= STEER_DECAY
      s.vx = clamp(s.vx, -STEER_MAX, STEER_MAX)
      s.moleX = clamp(s.moleX + s.vx, MOLE_SIZE / 2, BOARD_W - MOLE_SIZE / 2)
      s.tilt = s.vx / STEER_MAX

      // Spawn obstacles
      while (s.nextObstacleY < s.worldY + BOARD_H * 1.5) {
        const d = s.nextObstacleY
        const gapW = Math.max(GAP_W_MIN, GAP_W_START - Math.floor(d / 500) * 10)
        const gapX = gapW / 2 + 12 + Math.random() * (BOARD_W - gapW - 24)
        s.obstacles.push({ id: s.nextObstacleId++, worldY: d, gapX, gapW, passed: false })
        s.nextObstacleY += OBSTACLE_SPACING
      }

      const viewTop = s.worldY - MOLE_SCREEN_Y
      s.obstacles = s.obstacles.filter(o => o.worldY + WALL_H >= viewTop - 60)

      // Collision + pass-detection
      const moleTopW = s.worldY - MOLE_SIZE / 2
      const moleBotW = s.worldY + MOLE_SIZE / 2
      for (const o of s.obstacles) {
        if (!o.passed && o.worldY + WALL_H < s.worldY - MOLE_SIZE / 2) {
          o.passed = true
          fnRef.current.playPass?.()
        }
        const yOverlap = moleBotW > o.worldY && moleTopW < o.worldY + WALL_H
        if (!yOverlap) continue
        const moleL = s.moleX - MOLE_SIZE / 2
        const moleR = s.moleX + MOLE_SIZE / 2
        const gapL = o.gapX - o.gapW / 2
        const gapR = o.gapX + o.gapW / 2
        if (moleL < gapL || moleR > gapR) {
          s.dead = true
          s.flash = 8
          fnRef.current.playCrash?.()
          break
        }
      }

      setDepth(Math.floor(s.worldY / PX_PER_METER))

      render(ctx, s)

      if (s.dead) {
        fnRef.current.triggerGameOver()
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase])

  const render = (ctx, s) => {
    // Background bands that shift as mole descends
    const depthM = s.worldY / PX_PER_METER
    const biomeIdx = Math.min(3, Math.floor(depthM / 100))
    const biomes = [
      { top: '#3a2a1d', bot: '#241509' },     // dirt
      { top: '#3a2624', bot: '#1d0e0e' },     // clay
      { top: '#2d2129', bot: '#140c1a' },     // rock
      { top: '#1a2232', bot: '#0a1224' },     // crystal cave
    ]
    const b = biomes[biomeIdx]
    const g = ctx.createLinearGradient(0, 0, 0, BOARD_H)
    g.addColorStop(0, b.top)
    g.addColorStop(1, b.bot)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, BOARD_W, BOARD_H)

    // Scrolling dirt-speck layer for motion cue
    const parallax = s.worldY * 0.5
    ctx.save()
    ctx.globalAlpha = 0.26
    ctx.fillStyle = '#000'
    for (let i = 0; i < 70; i++) {
      const seed = i * 41.17
      const x = (seed * 17) % BOARD_W
      const y = ((seed * 23) - parallax) % BOARD_H
      const yy = y < 0 ? y + BOARD_H : y
      ctx.fillRect(x, yy, 2, 2)
    }
    ctx.restore()

    // Obstacles
    for (const o of s.obstacles) {
      const screenY = o.worldY - s.worldY + MOLE_SCREEN_Y
      if (screenY < -WALL_H || screenY > BOARD_H + WALL_H) continue
      const gapL = o.gapX - o.gapW / 2
      const gapR = o.gapX + o.gapW / 2

      // Left wall
      const wallGradL = ctx.createLinearGradient(0, screenY, 0, screenY + WALL_H)
      wallGradL.addColorStop(0, '#6b4529')
      wallGradL.addColorStop(1, '#2f1d11')
      ctx.fillStyle = wallGradL
      ctx.fillRect(0, screenY, gapL, WALL_H)
      ctx.fillRect(gapR, screenY, BOARD_W - gapR, WALL_H)

      // Rim highlight
      ctx.fillStyle = 'rgba(201,122,74,0.45)'
      ctx.fillRect(0, screenY, gapL, 2)
      ctx.fillRect(gapR, screenY, BOARD_W - gapR, 2)
    }

    // Mole
    ctx.save()
    ctx.translate(s.moleX, MOLE_SCREEN_Y)
    ctx.rotate(s.tilt * 0.35)
    // Body
    ctx.fillStyle = '#4a2e1a'
    ctx.beginPath()
    ctx.ellipse(0, 0, MOLE_SIZE / 2, MOLE_SIZE / 2 * 1.15, 0, 0, Math.PI * 2)
    ctx.fill()
    // Belly
    ctx.fillStyle = '#d9b38a'
    ctx.beginPath()
    ctx.ellipse(0, 3, MOLE_SIZE / 2 * 0.55, MOLE_SIZE / 2 * 0.7, 0, 0, Math.PI * 2)
    ctx.fill()
    // Nose
    ctx.fillStyle = '#f0a070'
    ctx.beginPath()
    ctx.ellipse(0, -MOLE_SIZE / 2 + 2, 3.5, 3, 0, 0, Math.PI * 2)
    ctx.fill()
    // Eyes
    ctx.fillStyle = '#111'
    ctx.fillRect(-6, -5, 2, 2)
    ctx.fillRect(4,  -5, 2, 2)
    // Claws
    ctx.strokeStyle = '#e8d2b0'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(-10, 8); ctx.lineTo(-13, 11)
    ctx.moveTo(-8,  9); ctx.lineTo(-10, 13)
    ctx.moveTo(10,  8); ctx.lineTo(13, 11)
    ctx.moveTo(8,   9); ctx.lineTo(10, 13)
    ctx.stroke()
    ctx.restore()

    if (s.flash > 0) {
      ctx.fillStyle = `rgba(255,60,40,${s.flash / 10})`
      ctx.fillRect(0, 0, BOARD_W, BOARD_H)
      s.flash -= 1
    }
  }

  // Audio
  fnRef.current.audio = () => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)() }
      catch { return null }
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  fnRef.current.playBeep = (freq) => {
    const ctx = fnRef.current.audio(); if (!ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.12, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
    o.connect(g); g.connect(ctx.destination)
    o.start(t); o.stop(t + 0.1)
  }

  fnRef.current.playPass = () => {
    const ctx = fnRef.current.audio(); if (!ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(520, t)
    o.frequency.exponentialRampToValueAtTime(780, t + 0.08)
    g.gain.setValueAtTime(0.06, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
    o.connect(g); g.connect(ctx.destination)
    o.start(t); o.stop(t + 0.1)
  }

  fnRef.current.playCrash = () => {
    const ctx = fnRef.current.audio(); if (!ctx) return
    const t = ctx.currentTime
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const s = ctx.createBufferSource(); s.buffer = b
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.5, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    s.connect(lp); lp.connect(g); g.connect(ctx.destination)
    s.start(t)
  }

  fnRef.current.triggerGameOver = () => {
    cancelAnimationFrame(rafRef.current)
    const finalDepth = Math.floor((stateRef.current?.worldY ?? 0) / PX_PER_METER)
    setPhase('gameover')

    if (userRef.current) {
      setSubmitting(true)
      setSubmitError('')
      fetch('/api/flappy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Id-Token': userRef.current.idToken,
        },
        body: JSON.stringify({ depth: finalDepth }),
      })
        .then(async r => {
          const data = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(data.error || `Server error ${r.status}`)
          return data
        })
        .then(d => {
          const lb = d.leaderboard || []
          setLeaderboard(lb)
          const idx = lb.findIndex(r => r.sub === userRef.current.sub)
          setMyRank(idx >= 0 ? idx + 1 : null)
        })
        .catch(err => setSubmitError(err.message || 'Could not save score.'))
        .finally(() => setSubmitting(false))
    }
  }

  // Input handlers
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'countdown') return
    const keydown = (e) => {
      if (e.key === ' ' || e.key === 'ArrowDown') { inputRef.current.digging = true; e.preventDefault() }
      if (e.key === 'ArrowLeft')  inputRef.current.left = true
      if (e.key === 'ArrowRight') inputRef.current.right = true
    }
    const keyup = (e) => {
      if (e.key === ' ' || e.key === 'ArrowDown') inputRef.current.digging = false
      if (e.key === 'ArrowLeft')  inputRef.current.left = false
      if (e.key === 'ArrowRight') inputRef.current.right = false
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      inputRef.current = { digging: false, left: false, right: false }
    }
  }, [phase])

  const onPointerDown = (e) => {
    if (phase !== 'playing') return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    inputRef.current.digging = true
    if (x < 0.33) { inputRef.current.left = true; inputRef.current.right = false }
    else if (x > 0.67) { inputRef.current.right = true; inputRef.current.left = false }
    else { inputRef.current.left = false; inputRef.current.right = false }
  }
  const onPointerMove = (e) => {
    if (phase !== 'playing' || !inputRef.current.digging) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    if (x < 0.33) { inputRef.current.left = true; inputRef.current.right = false }
    else if (x > 0.67) { inputRef.current.right = true; inputRef.current.left = false }
    else { inputRef.current.left = false; inputRef.current.right = false }
  }
  const onPointerUp = () => {
    inputRef.current.digging = false
    inputRef.current.left = false
    inputRef.current.right = false
  }

  const beginGame = () => {
    setDepth(0)
    setMyRank(null)
    setSubmitError('')
    fnRef.current.audio?.()
    setCountdown(3)
    setPhase('countdown')
  }

  const signOut = () => {
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect()
    }
    userRef.current = null
    setUser(null)
  }

  const playAgain = () => {
    cancelAnimationFrame(rafRef.current)
    setPhase('gate')
  }

  return (
    <div className="fm-page">
      <a href="https://jeules.net" className="fm-back">← Back to site</a>

      {phase === 'gate' && (
        <div className="fm-gate">
          <p className="fm-label">Mini Game</p>
          <h1 className="fm-heading">Flappy-<em>Mole.</em></h1>
          <p className="fm-sub">
            Dig as deep as you dare.<br />
            Hold to dig — release to float up. Dodge the walls.
          </p>

          {user ? (
            <div className="fm-user-card">
              <Avatar src={user.picture} name={user.name} size={44} />
              <div className="fm-user-info">
                <p className="fm-user-name" title={user.name}>Playing as <strong>{firstName(user.name)}</strong></p>
                <button className="fm-user-signout" onClick={signOut}>Sign out</button>
              </div>
              <button className="fm-btn" onClick={beginGame}>Start Game</button>
            </div>
          ) : (
            <>
              <div className="fm-auth">
                <p className="fm-auth-text">
                  Sign in with Google to save your score to the leaderboard.
                </p>
                <div ref={signInRef} className="fm-gsi-btn" />
                {authError && <p className="fm-auth-error">{authError}</p>}
              </div>
              <button className="fm-btn-ghost fm-anon" onClick={beginGame}>
                Play Anonymously
              </button>
              <p className="fm-anon-note">Anonymous scores aren't saved.</p>
            </>
          )}

          <div className="fm-controls-hint">
            <p className="fm-label">Controls</p>
            <p><strong>Desktop:</strong> Space / ↓ — dig. ← / → — steer.</p>
            <p><strong>Mobile:</strong> Tap &amp; hold — dig. Left / center / right zones steer.</p>
          </div>

          <Leaderboard data={leaderboard} highlightSub={null} />
        </div>
      )}

      {(phase === 'countdown' || phase === 'playing' || phase === 'gameover') && (
        <div className="fm-layout">
          <div className="fm-game-col">
            <div className="fm-hud">
              <div className="fm-stat fm-stat-player">
                <span className="fm-stat-label">Player</span>
                {user ? (
                  <div className="fm-stat-player-row">
                    <Avatar src={user.picture} name={user.name} size={28} />
                    <span className="fm-stat-value fm-stat-nick" title={user.name}>{firstName(user.name)}</span>
                  </div>
                ) : (
                  <span className="fm-stat-value fm-stat-nick">ANONYMOUS</span>
                )}
              </div>
              <div className="fm-stat fm-stat-right">
                <span className="fm-stat-label">Depth</span>
                <span className="fm-stat-value">{depth}m</span>
              </div>
            </div>

            <div
              className={`fm-board ${phase === 'gameover' ? 'fm-board-over' : ''}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
              style={{ touchAction: 'none' }}
            >
              <canvas
                ref={canvasRef}
                className="fm-canvas"
                style={{ width: BOARD_W, height: BOARD_H }}
              />

              {phase === 'countdown' && (
                <div className="fm-board-overlay">
                  <p key={countdown} className="fm-countdown-num">
                    {countdown > 0 ? countdown : 'DIG!'}
                  </p>
                </div>
              )}

              {phase === 'gameover' && (
                <div className="fm-board-overlay">
                  <div className="fm-over-content">
                    <p className="fm-over-title">Game Over</p>
                    <p className="fm-over-score">
                      You reached <strong>{depth}m</strong>
                    </p>
                    {user
                      ? submitting
                        ? <p className="fm-over-sub">Saving score…</p>
                        : submitError
                          ? <p className="fm-over-sub fm-over-err">Couldn't save: {submitError}</p>
                          : myRank
                            ? <p className="fm-over-sub">You ranked <strong>#{myRank}</strong> on the leaderboard</p>
                            : <p className="fm-over-sub">Score saved.</p>
                      : <p className="fm-over-sub">Playing anonymously — sign in to save your next run.</p>
                    }
                    {!submitting && (
                      <button className="fm-btn" onClick={playAgain}>Play Again</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="fm-sidebar">
            <Leaderboard
              data={leaderboard}
              highlightSub={phase === 'gameover' && user ? user.sub : null}
            />
          </div>
        </div>
      )}
    </div>
  )
}
