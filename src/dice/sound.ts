/**
 * Synthesised impact clicks — a short filtered noise burst for the clack of the
 * corner plus a low sine thud for the mass. No audio files to ship, and the
 * pitch/level vary with impact strength so repeated bounces don't sound looped.
 *
 * Browsers only allow audio after a gesture, so the context is created lazily
 * on the first roll (which is always a click or keypress) and resumed if the
 * browser suspended it.
 */

let context: AudioContext | null = null
let noiseBuffer: AudioBuffer | null = null

type AudioContextCtor = typeof AudioContext

function getContext(): AudioContext | null {
  if (context) return context
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  if (!Ctor) return null
  context = new Ctor()
  return context
}

function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer
  const length = Math.floor(ctx.sampleRate * 0.12)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  noiseBuffer = buffer
  return buffer
}

/**
 * Schedules the clacks for a whole throw at once. Scheduling against the audio
 * clock rather than with setTimeout keeps the hits locked to the visual bounces
 * even if the main thread stutters.
 */
export function scheduleImpacts(impacts: { time: number; strength: number }[], volume = 0.5) {
  const ctx = getContext()
  if (!ctx || volume <= 0) return
  if (ctx.state === 'suspended') void ctx.resume()

  const start = ctx.currentTime + 0.02
  for (const impact of impacts) {
    playImpact(ctx, start + impact.time / 1000, impact.strength, volume)
  }
}

function playImpact(ctx: AudioContext, at: number, strength: number, volume: number) {
  const level = Math.max(0.04, strength) * volume

  // The clack: noise through a bandpass, decaying in ~60ms. Harder hits ring
  // a little higher and brighter.
  const noise = ctx.createBufferSource()
  noise.buffer = getNoise(ctx)
  noise.playbackRate.value = 0.85 + strength * 0.5

  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 1400 + strength * 1100
  band.Q.value = 1.1

  const clackGain = ctx.createGain()
  clackGain.gain.setValueAtTime(0, at)
  clackGain.gain.linearRampToValueAtTime(level * 0.9, at + 0.004)
  clackGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06 + strength * 0.04)

  noise.connect(band).connect(clackGain).connect(ctx.destination)
  noise.start(at)
  noise.stop(at + 0.14)

  // The thud: a short low sine giving the die some weight.
  const thud = ctx.createOscillator()
  thud.type = 'sine'
  thud.frequency.setValueAtTime(170 + strength * 60, at)
  thud.frequency.exponentialRampToValueAtTime(70, at + 0.09)

  const thudGain = ctx.createGain()
  thudGain.gain.setValueAtTime(0, at)
  thudGain.gain.linearRampToValueAtTime(level * 0.5, at + 0.006)
  thudGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.1)

  thud.connect(thudGain).connect(ctx.destination)
  thud.start(at)
  thud.stop(at + 0.12)
}
