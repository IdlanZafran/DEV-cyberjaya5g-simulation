/* =========================================================================
   audio.js - synthesized sounds (Web Audio, no sound files needed).
     beep()            short warning beeps (speeding detected)
     startAlarm()      junction collision alarm (rising/falling siren)
     startSiren()      emergency-vehicle two-tone siren (hi-lo)
   Browsers only allow audio after a user click; the first click anywhere on
   the page unlocks it.
   ========================================================================= */
(() => {
  let ctx = null;
  let master = null;
  let alarm = null;
  let siren = null;
  let enabled = true;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 1 : 0;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  document.addEventListener('pointerdown', ensure);
  document.addEventListener('keydown', ensure);

  // Oscillator whose pitch is modulated by a second (LFO) oscillator
  function modulatedTone({ type, base, depth, rate, lfoType, volume }) {
    if (!ensure()) return null;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = base;
    lfo.type = lfoType;
    lfo.frequency.value = rate;
    lfoGain.gain.value = depth;
    gain.gain.value = volume;
    lfo.connect(lfoGain).connect(osc.frequency);
    osc.connect(gain).connect(master);
    osc.start();
    lfo.start();
    return { stop: () => { osc.stop(); lfo.stop(); } };
  }

  CJ.audio = {
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = on;
      if (master) master.gain.value = on ? 1 : 0;
    },
    pause(paused) {
      if (!ctx) return;
      if (paused) ctx.suspend(); else ctx.resume();
    },
    beep(freq = 2600, ms = 90, count = 3) {
      if (!ensure()) return;
      for (let i = 0; i < count; i++) {
        const t = ctx.currentTime + i * 0.17;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.07, t);
        g.gain.setValueAtTime(0, t + ms / 1000);
        osc.connect(g).connect(master);
        osc.start(t);
        osc.stop(t + ms / 1000 + 0.02);
      }
    },
    // Collision alarm: sawtooth sweeping 600 <-> 1400 Hz, 0.7 Hz (wail)
    startAlarm() {
      if (alarm) return;
      alarm = modulatedTone({ type: 'sawtooth', base: 1000, depth: 400, rate: 0.7, lfoType: 'triangle', volume: 0.06 });
    },
    stopAlarm() {
      if (alarm) alarm.stop();
      alarm = null;
    },
    get alarmOn() { return !!alarm; },
    // Emergency vehicles: two-tone "hi-lo" 650 / 900 Hz, alternating every 0.5 s
    startSiren() {
      if (siren) return;
      siren = modulatedTone({ type: 'square', base: 775, depth: 125, rate: 1, lfoType: 'square', volume: 0.025 });
    },
    stopSiren() {
      if (siren) siren.stop();
      siren = null;
    },
    stopAll() {
      this.stopAlarm();
      this.stopSiren();
    },
  };
})();
