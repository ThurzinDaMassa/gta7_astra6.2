export class Sound {
  enabled = false
  private ctx?: AudioContext
  private engine?: OscillatorNode
  private gain?: GainNode
  async toggle() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.engine = this.ctx.createOscillator()
      this.engine.type = 'triangle'
      this.gain = this.ctx.createGain()
      this.gain.gain.value = 0
      this.engine.connect(this.gain)
      this.gain.connect(this.ctx.destination)
      this.engine.start()
    }
    this.enabled = !this.enabled
    if (this.enabled) {
      await this.ctx.resume()
    } else {
      await this.ctx.suspend()
    }
    return this.enabled
  }
  update(speed: number, driving: boolean) {
    if (!this.ctx || !this.enabled) return
    this.engine!.frequency.setTargetAtTime(
      36 + speed * 0.8,
      this.ctx.currentTime,
      0.16,
    )
    this.gain!.gain.setTargetAtTime(
      driving ? 0.055 : 0.004,
      this.ctx.currentTime,
      0.14,
    )
  }
  chime() {
    if (!this.ctx || !this.enabled) return
    const ctx = this.ctx,
      osc = ctx.createOscillator(),
      g = ctx.createGain()
    osc.frequency.setValueAtTime(420, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(630, ctx.currentTime + 0.12)
    g.gain.setValueAtTime(0.045, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22)
    osc.connect(g)
    g.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.23)
  }
}
