import { useState, useEffect, useRef } from 'react'
import { GOOGLE_CLIENT_ID } from './config'
import './FlappyMole.css'

const BOARD_W = 900
const BOARD_H = 540
const MOLE_SIZE = 30
const HITBOX_R = 10
const MOLE_SCREEN_X = 180
const BOUNCE_FRAMES = 28

const SCROLL_SPEED_START = 1.2
const SCROLL_SPEED_MAX = 3.4

const VY_MAX = 4.6
const VY_ACCEL = 0.42
const VY_DECAY = 0.80

const PIPE_W = 64
const PIPE_SPACING_START = 360
const PIPE_SPACING_MIN = 260
const FIRST_PIPE_X = 900
const GAP_H_START = 280
const GAP_H_MIN = 150
const GAP_MARGIN = 60

const PX_PER_METER = 10
const DEBUG_HITBOX = false


function scrollSpeed(distance) {
  const t = Math.min(1, distance / 12000)
  return SCROLL_SPEED_START + (SCROLL_SPEED_MAX - SCROLL_SPEED_START) * t
}
function gapHeight(distance) {
  const t = Math.min(1, Math.max(0, (distance - 1500) / 7000))
  return GAP_H_START - (GAP_H_START - GAP_H_MIN) * t
}
function pipeSpacing(distance) {
  const t = Math.min(1, Math.max(0, (distance - 1000) / 6000))
  return PIPE_SPACING_START - (PIPE_SPACING_START - PIPE_SPACING_MIN) * t
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

// === Obstacle drawing helpers ===
function drawStones(ctx, x, gapTop, gapBot, rnd, biome) {
  // Irregular rounded stones packed together
  const drawPile = (yStart, yEnd, seedOffset) => {
    const rows = 5
    const h = yEnd - yStart
    let i = seedOffset
    for (let r = 0; r < rows; r++) {
      const rowY = yStart + (h / rows) * (r + 0.5)
      const perRow = 2 + Math.floor(rnd(i) * 2) // 2 or 3 stones per row
      for (let c = 0; c < perRow; c++) {
        const cx = x + (c + 0.5) * (PIPE_W / perRow) + (rnd(i + 1) - 0.5) * 10
        const cy = rowY + (rnd(i + 2) - 0.5) * 12
        const avgR = 14 + rnd(i + 3) * 10
        const verts = 6 + Math.floor(rnd(i + 4) * 3) // 6-8 vertices for organic stone shape

        // Outline shadow under the stone
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.beginPath()
        for (let v = 0; v < verts; v++) {
          const ang = (v / verts) * Math.PI * 2
          const rr = avgR * (0.85 + rnd(i + 5 + v) * 0.3)
          const vx = cx + Math.cos(ang) * rr + 2
          const vy = cy + Math.sin(ang) * rr + 3
          if (v === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy)
        }
        ctx.closePath()
        ctx.fill()

        // Stone body (irregular polygon)
        ctx.beginPath()
        for (let v = 0; v < verts; v++) {
          const ang = (v / verts) * Math.PI * 2
          const rr = avgR * (0.85 + rnd(i + 5 + v) * 0.3)
          const vx = cx + Math.cos(ang) * rr
          const vy = cy + Math.sin(ang) * rr
          if (v === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy)
        }
        ctx.closePath()
        const grad = ctx.createLinearGradient(cx - avgR, cy - avgR, cx + avgR, cy + avgR)
        grad.addColorStop(0, '#7a6a58')
        grad.addColorStop(0.55, '#4c403a')
        grad.addColorStop(1, '#2a2420')
        ctx.fillStyle = grad
        ctx.fill()

        // Subtle outline
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'
        ctx.lineWidth = 1
        ctx.stroke()

        // Top-left specular highlight
        ctx.fillStyle = 'rgba(255,240,220,0.18)'
        ctx.beginPath()
        ctx.ellipse(cx - avgR * 0.35, cy - avgR * 0.4, avgR * 0.35, avgR * 0.2, -0.4, 0, Math.PI * 2)
        ctx.fill()

        // Tiny crack / spec
        if (rnd(i + 30) > 0.6) {
          ctx.strokeStyle = 'rgba(0,0,0,0.35)'
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.moveTo(cx - avgR * 0.3, cy)
          ctx.lineTo(cx + avgR * 0.3, cy + rnd(i + 31) * 4 - 2)
          ctx.stroke()
        }

        i += 8
      }
    }
  }
  drawPile(-8, gapTop + 4, 0)
  drawPile(gapBot - 4, BOARD_H + 8, 500)
}

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
  const inputRef = useRef({ up: false, down: false })
  const userRef = useRef(null)
  const audioCtxRef = useRef(null)
  const fnRef = useRef({})
  const moleImagesRef = useRef(null)
  const soilCanvasRef = useRef(null)

  // Preload mole sprites
  useEffect(() => {
    const load = (src) => new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = src
    })
    Promise.all([
      load('/mole_moves/mole_right.png'),
      load('/mole_moves/mole_up.png'),
      load('/mole_moves/mole_down.png'),
    ]).then(([right, up, down]) => {
      moleImagesRef.current = { right, up, down }
    })
  }, [])

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

    const resizeCanvas = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const cssW = canvas.clientWidth || BOARD_W
      const cssH = canvas.clientHeight || BOARD_H
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      // Map logical 400x640 coords to actual canvas pixel size
      ctx.setTransform((cssW * dpr) / BOARD_W, 0, 0, (cssH * dpr) / BOARD_H, 0, 0)
    }
    resizeCanvas()
    const ro = new ResizeObserver(resizeCanvas)
    ro.observe(canvas)

    stateRef.current = {
      distance: 0,
      moleY: MOLE_SIZE,
      vy: 0,
      pipes: [],
      nextPipeX: FIRST_PIPE_X,
      nextPipeId: 1,
      dead: false,
      flash: 0,
      bounceFrames: 0,
      bounceVx: 0,
      bounceVy: 0,
      moleXOffset: 0,
      collision: null, // { worldX, worldY, pipeScreenX, pipeGapTop, pipeGapBot, hitTop }
      trail: [], // carved path {worldX, worldY} — mole scoops out soil as it moves
    }
    setDepth(0)

    // Offscreen canvas for the soil layer (where we can "erase" to carve a tunnel)
    const soil = document.createElement('canvas')
    soil.width = BOARD_W
    soil.height = BOARD_H
    soilCanvasRef.current = soil

    const tick = () => {
      const s = stateRef.current
      const i = inputRef.current

      // Bounce-back animation after a collision, then end the game
      if (s.bounceFrames > 0) {
        s.bounceFrames -= 1
        s.moleXOffset += s.bounceVx
        s.moleY += s.bounceVy
        s.bounceVx *= 0.9
        s.bounceVy *= 0.85
        s.bounceVy += 0.4 // gravity while bouncing
        render(ctx, s)
        if (s.bounceFrames <= 0) {
          fnRef.current.triggerGameOver()
          return
        }
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      // Scroll world
      const speed = scrollSpeed(s.distance)
      s.distance += speed

      // Vertical physics — direct velocity control (flappy-style but with both directions)
      if (i.up && !i.down)      s.vy -= VY_ACCEL
      else if (i.down && !i.up) s.vy += VY_ACCEL
      else                      s.vy *= VY_DECAY
      s.vy = clamp(s.vy, -VY_MAX, VY_MAX)
      s.moleY = clamp(s.moleY + s.vy, MOLE_SIZE / 2, BOARD_H - MOLE_SIZE / 2)
      // Kill velocity when pressing against bounds
      if (s.moleY <= MOLE_SIZE / 2 && s.vy < 0) s.vy = 0
      if (s.moleY >= BOARD_H - MOLE_SIZE / 2 && s.vy > 0) s.vy = 0

      // Spawn new pipe pair when the frontier isn't far enough ahead
      while (s.nextPipeX - s.distance < BOARD_W + PIPE_SPACING_START) {
        const gH = gapHeight(s.distance)
        const gapMin = GAP_MARGIN + gH / 2
        const gapMax = BOARD_H - GAP_MARGIN - gH / 2
        const gapY = gapMin + Math.random() * (gapMax - gapMin)
        s.pipes.push({ id: s.nextPipeId++, worldX: s.nextPipeX, gapY, gapH: gH, passed: false })
        s.nextPipeX += pipeSpacing(s.distance)
      }

      // Cull pipes that scrolled off screen left
      s.pipes = s.pipes.filter(p => (p.worldX - s.distance) > -PIPE_W - 10)

      // Record the mole's world position to carve the soil trail
      const mWX = s.distance + MOLE_SCREEN_X
      s.trail.push({ x: mWX, y: s.moleY })
      // Prune trail points off the left edge of the screen (+margin for the carve radius)
      while (s.trail.length > 0 && s.trail[0].x < s.distance - 40) {
        s.trail.shift()
      }

      // Collision (circle vs pipe rectangles) + pass-detection
      const moleCx = s.distance + MOLE_SCREEN_X
      const moleCy = s.moleY
      const r2 = HITBOX_R * HITBOX_R
      for (const p of s.pipes) {
        if (!p.passed && p.worldX + PIPE_W < moleCx - HITBOX_R) {
          p.passed = true
          fnRef.current.playPass?.()
        }
        // Coarse skip: pipe entirely left or right of mole circle
        if (moleCx + HITBOX_R < p.worldX) continue
        if (moleCx - HITBOX_R > p.worldX + PIPE_W) continue

        const gapTop = p.gapY - p.gapH / 2
        const gapBot = p.gapY + p.gapH / 2

        // Top pipe rect: [p.worldX, 0] → [p.worldX + PIPE_W, gapTop]
        const txc = clamp(moleCx, p.worldX, p.worldX + PIPE_W)
        const tyc = clamp(moleCy, 0, gapTop)
        const tdx = moleCx - txc, tdy = moleCy - tyc
        const hitTop = tdx * tdx + tdy * tdy < r2

        // Bottom pipe rect: [p.worldX, gapBot] → [p.worldX + PIPE_W, BOARD_H]
        const bxc = clamp(moleCx, p.worldX, p.worldX + PIPE_W)
        const byc = clamp(moleCy, gapBot, BOARD_H)
        const bdx = moleCx - bxc, bdy = moleCy - byc
        const hitBot = bdx * bdx + bdy * bdy < r2

        if (hitTop || hitBot) {
          s.dead = true
          s.flash = 14
          s.bounceFrames = BOUNCE_FRAMES
          s.bounceVx = -2
          s.bounceVy = hitTop ? 5 : -5
          s.collision = {
            worldX: moleCx,
            worldY: moleCy,
            pipeWorldX: p.worldX,
            gapTop,
            gapBot,
            hitTop,
          }
          fnRef.current.playCrash?.()
          break
        }
      }

      setDepth(Math.floor(s.distance / PX_PER_METER))

      render(ctx, s)

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [phase])

  const render = (ctx, s) => {
    // Biome palette (soil + tunnel-interior colors vary with distance)
    const distM = s.distance / PX_PER_METER
    const biomeIdx = Math.min(3, Math.floor(distM / 100))
    const biomes = [
      { soil: '#4a301a', soilDark: '#2a1a0d', voidA: '#120a05', voidB: '#080503' }, // dirt
      { soil: '#4a2c26', soilDark: '#2a1614', voidA: '#120707', voidB: '#080303' }, // clay
      { soil: '#3a2e38', soilDark: '#201820', voidA: '#0a0610', voidB: '#050308' }, // rock
      { soil: '#2a3448', soilDark: '#141d2b', voidA: '#060a14', voidB: '#03050a' }, // crystal cave
    ]
    const b = biomes[biomeIdx]

    // 1) Tunnel void (what's behind the carved path) — fills the whole canvas as the "empty" base
    const g = ctx.createLinearGradient(0, 0, 0, BOARD_H)
    g.addColorStop(0, b.voidA)
    g.addColorStop(0.5, b.voidB)
    g.addColorStop(1, b.voidA)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, BOARD_W, BOARD_H)

    // 2) Scrolling dirt specks (subtle motion in the void)
    const parallax = s.distance * 0.5
    ctx.save()
    ctx.globalAlpha = 0.18
    ctx.fillStyle = '#000'
    for (let i = 0; i < 60; i++) {
      const seed = i * 41.17
      const x = ((seed * 17) - parallax) % BOARD_W
      const xx = x < 0 ? x + BOARD_W : x
      const y = (seed * 23) % BOARD_H
      ctx.fillRect(xx, y, 2, 2)
    }
    ctx.restore()

    // 3) Soil layer (offscreen) — solid soil, then carve a tunnel along the mole's trail
    const soil = soilCanvasRef.current
    if (soil) {
      const sctx = soil.getContext('2d')
      // Fill with soil color (uniform, with a subtle vertical gradient)
      const sg = sctx.createLinearGradient(0, 0, 0, BOARD_H)
      sg.addColorStop(0, b.soil)
      sg.addColorStop(0.5, b.soilDark)
      sg.addColorStop(1, b.soil)
      sctx.globalCompositeOperation = 'source-over'
      sctx.fillStyle = sg
      sctx.fillRect(0, 0, BOARD_W, BOARD_H)

      // Add small pebble specks baked into the soil for texture
      sctx.globalAlpha = 0.22
      sctx.fillStyle = '#000'
      for (let i = 0; i < 90; i++) {
        const seed = i * 97.3
        const x = ((seed * 13) - parallax) % BOARD_W
        const xx = x < 0 ? x + BOARD_W : x
        const y = (seed * 31) % BOARD_H
        sctx.fillRect(xx, y, 2, 2)
      }
      sctx.globalAlpha = 1

      // Carve the trail out of the soil
      sctx.globalCompositeOperation = 'destination-out'
      sctx.lineCap = 'round'
      sctx.lineJoin = 'round'
      sctx.lineWidth = MOLE_SIZE * 1.4
      if (s.trail.length > 1) {
        sctx.beginPath()
        for (let i = 0; i < s.trail.length; i++) {
          const pt = s.trail[i]
          const sx = pt.x - s.distance
          if (i === 0) sctx.moveTo(sx, pt.y)
          else sctx.lineTo(sx, pt.y)
        }
        sctx.stroke()
      } else if (s.trail.length === 1) {
        const pt = s.trail[0]
        const sx = pt.x - s.distance
        sctx.beginPath()
        sctx.arc(sx, pt.y, MOLE_SIZE * 0.7, 0, Math.PI * 2)
        sctx.fill()
      }
      sctx.globalCompositeOperation = 'source-over'

      // Draw soil onto main canvas
      ctx.drawImage(soil, 0, 0, BOARD_W, BOARD_H)
    }

    // Ceiling and floor rock bands
    const bandH = 12
    const rockGradTop = ctx.createLinearGradient(0, 0, 0, bandH)
    rockGradTop.addColorStop(0, '#1b0f06')
    rockGradTop.addColorStop(1, b.top)
    ctx.fillStyle = rockGradTop
    ctx.fillRect(0, 0, BOARD_W, bandH)
    const rockGradBot = ctx.createLinearGradient(0, BOARD_H - bandH, 0, BOARD_H)
    rockGradBot.addColorStop(0, b.top)
    rockGradBot.addColorStop(1, '#1b0f06')
    ctx.fillStyle = rockGradBot
    ctx.fillRect(0, BOARD_H - bandH, BOARD_W, bandH)

    // Obstacles — varied underground shapes (collision stays rect-based, visuals differ per type)
    for (const p of s.pipes) {
      const screenX = p.worldX - s.distance
      if (screenX < -PIPE_W - 30 || screenX > BOARD_W + 30) continue
      const gapTop = p.gapY - p.gapH / 2
      const gapBot = p.gapY + p.gapH / 2

      // Deterministic per-pipe pseudo-random (so shapes don't flicker)
      const rnd = (n) => {
        const x = Math.sin(p.id * 9301 + n * 7.3) * 43758.5453
        return x - Math.floor(x)
      }

      drawStones(ctx, screenX, gapTop, gapBot, rnd, b)
    }

    // Mole sprite — swap images based on current input (up / down / idle-right)
    ctx.save()
    ctx.translate(MOLE_SCREEN_X + (s.moleXOffset || 0), s.moleY)
    // Only rotate during the bounce tumble; directional images handle orientation in normal play
    if (s.bounceFrames > 0) ctx.rotate(s.bounceFrames * 0.08)

    const input = inputRef.current
    const imgs = moleImagesRef.current
    let moleImg = imgs?.right
    if (input?.up)       moleImg = imgs?.up   || moleImg
    else if (input?.down) moleImg = imgs?.down || moleImg

    const drawSize = MOLE_SIZE * 1.6 // visual size of the sprite
    if (moleImg) {
      const iw = moleImg.naturalWidth || drawSize
      const ih = moleImg.naturalHeight || drawSize
      const scale = drawSize / Math.max(iw, ih)
      const w = iw * scale
      const h = ih * scale
      ctx.drawImage(moleImg, -w / 2, -h / 2, w, h)
    } else {
      // Fallback if images didn't load yet
      ctx.fillStyle = '#4a2e1a'
      ctx.beginPath()
      ctx.ellipse(0, 0, MOLE_SIZE / 2, MOLE_SIZE / 2, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    if (s.flash > 0) {
      ctx.fillStyle = `rgba(255,60,40,${s.flash / 10})`
      ctx.fillRect(0, 0, BOARD_W, BOARD_H)
      s.flash -= 1
    }

    if (DEBUG_HITBOX) {
      ctx.save()
      ctx.lineWidth = 1.5
      ctx.font = '11px monospace'

      // Pipe hit rectangles (top + bottom) in lime
      ctx.strokeStyle = '#00ff88'
      for (const p of s.pipes) {
        const screenX = p.worldX - s.distance
        if (screenX < -PIPE_W || screenX > BOARD_W) continue
        const gapTop = p.gapY - p.gapH / 2
        const gapBot = p.gapY + p.gapH / 2
        ctx.strokeRect(screenX, 0, PIPE_W, gapTop)
        ctx.strokeRect(screenX, gapBot, PIPE_W, BOARD_H - gapBot)
      }

      // Mole live hitbox (magenta) with label
      const liveX = MOLE_SCREEN_X + (s.moleXOffset || 0)
      ctx.strokeStyle = '#ff00ff'
      ctx.beginPath()
      ctx.arc(liveX, s.moleY, HITBOX_R, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#ff00ff'
      ctx.fillText('mole now', liveX + HITBOX_R + 4, s.moleY + 4)

      // Drawn body ellipse outline (cyan) = what the sprite actually covers visually
      ctx.strokeStyle = '#00ffff'
      ctx.beginPath()
      ctx.ellipse(liveX, s.moleY, MOLE_SIZE / 2 * 1.15, MOLE_SIZE / 2, 0, 0, Math.PI * 2)
      ctx.stroke()

      // Collision moment: frozen mole + impacted pipe (red) + filled overlap to prove contact
      if (s.collision) {
        const c = s.collision
        const colScreenX = c.worldX - s.distance
        const pipeScreenX = c.pipeWorldX - s.distance

        // Impacted pipe rect (red, thick)
        ctx.strokeStyle = '#ff3040'
        ctx.lineWidth = 3
        ctx.fillStyle = 'rgba(255,48,64,0.18)'
        if (c.hitTop) {
          ctx.fillRect(pipeScreenX, 0, PIPE_W, c.gapTop)
          ctx.strokeRect(pipeScreenX, 0, PIPE_W, c.gapTop)
        } else {
          ctx.fillRect(pipeScreenX, c.gapBot, PIPE_W, BOARD_H - c.gapBot)
          ctx.strokeRect(pipeScreenX, c.gapBot, PIPE_W, BOARD_H - c.gapBot)
        }

        // Mole hitbox at collision moment (red, thick, filled)
        ctx.fillStyle = 'rgba(255,48,64,0.25)'
        ctx.beginPath()
        ctx.arc(colScreenX, c.worldY, HITBOX_R, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()

        // Crosshair at circle center
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(colScreenX - 10, c.worldY); ctx.lineTo(colScreenX + 10, c.worldY)
        ctx.moveTo(colScreenX, c.worldY - 10); ctx.lineTo(colScreenX, c.worldY + 10)
        ctx.stroke()

        // Label
        ctx.fillStyle = '#ff3040'
        ctx.fillText('IMPACT', colScreenX + HITBOX_R + 4, c.worldY + 4)

        // Dashed line connecting current mole to collision point
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(liveX, s.moleY)
        ctx.lineTo(colScreenX, c.worldY)
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.restore()
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
    const finalDepth = Math.floor((stateRef.current?.distance ?? 0) / PX_PER_METER)
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
      if (e.key === 'ArrowUp')                          { inputRef.current.up = true; e.preventDefault() }
      if (e.key === 'ArrowDown' || e.key === ' ')       { inputRef.current.down = true; e.preventDefault() }
    }
    const keyup = (e) => {
      if (e.key === 'ArrowUp')                          inputRef.current.up = false
      if (e.key === 'ArrowDown' || e.key === ' ')       inputRef.current.down = false
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      inputRef.current = { up: false, down: false }
    }
  }, [phase])

  const setTouchDirection = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    inputRef.current.up = y < 0.5
    inputRef.current.down = y >= 0.5
  }
  const onPointerDown = (e) => {
    if (phase !== 'playing') return
    e.preventDefault()
    setTouchDirection(e)
  }
  const onPointerMove = (e) => {
    if (phase !== 'playing') return
    if (!(inputRef.current.up || inputRef.current.down)) return
    setTouchDirection(e)
  }
  const onPointerUp = () => {
    inputRef.current.up = false
    inputRef.current.down = false
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

  const inGame = phase === 'countdown' || phase === 'playing' || phase === 'gameover'
  return (
    <div className={`fm-page ${inGame ? 'fm-page-playing' : ''}`}>
      <a href="https://jeules.net" className="fm-back">← Back to site</a>

      {phase === 'gate' && (
        <div className="fm-gate">
          <p className="fm-label">Mini Game</p>
          <h1 className="fm-heading">Flappy-<em>Mole.</em></h1>
          <p className="fm-sub">
            Tunnel as far as you can.<br />
            Dig up and down to slip through the gaps.
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
            <p><strong>Desktop:</strong> ↑ — dig up. ↓ / Space — dig down.</p>
            <p><strong>Mobile:</strong> Tap upper half to dig up, lower half to dig down.</p>
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
