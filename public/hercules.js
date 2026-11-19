'use strict';
/* HERCULES DJ CONSOLE (the original, Windows Edition, USB 06F8:B000) through WebHID.
   The console is a HID joystick, not a MIDI device. Its input report (id 1, 19 data bytes) is:
     bytes 1-4  : 30 buttons, bit n = byte (n >> 3) + 1, bit (n & 7)            (the last 2 bits are padding)
     bytes 5-10 : six EQ pots (8 bit)          byte 11: crossfader              bytes 12, 13: the two PITCH faders (centre = 127)
     bytes 14, 15: the two VOLUME knobs       bytes 16, 17: JOG wheels (endless)   bytes 18, 19: joystick X / Y
   (byte numbers are the ones of the Mixxx mapping, report id = byte 0; the descriptor was read from the real unit).
   Every change becomes a virtual MIDI-style message, so the calibration wizard, the monitor and the default map work exactly as before:
     button n            -> note on / off   [0x90, n, 127 / 0]
     pot / fader byte b  -> CC              [0xB0, b, value >> 1]            (7 bit)
     endless encoder b   -> CC              [0xB0, b, signed step as 7-bit two's complement]
   The LED output report (3 bytes) is written from the state of the decks. Needs globals from app.js: decks, ctl, onMidi, moveSel, loadToDeck,
   playlist, sel, togglePfl, hmSearch, cyclePadMode, clamp, toast, lsGet. */
