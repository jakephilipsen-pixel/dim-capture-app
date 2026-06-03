/**
 * Success feedback for the capture flow — a short beep + haptic tick.
 * Both degrade silently where unsupported (no audio file, no throw).
 */

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext
}

/** Short sine beep via Web Audio (default 880 Hz for 150 ms). */
export function playBeep(durationMs = 150, frequency = 880): void {
  try {
    const Ctor = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + durationMs / 1000)
    osc.onended = () => void ctx.close()
  } catch {
    // Audio unavailable (autoplay policy, no device) — non-fatal.
  }
}

/** Haptic tick where supported (default 100 ms). */
export function vibrate(ms = 100): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms)
    }
  } catch {
    // vibrate not supported — non-fatal.
  }
}
