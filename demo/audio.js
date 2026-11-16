// ============================================================================
// demo/audio.js — 零外部资源 Web Audio 立体声物理合成音效引擎 v2
// 支持：3D 空间声像定位 (StereoPanner) + 按住蓄力引力旋涡嗡鸣 + 子弹时间下潜低频 +
//       6 大次世代视觉主题专属物理碰撞与裁定高潮交响和弦。
// ============================================================================

export class ProceduralDiceAudio {
  constructor() {
    this.ctx = null
    this.enabled = true
    this.masterGain = null
    this.noiseBuffer = null
    this.lastBounceAt = 0
    this.activeVoices = 0
    this.chargeOsc = null
    this.chargeGain = null
  }

  ensureContext() {
    if (!this.enabled) return null
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      this.ctx = new AC()
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = 0.42
      this.masterGain.connect(this.ctx.destination)
      const len = Math.floor(this.ctx.sampleRate * 0.45)
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      this.noiseBuffer = buf
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  setEnabled(flag) {
    this.enabled = Boolean(flag)
    if (!this.enabled) this.stopChargeHum()
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.enabled ? 0.42 : 0, this.ctx.currentTime, 0.02)
    }
  }

  _connectPanned(node, pan = 0) {
    const ctx = this.ctx
    if (ctx && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner()
      panner.pan.value = Math.max(-0.85, Math.min(0.85, pan))
      node.connect(panner)
      panner.connect(this.masterGain)
    } else {
      node.connect(this.masterGain)
    }
  }

  startChargeHum(preset = 'astral') {
    const ctx = this.ensureContext()
    if (!ctx || this.chargeOsc) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = preset === 'cyber' ? 'sawtooth' : preset === 'inferno' ? 'triangle' : 'sine'
    osc.frequency.setValueAtTime(95, now)
    g.gain.setValueAtTime(0.001, now)
    g.gain.linearRampToValueAtTime(0.09, now + 0.12)
    osc.connect(g)
    g.connect(this.masterGain)
    osc.start(now)
    this.chargeOsc = osc
    this.chargeGain = g
  }

  updateChargeHum(charge01) {
    if (!this.chargeOsc || !this.ctx) return
    const now = this.ctx.currentTime
    const c = Math.max(0, Math.min(1, charge01))
    this.chargeOsc.frequency.setTargetAtTime(95 + c * 240, now, 0.04)
    this.chargeGain.gain.setTargetAtTime(0.04 + c * 0.11, now, 0.04)
  }

  stopChargeHum() {
    if (!this.chargeOsc || !this.ctx) return
    const now = this.ctx.currentTime
    try {
      this.chargeGain.gain.cancelScheduledValues(now)
      this.chargeGain.gain.setTargetAtTime(0.0001, now, 0.03)
      this.chargeOsc.stop(now + 0.12)
    } catch {}
    this.chargeOsc = null
    this.chargeGain = null
  }

  playThrowWhoosh(preset = 'astral', power = 1.0) {
    this.stopChargeHum()
    const ctx = this.ensureContext()
    if (!ctx || !this.noiseBuffer) return
    const now = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer

    const filter = ctx.createBiquadFilter()
    filter.type = preset === 'cyber' ? 'bandpass' : 'lowpass'
    const baseFreq = preset === 'prism' ? 1550 : preset === 'inferno' ? 360 : 760
    filter.frequency.setValueAtTime(baseFreq * 0.5, now)
    filter.frequency.exponentialRampToValueAtTime(baseFreq * (1.9 + power * 0.6), now + 0.08)
    filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.35, now + 0.26)
    filter.Q.value = preset === 'jianxin' ? 5.2 : 2.2

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(0.18 * Math.min(1.4, power), now + 0.045)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.masterGain)
    src.start(now)
    src.stop(now + 0.28)
  }

  playBulletTimeDrop() {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(160, now)
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.32)
    g.gain.setValueAtTime(0.22, now)
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.36)
    osc.connect(g)
    g.connect(this.masterGain)
    osc.start(now)
    osc.stop(now + 0.38)
  }

  playBounce(preset = 'astral', strength = 0.6, pan = 0) {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastBounceAt < 0.016 || this.activeVoices >= 8) return
    this.lastBounceAt = now
    this.activeVoices++

    const amp = Math.min(1, Math.max(0.08, strength))
    const jitter = 0.92 + Math.random() * 0.18

    if (preset === 'prism' || preset === 'astral') {
      const f0 = (preset === 'prism' ? 1480 : 940) * jitter
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const g = ctx.createGain()
      osc1.type = 'sine'
      osc2.type = 'triangle'
      osc1.frequency.setValueAtTime(f0, now)
      osc2.frequency.setValueAtTime(f0 * (preset === 'prism' ? 2.756 : 1.618), now)
      g.gain.setValueAtTime(0.22 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + (preset === 'prism' ? 0.21 : 0.14))
      osc1.connect(g); osc2.connect(g)
      this._connectPanned(g, pan)
      osc1.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      osc1.start(now); osc2.start(now)
      const dur = preset === 'prism' ? 0.22 : 0.15
      osc1.stop(now + dur); osc2.stop(now + dur)
      return
    }

    if (preset === 'cyber') {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(1120 * jitter, now)
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.055)
      g.gain.setValueAtTime(0.18 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.06)
      osc.connect(g)
      this._connectPanned(g, pan)
      osc.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      osc.start(now); osc.stop(now + 0.065)
      return
    }

    // 物理刚体碰撞合成：inferno 玄武熔铁 / jianxin 羊脂白玉剑鸣 / singularity 古骨奇点
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = preset === 'inferno' ? 'triangle' : 'sine'
    const base = preset === 'inferno' ? 140 : preset === 'jianxin' ? 820 : 290
    osc.frequency.setValueAtTime(base * jitter * (1 + amp * 0.28), now)
    osc.frequency.exponentialRampToValueAtTime(base * (preset === 'jianxin' ? 0.72 : 0.38), now + 0.075)
    g.gain.setValueAtTime(0.25 * amp, now)
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.085)
    osc.connect(g)
    this._connectPanned(g, pan)

    if (this.noiseBuffer) {
      const nSrc = ctx.createBufferSource()
      nSrc.buffer = this.noiseBuffer
      const nf = ctx.createBiquadFilter()
      nf.type = 'bandpass'
      nf.frequency.value = preset === 'jianxin' ? 2800 * jitter : 1150
      nf.Q.value = 3.8
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(0.16 * amp, now)
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.032)
      nSrc.connect(nf); nf.connect(ng)
      this._connectPanned(ng, pan)
      nSrc.start(now); nSrc.stop(now + 0.038)
    }

    osc.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
    osc.start(now); osc.stop(now + 0.09)
  }

  playSettle(preset = 'astral', tier = 'success') {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime

    let notes = [523.25, 659.25]
    if (tier === 'critical') notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]
    else if (tier === 'costly') notes = [440, 523.25, 622.25]
    else if (tier === 'failure') notes = [349.23, 311.13]
    else if (tier === 'fumble') notes = [220, 155.56, 110, 73.42]

    const wave = preset === 'cyber'
      ? 'sawtooth'
      : preset === 'prism' || preset === 'jianxin'
        ? 'sine'
        : 'triangle'

    notes.forEach((freq, i) => {
      const t0 = now + i * 0.052
      const dur = tier === 'critical' ? 0.56 : 0.34
      const osc = ctx.createOscillator()
      const filter = ctx.createBiquadFilter()
      const g = ctx.createGain()

      osc.type = wave
      const mult = preset === 'prism' ? 1.45 : preset === 'inferno' || preset === 'singularity' ? 0.65 : 1.0
      osc.frequency.setValueAtTime(freq * mult, t0)

      filter.type = 'lowpass'
      filter.frequency.value = preset === 'cyber' ? 2400 : 3200

      g.gain.setValueAtTime(0.001, t0)
      g.gain.linearRampToValueAtTime(tier === 'critical' ? 0.15 : 0.10, t0 + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur)

      osc.connect(filter); filter.connect(g)
      this._connectPanned(g, (i - (notes.length - 1) * 0.5) * 0.25)
      osc.start(t0); osc.stop(t0 + dur + 0.02)
    })

    // 剑鸣清音 / 重锤低音轰鸣
    if (tier === 'critical' || tier === 'fumble') {
      const sub = ctx.createOscillator()
      const sg = ctx.createGain()
      sub.type = 'sine'
      sub.frequency.setValueAtTime(preset === 'jianxin' ? 196 : 115, now)
      sub.frequency.exponentialRampToValueAtTime(34, now + 0.38)
      sg.gain.setValueAtTime(0.32, now)
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.42)
      sub.connect(sg); sg.connect(this.masterGain)
      sub.start(now); sub.stop(now + 0.44)
    }
  }
}