(() => {
  const VID = 0x06f8, PID = 0xb000;
  const S = { noAct: false, mute: false, dev: null, name: '', connected: false, reports: 0, last: null, ledId: 1, ledOk: null, ledErr: '', ledSent: 0, lastLed: '' };

  /* ---------------------------------------------------------------- the default map (what each hardware position does until it is calibrated) */
  const BTN = {   // bit -> control id   (Mixxx "Hercules DJ Console Mk1" HID mapping)
    7: 'd0.play', 6: 'd0.layer', 5: 'd1.next', 4: 'd1.prev', 3: 'd1.sync', 2: 'd1.cue', 1: 'd1.play', 0: 'd1.layer',
    15: 'd1.pad1', 14: 'd0.pad1', 13: 'd0.pad2', 12: 'd0.pad3', 11: 'd0.next', 10: 'd0.prev', 9: 'd0.sync', 8: 'd0.cue',
    23: 'd1.bendDn', 22: 'd1.bendUp', 21: 'd0.beatlock', 20: 'd0.monitor', 19: 'd0.bendDn', 18: 'd0.bendUp', 17: 'd1.pad3', 16: 'd1.pad2',
    29: 'd1.load', 28: 'd0.load', 27: 'd1.load', 26: 'd0.load', 25: 'd1.beatlock', 24: 'd1.monitor',   // (both pairs of bits load: the big curved buttons are one of them, calibration tells which)
  };
  const AXIS = { 5: 'd1.bass', 6: 'd1.mid', 7: 'd1.treble', 8: 'd0.bass', 9: 'd0.mid', 10: 'd0.treble', 11: 'xf', 12: 'd0.pitch', 13: 'd1.pitch', 14: 'd0.vol', 15: 'd1.vol', 16: 'd0.jog', 17: 'd1.jog', 18: 'filter', 19: 'joyY' };
  const ENCODERS = new Set([16, 17]);

  /* ---------------------------------------------------------------- what a control does (shared with the calibration wizard) */
  const cur01 = id => { const el = ctl[id].el, mn = +el.min, mx = +el.max; return (+el.value - mn) / ((mx - mn) || 1); };
  const put01 = (id, v) => { const el = ctl[id].el, mn = +el.min, mx = +el.max; ctl[id].set(mn + clamp(v, 0, 1) * (mx - mn)); };
  const autoOn = () => !!(window.autodj && window.autodj.S && window.autodj.S.on);
  const curItem = () => playlist[sel];
  function button(id, down) {   // id 'd0.play', 'd1.bendUp', ...
    const [dk, key] = id.split('.'), i = +dk[1], d = decks[i];
    if (key === 'cue') { down ? d.cueDown() : d.cueUp(); return; }
    if (/^pad[1-3]$/.test(key)) { d.pad(+key[3] - 1, down); return; }
    if (key === 'bendDn') { d.bendBtn = down ? -1 : 0; return; }
    if (key === 'bendUp') { d.bendBtn = down ? 1 : 0; return; }
    if (!down) return;
    switch (key) {
      case 'play': d.toggle(); break;
      case 'sync': d.syncTo(decks[1 - i]); break;
      case 'beatlock': d.scratch = !d.scratch; toast('Deck ' + (i + 1) + ': scratch mode ' + (d.scratch ? 'ON' : 'off'), 1800); break;
      case 'prev': moveSel(-1); break;
      case 'next': moveSel(1); break;
      case 'load': if (curItem()) loadToDeck(d, curItem()); else toast('The playlist is empty'); break;
      case 'layer': cyclePadMode(d); break;
      case 'monitor': togglePfl(d); break;
      case 'source': hmSearch(d); break;
    }
  }
  const signed7 = v => (v < 0x40 ? v : v - 128);
  function axis(id, v7, rel) {   // v7: 0..127 absolute, or a signed step for endless encoders
    if (id === 'filter') { put01('headGain', v7 / 127); return; }
    if (id === 'xf') { if (!autoOn()) ctl.xf.set(v7 / 127 * 2 - 1); return; }
    const [dk, key] = id.split('.'), i = +(dk || '')[1]; if (!(i >= 0)) return;
    if (key === 'jog') { decks[i].jog(signed7(v7)); return; }
    if (key === 'pitch') { let pct = (v7 / 127 - 0.5) * 16; if (Math.abs(pct) < 0.12) pct = 0; ctl[`d${i}.pitch`].set((lsGet('invPitch', false) ? -1 : 1) * pct); return; }   // the PITCH fader: top = -8 %, bottom = +8 % (calibration learns the real direction)
    if (ctl[id]) put01(id, v7 / 127);
  }
  const cc = (ch, n, v) => { if (S.noAct) return; const id = AXIS[n]; if (id) axis(id, v, ENCODERS.has(n)); };
  const note = (ch, n, down) => { if (S.noAct) return; const id = BTN[n]; if (id) button(id, down); };   // (S.noAct: self-test, translate only)

  /* ---------------------------------------------------------------- reading the reports */
  let prev = null, first = true, monState = [false, false];
  const emit = (a, b, c) => { if (typeof onMidi === 'function') onMidi({ data: [a, b, c] }); };
  function onReport(bytes) {   // bytes: the 19 data bytes (report id removed)
    S.reports++; S.last = Array.from(bytes);
    if (bytes.length < 19) return;
    for (let n = 0; n < 30; n++) {
      const now = (bytes[n >> 3] >> (n & 7)) & 1, was = prev ? (prev[n >> 3] >> (n & 7)) & 1 : 0;
      if (!first && now !== was) emit(now ? 0x90 : 0x80, n, now ? 127 : 0);
    }
    for (let b = 5; b <= 19; b++) {
      const v = bytes[b - 1], o = prev ? prev[b - 1] : v;
      if (ENCODERS.has(b)) {
        if (first || v === o) continue;
        let dl = v - o; if (dl > 127) dl -= 256; if (dl < -127) dl += 256;     // the byte wraps: take the short way round
        dl = Math.max(-63, Math.min(63, dl)); emit(0xB0, b, dl >= 0 ? dl : 128 + dl);
      } else if (first ? (b === 11 || b === 14 || b === 15) : (v >> 1) !== (o >> 1)) emit(0xB0, b, v >> 1);   // at start only the crossfader and the channel faders are read (the EQ pots are not forced)
    }
    prev = Array.from(bytes); first = false;
  }

  /* ---------------------------------------------------------------- LEDs (output report: 3 bytes) */
  const layerOf = d => (d.padMode === 'hot' ? 'hot' : d.padMode === 'loop' ? 'loop' : 'fx');
  function ledBytes() {
    if (window.calib && window.calib.running) return [0, 0, 0];   // calibration starts with every light off
    const [a, b] = decks; let o1 = 0, o2 = 0;
    const la = layerOf(a), lb = layerOf(b), lit = d => !d.playing && d.buf && Math.abs(d.pos() - d.cuePt) < 0.03;
    if (la === 'hot') o1 |= 0x80; else if (la === 'fx') o1 |= 0x04; else o2 |= 0x40;
    if (lb === 'hot') o1 |= 0x10; else if (lb === 'fx') o1 |= 0x08; else o2 |= 0x80;
    if (a.scratch) o1 |= 0x01; if (b.scratch) o1 |= 0x02;
    if (a.playing) o2 |= 0x01; if (b.playing) o1 |= 0x40;
    if (lit(a)) o2 |= 0x08; if (lit(b)) o1 |= 0x20;
    if (a._syncLit) o2 |= 0x10; if (b._syncLit) o2 |= 0x20;
    return [o1, o2, 0];
  }
  let ledForce = 0;
  async function sendLeds(force) {
    if (!S.dev || !S.dev.opened || window.__ledHold) return;
    const bytes = ledBytes(), key = bytes.join(',');
    if (!force && key === S.lastLed && performance.now() - ledForce < 2000) return;
    S.lastLed = key; ledForce = performance.now();
    try { await S.dev.sendReport(S.ledId, new Uint8Array(bytes)); S.ledOk = true; S.ledSent++; S.ledErr = ''; }
    catch (e) { S.ledErr = String(e && e.message || e); if (S.ledOk !== true && S.ledId === 1) { S.ledId = 0; } S.ledOk = false; }
  }
  setInterval(() => sendLeds(false), 40);

  /* ---------------------------------------------------------------- connection */
  const chip = () => document.getElementById('midiStatus');
  const status = (txt, on) => { const c = chip(); if (c) { c.textContent = txt; c.className = 'chip ' + (on ? 'on' : 'off'); } };
  async function open(d) {
    try {
      if (!d.opened) await d.open();
      const oc = (d.collections || []).flatMap(c => c.outputReports || []); if (oc.length) S.ledId = oc[0].reportId;
      S.dev = d; S.name = d.productName || 'Hercules DJ Console'; S.connected = true; prev = null; first = true;
      d.oninputreport = e => { if (!S.mute) onReport(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength)); };
      status(`HID: ${S.name} connected`, true); sendLeds(true);
      if (window.calib) window.calib.maybeFirstRun();
      return true;
    } catch (e) { status('HID: could not open the console (' + (e && e.message || e) + ')', false); return false; }
  }
  const isHerc = d => d.vendorId === VID && d.productId === PID && (d.collections || []).some(c => (c.inputReports || []).some(r => r.reportId === 1));
  async function find() {
    try { const list = await navigator.hid.getDevices(); const d = list.find(isHerc); if (d) return open(d); } catch (e) { status('HID: ' + (e && e.message || e), false); return false; }
    status('HID: Hercules DJ Console not found – plug it in', false); return false;
  }
  async function init() {
    if (!navigator.hid) { status('HID: not available in this browser', false); return; }
    navigator.hid.addEventListener('connect', e => { if (isHerc(e.device)) open(e.device); });
    navigator.hid.addEventListener('disconnect', e => { if (S.dev && e.device === S.dev) { S.dev = null; S.connected = false; status('HID: Hercules DJ Console disconnected', false); } });
    await find();
    setInterval(() => { if (!S.connected) find(); }, 3000);                       // plugged in later / driver started late
    window.addEventListener('beforeunload', () => { try { if (S.dev) S.dev.sendReport(S.ledId, new Uint8Array([0, 0, 0])); } catch {} });   // leave the console dark
  }

  const mute = on => { S.mute = !!on; prev = null; first = true; };   // (self-test: ignore the real console and feed reports by hand)
  window.herc = { init, mute, S, BTN, AXIS, ENCODERS, button, axis, cc, note, feed: onReport, ledBytes, sendLeds, signed7, cur01, put01, get connected() { return S.connected; } };
  init();
})();
