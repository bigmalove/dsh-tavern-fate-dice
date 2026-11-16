// ============================================================================
// demo/audio.js — 零外部资源 Web Audio 程序化物理音效合成引擎
// 为 8 大视觉风格提供专属材质碰撞音（木绒/星盘/全息脉冲/熔铁/玉石剑鸣/水晶风铃/深渊低语/8-bit）
// 内置并发声部闸门（≤ 8 并发），即使 24 颗骰子齐投也零爆音、零阻塞。
// ============================================================================

export class ProceduralDiceAudio {
  constructor() {
    this.ctx = null
    this.enabled = true
    this.masterGain = null
    this.noiseBuffer = null
    this.lastBounceAt = 0
    this.activeVoices = 0
  }

  ensureContext() {
    if (!this.enabled) return null
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      this.ctx = new AC()
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = 0.36
      this.masterGain.connect(this.ctx.destination)
      // 预生成 0.4s 白噪声缓冲，全程复用零分配
      const len = Math.floor(this.ctx.sampleRate * 0.4)
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
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.enabled ? 0.36 : 0, this.ctx.currentTime, 0.02)
    }
  }

  playThrowWhoosh(preset = 'arcane') {
    const ctx = this.ensureContext()
    if (!ctx || !this.noiseBuffer) return
    const now = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer

    const filter = ctx.createBiquadFilter()
    filter.type = preset === 'cyber' || preset === 'arcade' ? 'bandpass' : 'lowpass'
    const baseFreq = preset === 'prism' ? 1400 : preset === 'magma' ? 320 : 680
    filter.frequency.setValueAtTime(baseFreq * 0.6, now)
    filter.frequency.exponentialRampToValueAtTime(baseFreq * 2.1, now + 0.09)
    filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.4, now + 0.24)
    filter.Q.value = preset === 'shuimo' ? 4.5 : 2.0

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(0.16, now + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.masterGain)
    src.start(now)
    src.stop(now + 0.26)
  }

  playBounce(preset = 'arcane', strength = 0.6) {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime
    // 节流：多骰密集碰撞时最小间隔 18ms，防相位叠加削波
    if (now - this.lastBounceAt < 0.018 || this.activeVoices >= 8) return
    this.lastBounceAt = now
    this.activeVoices++

    const amp = Math.min(1, Math.max(0.08, strength))
    const jitter = 0.92 + Math.random() * 0.18

    if (preset === 'arcade') {
      // 8-bit 方波跳跃敲击
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'square'
      const f = (240 + amp * 340) * jitter
      osc.frequency.setValueAtTime(f, now)
      osc.frequency.setValueAtTime(f * 1.5, now + 0.022)
      g.gain.setValueAtTime(0.18 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.065)
      osc.connect(g); g.connect(this.masterGain)
      osc.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      osc.start(now); osc.stop(now + 0.07)
      return
    }

    if (preset === 'prism' || preset === 'arcane') {
      // 清脆泛音星晶/星盘金属碰撞
      const f0 = (preset === 'prism' ? 1320 : 880) * jitter
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const g = ctx.createGain()
      osc1.type = 'sine'
      osc2.type = 'triangle'
      osc1.frequency.setValueAtTime(f0, now)
      osc2.frequency.setValueAtTime(f0 * (preset === 'prism' ? 2.756 : 1.618), now)
      g.gain.setValueAtTime(0.2 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + (preset === 'prism' ? 0.19 : 0.13))
      osc1.connect(g); osc2.connect(g); g.connect(this.masterGain)
      osc1.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      osc1.start(now); osc2.start(now)
      const dur = preset === 'prism' ? 0.2 : 0.14
      osc1.stop(now + dur); osc2.stop(now + dur)
      return
    }

    if (preset === 'cyber') {
      // 赛博调频激光脉冲点击
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(980 * jitter, now)
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.055)
      g.gain.setValueAtTime(0.17 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.06)
      osc.connect(g); g.connect(this.masterGain)
      osc.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      osc.start(now); osc.stop(now + 0.065)
      return
    }

    // 物理打击合成（tavern 橡木绒盘 / shuimo 温玉竹简 / magma 玄武熔铁 / eldritch 骨骰）
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = preset === 'magma' ? 'triangle' : 'sine'
    const base = preset === 'magma' ? 145 : preset === 'shuimo' ? 690 : preset === 'eldritch' ? 310 : 420
    osc.frequency.setValueAtTime(base * jitter * (1 + amp * 0.25), now)
    osc.frequency.exponentialRampToValueAtTime(base * 0.42, now + 0.055)
    g.gain.setValueAtTime(0.24 * amp, now)
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.07)
    osc.connect(g); g.connect(this.masterGain)

    if (this.noiseBuffer) {
      const nSrc = ctx.createBufferSource()
      nSrc.buffer = this.noiseBuffer
      const nf = ctx.createBiquadFilter()
      nf.type = 'bandpass'
      nf.frequency.value = preset === 'tavern' ? 1650 * jitter : preset === 'shuimo' ? 2400 : 1100
      nf.Q.value = 3.2
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(0.18 * amp, now)
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.032)
      nSrc.connect(nf); nf.connect(ng); ng.connect(this.masterGain)
      nSrc.start(now); nSrc.stop(now + 0.038)
    }

    osc.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
    osc.start(now); osc.stop(now + 0.075)
  }

  playSettle(preset = 'arcane', tier = 'success') {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime

    // 五档裁定和弦音程
    let notes = [523.25, 659.25] // success: C5 - E5
    if (tier === 'critical') notes = [523.25, 659.25, 783.99, 1046.5] // 大成功辉煌大三和弦琶音
    else if (tier === 'costly') notes = [440, 523.25, 622.25] // 代价成功：带张力减五/小调色彩
    else if (tier === 'failure') notes = [349.23, 311.13] // 失败：下行
    else if (tier === 'fumble') notes = [220, 155.56, 110] // 大失败：深渊三全音下坠

    const wave = preset === 'arcade'
      ? 'square'
      : preset === 'cyber'
        ? 'sawtooth'
        : preset === 'prism' || preset === 'shuimo'
          ? 'sine'
          : 'triangle'

    notes.forEach((freq, i) => {
      const t0 = now + i * (preset === 'arcade' ? 0.045 : 0.055)
      const dur = tier === 'critical' ? 0.46 : 0.3
      const osc = ctx.createOscillator()
      const filter = ctx.createBiquadFilter()
      const g = ctx.createGain()

      osc.type = wave
      const mult = preset === 'prism' ? 1.5 : preset === 'magma' || preset === 'eldritch' ? 0.65 : 1.0
      osc.frequency.setValueAtTime(freq * mult, t0)

      filter.type = 'lowpass'
      filter.frequency.value = preset === 'arcade' ? 3200 : preset === 'cyber' ? 2200 : 2800

      g.gain.setValueAtTime(0.001, t0)
      g.gain.linearRampToValueAtTime(tier === 'critical' ? 0.14 : 0.1, t0 + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur)

      osc.connect(filter); filter.connect(g); g.connect(this.masterGain)
      osc.start(t0); osc.stop(t0 + dur + 0.02)
    })

    // 水墨印章拍案重音 / 熔岩重锤轰鸣
    if ((preset === 'shuimo' || preset === 'magma') && (tier === 'critical' || tier === 'fumble')) {
      const sub = ctx.createOscillator()
      const sg = ctx.createGain()
      sub.type = 'sine'
      const st = now + (preset === 'shuimo' ? 0.08 : 0)
      sub.frequency.setValueAtTime(preset === 'magma' ? 95 : 140, st)
      sub.frequency.exponentialRampToValueAtTime(36, st + 0.28)
      sg.gain.setValueAtTime(0.28, st)
      sg.gain.exponentialRampToValueAtTime(0.001, st + 0.3)
      sub.connect(sg); sg.connect(this.masterGain)
      sub.start(st); sub.stop(st + 0.32)
    }
  }
}
