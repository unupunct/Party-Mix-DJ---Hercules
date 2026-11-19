'use strict';
/* Controller calibration: a guided "learn each control" wizard.
   The faceplate highlights one control at a time (knob, fader, tempo fader, jog wheel, button); you move or press that one on the
   Party Mix and the app records which MIDI message it sends and its real travel. That identifies every hardware control with its
   software control, whatever the unit sends. Controls you skip keep the built-in mapping.
   Needs globals from app.js: decks, ctl, loadToDeck, playlist, sel, moveSel, togglePfl, hmSearch, lsGet, lsSet.
   Stored in localStorage('calibration') as { v:3, done, map: { controlId: {...} } }. */
(() => {
  const KEY = 'calibration';
  const blank = () => ({ v: 3, done: false, map: {} });
  let cal = lsGet(KEY, null); if (!cal || cal.v !== 3 || !cal.map) cal = blank();
  const save = () => lsSet(KEY, cal);
  let lang = lsGet('calLang', /^ro/i.test(navigator.language || '') ? 'ro' : 'en');
  const T = (en, ro) => (lang === 'ro' ? ro : en);
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const hex = n => n.toString(16).toUpperCase().padStart(2, '0');

  /* ---------------------------------------------------------------- the controls, in the order they are learned */
  const CTRL = [];
  const add = (id, t, en, ro, sel, deck) => CTRL.push({ id, t, en, ro, sel, deck });
  for (const i of [0, 1]) {
    const D = i + 1, dk = `#deck${i}`, hb = k => `[data-hc="d${i}.${k}"]`, kn = k => `.kn[data-ctl="d${i}.${k}"]`;
    add(`d${i}.treble`, 'knob', `Deck ${D} · TREBLE knob`, `Deck ${D} · butonul TREBLE`, kn('treble'), i);
    add(`d${i}.mid`, 'knob', `Deck ${D} · MEDIUM knob`, `Deck ${D} · butonul MEDIUM`, kn('mid'), i);
    add(`d${i}.bass`, 'knob', `Deck ${D} · BASS knob`, `Deck ${D} · butonul BASS`, kn('bass'), i);
    add(`d${i}.vol`, 'knob', `Deck ${D} · VOLUME knob`, `Deck ${D} · butonul VOLUME`, kn('vol'), i);
    add(`d${i}.pitch`, 'pitch', `Deck ${D} · PITCH fader`, `Deck ${D} · faderul PITCH`, `${dk} .tempo`, i);
    add(`d${i}.jog`, 'jog', `Deck ${D} · jog pad`, `Deck ${D} · jog pad`, `${dk} svg.jog`, i);
    add(`d${i}.play`, 'button', `Deck ${D} · PLAY / PAUSE button`, `Deck ${D} · butonul PLAY / PAUSE`, `${dk} [data-act=play]`, i);
    add(`d${i}.cue`, 'button', `Deck ${D} · CUE button`, `Deck ${D} · butonul CUE`, `${dk} [data-act=cue]`, i);
    add(`d${i}.sync`, 'button', `Deck ${D} · AUTO BEAT button (sync)`, `Deck ${D} · butonul AUTO BEAT (sync)`, `${dk} [data-act=sync]`, i);
    add(`d${i}.beatlock`, 'button', `Deck ${D} · MASTER TEMPO button (scratch mode)`, `Deck ${D} · butonul MASTER TEMPO (mod scratch)`, hb('beatlock'), i);
    add(`d${i}.bendDn`, 'button', `Deck ${D} · PITCH BEND − button`, `Deck ${D} · butonul PITCH BEND −`, hb('bendDn'), i);
    add(`d${i}.bendUp`, 'button', `Deck ${D} · PITCH BEND + button`, `Deck ${D} · butonul PITCH BEND +`, hb('bendUp'), i);
    add(`d${i}.prev`, 'button', `Deck ${D} · TRACK back button`, `Deck ${D} · butonul TRACK înapoi`, hb('prev'), i);
    add(`d${i}.next`, 'button', `Deck ${D} · TRACK forward button`, `Deck ${D} · butonul TRACK înainte`, hb('next'), i);
    add(`d${i}.load`, 'button', `Deck ${D} · LOAD button (the big curved button under the joystick)`, `Deck ${D} · butonul LOAD (butonul mare curbat de sub joystick)`, hb('load'), i);
    add(`d${i}.layer`, 'button', `Deck ${D} · LAYER button (the triangle beside the pad buttons)`, `Deck ${D} · butonul LAYER (triunghiul de lângă butoanele pad)`, hb('layer'), i);
    for (let n = 0; n < 3; n++) add(`d${i}.pad${n + 1}`, 'button', `Deck ${D} · pad button ${n + 1}`, `Deck ${D} · butonul pad ${n + 1}`, `#pads${i} .pad[data-pad="${n}"]`, i);
    add(`d${i}.monitor`, 'button', `Deck ${D} · headphone (monitor) button`, `Deck ${D} · butonul de căști (monitor)`, `${dk} [data-act=pfl]`, i);
  }
  add('xf', 'xf', 'Crossfader', 'Crossfader', '#decks .xwrap');
  add('headGain', 'stick', 'JOYSTICK left / right (the DJ filter)', 'JOYSTICK stânga / dreapta (filtrul DJ)', '#stick');
  const BYID = Object.fromEntries(CTRL.map(c => [c.id, c]));
  const HOWTO = {
    enc: () => T(['Turn the highlighted GAIN knob (an endless knob) a few steps CLOCKWISE, then a few steps back.'], ['Rotește butonul GAIN marcat (buton infinit) câțiva pași în sensul ACELOR DE CEASORNIC, apoi câțiva pași înapoi.']),
    knobf: () => T(['Move the highlighted fader all the way DOWN.', 'Then all the way UP.', 'Then leave it at the BOTTOM.'], ['Mută faderul marcat complet în JOS.', 'Apoi complet în SUS.', 'Apoi lasă-l JOS.']),
    stick: () => T(['Push the JOYSTICK fully LEFT.', 'Then fully RIGHT.', 'Then let go: it returns to the CENTRE.'], ['Împinge JOYSTICK-ul complet la STÂNGA.', 'Apoi complet la DREAPTA.', 'Apoi dă-i drumul: revine la CENTRU.']),
    knob: () => T(['Turn the highlighted knob fully LEFT.', 'Then fully RIGHT.', 'Then leave it in the MIDDLE.'], ['Rotește butonul marcat complet la STÂNGA.', 'Apoi complet la DREAPTA.', 'Apoi lasă-l la MIJLOC.']),
    fader: () => T(['Move the highlighted fader all the way DOWN.', 'Then all the way UP.', 'Then leave it at the BOTTOM.'], ['Mută faderul marcat complet în JOS.', 'Apoi complet în SUS.', 'Apoi lasă-l JOS.']),
    pitch: () => T(['Move the highlighted tempo fader slowly over its whole travel: up, down, up, down.', 'Leave it at the TOP (the −% end).'], ['Mișcă încet faderul de tempo marcat pe tot parcursul: sus, jos, sus, jos.', 'Lasă-l SUS (capătul −%).']),
    xf: () => T(['Move the crossfader fully LEFT (towards 1).', 'Then fully RIGHT (towards 2).', 'Then leave it in the CENTRE.'], ['Mută crossfaderul complet la STÂNGA (spre 1).', 'Apoi complet la DREAPTA (spre 2).', 'Apoi lasă-l la CENTRU.']),
    jog: () => T(['Turn the highlighted jog wheel CLOCKWISE at a normal DJ speed for about 3 seconds.'], ['Rotește jog wheel-ul marcat în sensul ACELOR DE CEASORNIC, cu viteză normală, circa 3 secunde.']),
    browse: () => T(['Turn the BROWSE wheel a few steps CLOCKWISE (towards the next track).'], ['Rotește roata BROWSE câțiva pași în sensul ACELOR DE CEASORNIC (spre piesa următoare).']),
    button: () => T(['Press the highlighted button once on the controller.'], ['Apasă o dată pe controller butonul marcat.']),
  };
  const PREP = () => ({ title: T('Get ready: everything to zero', 'Pregătire: totul pe zero'),
    list: T(['All console lights are now off.', 'Turn EVERY EQ knob fully to the LEFT (MIN).', 'Pull both channel faders all the way DOWN.', 'Push the crossfader fully to the LEFT (towards 1), and leave the joystick in the CENTRE.', 'Then click START. Next, each control is highlighted on the screen, one by one: you move or press just that one on the controller.'],
      ['Toate luminile consolei sunt stinse acum.', 'Rotește TOATE butoanele de EQ complet la STÂNGA (MIN).', 'Trage ambele fadere de canal complet în JOS.', 'Mută crossfaderul complet la STÂNGA (spre 1) și lasă joystick-ul la CENTRU.', 'Apoi apasă START. Apoi, fiecare control este marcat pe ecran, pe rând: tu miști sau apeși doar pe acela de pe controller.']) });

  /* ---------------------------------------------------------------- message keys */
  const kindOf = st => ({ 0xB0: 'c', 0xE0: 'p', 0x90: 'n', 0x80: 'n' })[st & 0xF0];
  const keyOf = (st, d1) => { const k = kindOf(st); return k ? (k === 'p' ? `p:${st & 15}` : `${k}:${st & 15}:${d1}`) : null; };
  const label = k => { const [t, ch, n] = k.split(':'); return t === 'p' ? `pitch-bend ch${+ch + 1}` : `${t === 'n' ? 'note' : 'CC'} ${hex(+n)} ch${+ch + 1}`; };
  const owner = (key, exceptId) => Object.keys(cal.map).find(id => id !== exceptId && cal.map[id].key === key);

  /* ---------------------------------------------------------------- applying what was learned */
  let learning = null;     // { stats: Map, last, timer, step }
  function down(m) { return m.d2 > 0 && (m.st & 0xF0) !== 0x80; }
  function applyKnob(id, n01) {
    if (id === 'xf') ctl.xf.set(n01 * 2 - 1); else ctl[id].set(n01);
  }
  /* Fine-tuning: while the user keeps turning a learned wheel the app keeps measuring the real step size and re-scales it, so a normal-speed turn always feels the same. */
  const refine = {}, flt = {};
  function refineJog(id, e, raw) {
    if (!raw) return false; const r = refine[id] || (refine[id] = { mags: [], n: 0 });
    r.mags.push(Math.abs(raw)); if (r.mags.length > 240) r.mags.shift(); r.n++;
    if (r.n % 12 === 0 && r.mags.length >= 24) { const ns = +Math.max(0.3, Math.min(3, 3 / median(r.mags))).toFixed(2); if (Math.abs(ns - e.scale) >= 0.02) { e.scale = ns; save(); } e.tuned = r.n; return true; }
    return !!e.tuned;
  }
  /* Glide: a 7-bit fader moves in steps of 0.8 %; small moves are eased towards the target on every frame (about 25 ms), so the sound and the on-screen fader move smoothly, with no zipper noise.
     A big jump (a flick) is applied at once. */
  const gl = {};
  const cur01 = id => { const el = ctl[id].el, mn = +el.min, mx = +el.max; return (+el.value - mn) / ((mx - mn) || 1); };
  function glide(id, nv) {
    const c = cur01(id), g = gl[id] || (gl[id] = { tgt: nv, tm: 0, last: -1 });
    g.tgt = nv;
    if (Math.abs(nv - c) > 0.25 || document.hidden) { clearInterval(g.tm); g.tm = 0; applyKnob(id, nv); g.last = nv; return; }
    if (g.tm) return;
    g.last = c;
    g.tm = setInterval(() => {
      const cc = cur01(id);
      if (Math.abs(cc - g.last) > 0.004) { clearInterval(g.tm); g.tm = 0; return; }   // someone else moved it (the app, Auto DJ, the mouse): stop easing, never fight
      const d = g.tgt - cc;
      if (Math.abs(d) < 0.0015) { applyKnob(id, g.tgt); g.last = g.tgt; clearInterval(g.tm); g.tm = 0; return; }
      const nx = cc + d * 0.45; applyKnob(id, nx); g.last = cur01(id);
    }, 16);
  }
  /* Channel faders: measured on the real Party Mix (right fader), the last ~15 % of the travel is electrically noisy: parked at the top it sends a saw-tooth between ~98 and 127
     (a value falling by 1 every 2 ms, then jumping back up), while the rest of the travel and the left fader are clean. So: when any value of the last 250 ms reached the top zone (>= 118)
     the fader counts as being at the top (full volume); leaving the top is a quick but smooth slide (no step), and all other positions follow the raw value at once. */
  const flt2 = {};
  function topFilter(id, e, raw) {
    const f = flt2[id] || (flt2[id] = { h: [], out: null, lt: 0, t: 0, last: raw });
    const now = performance.now(); f.last = raw; f.h.push([now, raw]); while (f.h.length && now - f.h[0][0] > 250) f.h.shift();
    return topEval(id, e, f, now);
  }
  function topEval(id, e, f, now) {
    while (f.h.length && now - f.h[0][0] > 250) f.h.shift();
    // the saw-tooth never goes below ~90, so a value under 84 proves the fader really left the top: follow it at once (no 250 ms hold)
    let tgt = f.last, hold = f.last >= 84 && f.h.some(x => x[1] >= 118); if (hold) tgt = 127;
    const dt = Math.max(0, Math.min(50, now - (f.lt || now))); f.lt = now;
    if (f.out != null && f.out > tgt && (f.held || f.out >= 118)) tgt = Math.max(tgt, f.out - 1.2 * dt - 1);   // leaving the top: a fast smooth slide down to the real position, never one big step
    f.held = hold || tgt > f.last + 1;
    f.out = tgt;
    if (tgt > e.max) { e.max = tgt; save(); } if (tgt < e.min) { e.min = tgt; save(); }
    const nv = clamp01((tgt - e.min) / ((e.max - e.min) || 1)); glide(id, nv);
    if (typeof midiLog !== "undefined") { midiLog.push([Math.round(performance.now()), "out", id, Math.round(tgt), Math.round(nv * 1000), Math.round(e.min), Math.round(e.max)]); if (midiLog.length > 6000) midiLog.shift(); }   // trace: filtered value actually applied
    clearTimeout(f.t); if (tgt !== f.last) f.t = setTimeout(() => topEval(id, e, f, performance.now()), 24);   // keep settling when no new message arrives
    return nv;
  }
  const bk = { acc: 0 };
  function apply(id, e, m) {
    const c = BYID[id], i = c.deck;
    switch (c.t) {
      case 'enc': { const raw = e.enc === 'offset' ? m.d2 - 64 : (m.d2 < 0x40 ? m.d2 : m.d2 - 128), dl = raw * e.sign; window.herc.put01(id, window.herc.cur01(id) + dl / 40); return dl > 0 ? '▶' : dl < 0 ? '◀' : '–'; }
      case 'knob': case 'knobf': case 'stick': case 'fader': case 'xf': {
        if (id === 'xf' && window.autodj && window.autodj.S && window.autodj.S.on) return 'Auto DJ is mixing';   // Auto DJ drives the crossfader itself
        if (c.t === 'fader') return topFilter(id, e, m.d2);
        // worn faders send isolated wrong values. Normal motion is applied at once; a sudden big jump waits for the next message to confirm it (or 40 ms of silence, so a quick flick still lands)
        const f = flt[id] || (flt[id] = { last: null, pend: null, t: 0 });
        const put = vv => {
          // the learned range can be too short (a pause during the sweep ended the capture early): any value beyond it widens it, so the physical end stops always read 0 and 1
          if (vv > e.max) { e.max = vv; save(); } if (vv < e.min) { e.min = vv; save(); }
          const nv = clamp01((vv - e.min) / ((e.max - e.min) || 1)); glide(id, nv); return nv;
        };
        const v = m.d2;
        if (f.last == null || Math.abs(v - f.last) <= 16 || (f.pend != null && Math.abs(v - f.pend) <= 16)) { clearTimeout(f.t); f.pend = null; f.last = v; return put(v); }
        f.pend = v; clearTimeout(f.t); f.t = setTimeout(() => { if (f.pend != null) { f.last = f.pend; f.pend = null; put(f.last); } }, 40);
        return clamp01((f.last - e.min) / ((e.max - e.min) || 1)); }
      case 'pitch': {
        const u = clamp01((m.d2 - e.top) / (e.bot - e.top)); let pct = (u - 0.5) * 16; if (Math.abs(pct) < 0.12) pct = 0;
        ctl[`d${i}.pitch`].set((lsGet('invPitch', false) ? -1 : 1) * pct); return `${pct > 0 ? '+' : ''}${pct.toFixed(2)} %`;
      }
      case 'jog': { const raw = e.enc === 'offset' ? m.d2 - 64 : (m.d2 < 0x40 ? m.d2 : m.d2 - 128), dl = raw * e.sign * e.scale; decks[i].jog(dl); const tuned = refineJog(id, e, raw); return (dl > 0 ? '▶' : dl < 0 ? '◀' : '–') + (tuned ? '  ×' + e.scale.toFixed(2) + ' (fine-tuned)' : ''); }
      case 'browse': { const raw = e.enc === 'offset' ? m.d2 - 64 : (m.d2 < 0x40 ? m.d2 : m.d2 - 128), dl = raw * e.sign; if (dl) moveSel(dl > 0 ? 1 : -1); return dl > 0 ? '▼' : '▲'; }
      case 'button': {
        const dn = down(m); window.herc.button(id, dn); return dn ? '●' : '○';
      }
    }
  }
  function handle(st, d1, d2) {
    if (st >= 0xF0) return false;
    const key = keyOf(st, d1); if (!key) return false;
    const m = { st, d1, d2: (st & 0xF0) === 0xE0 ? d2 : d2 };
    if (learning) { record(key, m); return true; }
    for (const id of Object.keys(cal.map)) {
      const e = cal.map[id]; if (e.key !== key) continue;
      const r = apply(id, e, m);
      if (live && live.id === id) { showLive(r); keepOpen(id); }
      return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- learning one control */
  let live = null;   // after a control was learned, show what it does while the user keeps moving it
  function record(key, m) {
    const L = learning, c = L.ctl; if (!c) return;
    if (c.t === 'button') {
      if (kindOf(m.st) !== 'n' || !down(m)) return;   // buttons are notes: a knob that is bumped must not be learned as a button
      const o = owner(key, c.id); if (o) return conflict(o);
      commit({ key, kind: kindOf(m.st) }); return;
    }
    if (kindOf(m.st) === 'n') return;                                // knobs and wheels are not notes
    const k = key; let s = L.stats.get(k);
    if (!s) { s = { key: k, st: m.st, d1: m.d1, n: 0, min: 127, max: 0, last: m.d2, tv: 0, vals: [] }; L.stats.set(k, s); }
    s.n++; s.tv += Math.abs(m.d2 - s.last); s.min = Math.min(s.min, m.d2); s.max = Math.max(s.max, m.d2); s.last = m.d2; if (s.vals.length < 800) s.vals.push(m.d2);
    L.last = s; paint(); clearTimeout(L.timer); L.timer = setTimeout(() => finishCapture(), 1400);
  }
  function conflict(o) { const r = $d('#calResult'); r.className = 'calresult bad'; r.textContent = T(`That message already belongs to "${BYID[o][lang] || o}". Use only the highlighted control.`, `Acest mesaj aparține deja la „${BYID[o][lang] || o}”. Folosește doar controlul marcat.`); }
  function finishCapture(manual) {
    const L = learning; if (!L || !L.ctl) return; clearTimeout(L.timer);
    const c = L.ctl, all = [...L.stats.values()];
    const fail = msg => { const r = $d('#calResult'); r.className = 'calresult bad'; r.textContent = msg; };
    if (!all.length) { if (manual) fail(T('Nothing was received. Move or press the highlighted control on the controller.', 'Nu am primit nimic. Mișcă sau apasă controlul marcat de pe controller.')); return; }
    let entry;
    if (c.t === 'jog' || c.t === 'browse' || c.t === 'enc') {
      const cs = all.filter(s => s.n >= (c.t === 'jog' ? 6 : 2) && !owner(s.key, c.id)).sort((a, b) => b.n - a.n), s = cs[0];
      if (!s) { if (manual || all.some(x => owner(x.key, c.id))) fail(T('Turn only this wheel, a little longer.', 'Rotește doar această roată, ceva mai mult.')); return; }
      const med = median(s.vals), enc = (med >= 0x34 && med <= 0x4C) ? 'offset' : 'twos';
      const deltas = s.vals.map(v => enc === 'offset' ? v - 64 : (v < 0x40 ? v : v - 128)).filter(v => v !== 0);
      const sign = median(deltas) >= 0 ? 1 : -1, mag = median(deltas.map(Math.abs)) || 1;
      entry = { key: s.key, kind: kindOf(s.st), enc, sign, scale: +Math.max(0.3, Math.min(3, 3 / mag)).toFixed(2) };
    } else {
      let cs = all.filter(s => s.n >= 3 && s.max - s.min >= 20);
      const keys = new Set(cs.map(s => s.key));
      cs = cs.filter(s => !(kindOf(s.st) === 'c' && s.d1 >= 32 && s.d1 < 64 && keys.has(`c:${s.st & 15}:${s.d1 - 32}`)));   // low half of a 14-bit pair = noise
      if (!cs.length) { if (manual) fail(T('Move the highlighted control over its whole travel first.', 'Mișcă mai întâi controlul marcat pe tot parcursul.')); return; }
      const free = cs.filter(s => !owner(s.key, c.id));
      if (!free.length) { conflict(owner(cs[0].key, c.id)); return; }
      free.sort((a, b) => (a.tv / (a.max - a.min)) - (b.tv / (b.max - b.min)));      // smoothest sweep = a real control, not jitter
      const s = free[0];
      if (c.t === 'pitch') { const top = s.last, bot = top > (s.min + s.max) / 2 ? s.min : s.max; if (Math.abs(top - bot) < 20) { fail(T('Leave the tempo fader at the very TOP, then wait a moment.', 'Lasă faderul de tempo complet SUS, apoi așteaptă puțin.')); return; } entry = { key: s.key, kind: kindOf(s.st), top, bot }; }
      else {
        // a knob or fader must have been moved over (almost) its whole travel; otherwise keep waiting instead of learning a half range
        if (!manual && s.max - s.min < 100) { const r = $d('#calResult'); r.className = 'calresult bad'; r.textContent = T('Keep going: move it all the way to both ends.', 'Continuă: mută-l până la ambele capete.'); return; }
        let mn = s.min, mx = s.max; if (mn <= 12) mn = 0; if (mx >= 115) mx = 127;   // end stops that were reached read exactly 0 and 1
        entry = { key: s.key, kind: kindOf(s.st), min: mn, max: mx };
      }
    }
    commit(entry);
  }
  function commit(entry) {
    const L = learning, c = L.ctl; clearTimeout(L.timer);
    cal.map[c.id] = entry; save();
    const r = $d('#calResult'); r.className = 'calresult ok'; r.textContent = '✓ ' + T('learned: ', 'învățat: ') + label(entry.key);
    live = { id: c.id }; learning = null; delete refine[c.id]; keepOpen(c.id);
    if (c.t !== 'button') { const r2 = $d('#calResult'); r2.textContent += T('  ·  keep turning / moving it a few more times to fine-tune, then press DONE', '  ·  continuă să-l rotești / miști de câteva ori pentru reglaj fin, apoi apasă GATA'); }
  }
  // the wizard moves on by itself only after the control has been quiet for a while: more movement = more fine-tuning
  let advT = 0;
  function keepOpen(id) {
    clearTimeout(advT); const c = BYID[id]; if (!c) return;
    advT = setTimeout(() => { if (dlg && dlg.open && running && !learning && live && live.id === id) next(); }, c.t === 'button' ? 500 : 4500);
  }

  /* ---------------------------------------------------------------- dialog (non-modal, so the highlighted faceplate stays visible) */
  let dlg, idx = -1, firstRun = false, running = false, hl = null;
  const $d = s => dlg.querySelector(s);
  const setRunning = on => { running = on; const d = document.getElementById('decks'); if (d) d.classList.toggle('calibrating', on); if (!on) highlight(null); };
  function highlight(sel) {
    if (hl) { hl.classList.remove('calTarget'); hl = null; }
    if (!sel) return; try { hl = document.querySelector(sel); } catch { hl = null; }
    if (hl) {
      hl.classList.add('calTarget');
      if (dlg) { const r = hl.getBoundingClientRect(), toRight = (r.left + r.width / 2) < innerWidth * 0.55; dlg.style.left = toRight ? 'auto' : '16px'; dlg.style.right = toRight ? '16px' : 'auto'; }   // the panel stays on the other side, never on top of the control
    }
  }
  function build() {
    if (dlg) return;
    dlg = document.createElement('dialog'); dlg.id = 'caldlg'; dlg.className = 'caldlg';
    dlg.innerHTML = `<div class="calwrap">
      <div class="calhead"><h3 id="calTitle"></h3><div class="callang"><button data-l="ro">RO</button><button data-l="en">EN</button></div></div>
      <div class="calprog"><i id="calProgI"></i></div><div id="calStep" class="calstep"></div>
      <ol id="calList" class="callist"></ol>
      <div class="calLive"><div class="calBar"><i id="calBarI"></i></div><div class="calRead"><code id="calMsg"></code><b id="calVal"></b></div></div>
      <div id="calResult" class="calresult"></div>
      <menu><button id="calBack"></button><button id="calSkip"></button><button id="calCancel"></button><button id="calDone" class="primary"></button></menu></div>`;
    document.body.appendChild(dlg);
    $d('#calDone').onclick = onDone; $d('#calBack').onclick = () => { idx = Math.max(-1, idx - 1); show(); }; $d('#calSkip').onclick = () => next();
    $d('#calCancel').onclick = () => stop(); dlg.addEventListener('cancel', e => { e.preventDefault(); stop(); });
    dlg.querySelectorAll('.callang button').forEach(b => b.onclick = () => { lang = b.dataset.l; lsSet('calLang', lang); show(true); });
  }
  function stop() { clearTimeout(learning && learning.timer); learning = null; live = null; setRunning(false); cal.done = true; save(); if (dlg && dlg.open) dlg.close(); }
  function paint() {
    if (!dlg || !learning) return; const s = learning.last;
    $d('#calMsg').textContent = s ? `${label(s.key)} = ${s.last}   ·  ${s.n}` : T('waiting for the controller…', 'aștept controllerul…');
    if (s) $d('#calBarI').style.width = Math.round(s.last / 127 * 100) + '%';
  }
  function showLive(txt) { if (dlg && dlg.open) { $d('#calVal').textContent = String(txt); } }
  function show(keep) {
    clearTimeout(learning && learning.timer); live = null;
    if (idx < 0) {   // preparation page
      const p = PREP(); learning = null; highlight(null);
      $d('#calTitle').textContent = p.title; $d('#calStep').textContent = ''; $d('#calProgI').style.width = '0%';
      $d('#calList').innerHTML = p.list.map(x => `<li>${x}</li>`).join(''); $d('#calMsg').textContent = ''; $d('#calVal').textContent = ''; $d('#calBarI').style.width = '0%';
      $d('#calResult').textContent = ''; $d('#calResult').className = 'calresult';
      $d('#calDone').textContent = T('START', 'START'); $d('#calSkip').hidden = true; $d('#calBack').hidden = true; $d('#calCancel').textContent = T('Close', 'Închide');
      dlg.querySelectorAll('.callang button').forEach(b => b.classList.toggle('on', b.dataset.l === lang)); return;
    }
    if (idx >= CTRL.length) return finish();
    const c = CTRL[idx]; learning = { stats: new Map(), last: null, timer: 0, ctl: c };
    highlight(c.sel); if (hl) try { hl.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {}
    $d('#calTitle').textContent = c[lang]; $d('#calStep').textContent = T(`Control ${idx + 1} of ${CTRL.length}`, `Controlul ${idx + 1} din ${CTRL.length}`);
    $d('#calProgI').style.width = Math.round(idx / CTRL.length * 100) + '%';
    $d('#calList').innerHTML = HOWTO[c.t]().map(x => `<li>${x}</li>`).join('');
    $d('#calMsg').textContent = T('waiting for the controller…', 'aștept controllerul…'); $d('#calVal').textContent = ''; $d('#calBarI').style.width = '0%';
    $d('#calResult').textContent = ''; $d('#calResult').className = 'calresult';
    $d('#calDone').textContent = T('DONE', 'GATA'); $d('#calSkip').hidden = false; $d('#calBack').hidden = false;
    $d('#calSkip').textContent = T('Skip', 'Sari peste'); $d('#calBack').textContent = T('◀ Back', '◀ Înapoi'); $d('#calCancel').textContent = T('Close', 'Închide');
    dlg.querySelectorAll('.callang button').forEach(b => b.classList.toggle('on', b.dataset.l === lang));
  }
  function onDone() {
    if (idx < 0) { idx = 0; show(); return; }
    if (idx >= CTRL.length) { stop(); return; }
    if (learning) { finishCapture(true); return; }          // learn now what was received
    next();                                                  // already learned: go on
  }
  function next() { clearTimeout(learning && learning.timer); clearTimeout(advT); idx++; show(); }
  function finish() {
    learning = null; live = null; highlight(null); setRunning(false); cal.done = true; save();
    const got = CTRL.filter(c => cal.map[c.id]), miss = CTRL.filter(c => !cal.map[c.id]);
    $d('#calTitle').textContent = T('Calibration complete', 'Calibrare terminată'); $d('#calStep').textContent = T(`${got.length} of ${CTRL.length} controls learned`, `${got.length} din ${CTRL.length} controale învățate`);
    $d('#calProgI').style.width = '100%';
    $d('#calList').innerHTML = miss.length ? `<li class="badli">${T('Not learned (they keep the built-in mapping): ', 'Neînvățate (rămân pe maparea standard): ')}${miss.map(c => c[lang]).join(', ')}</li>` : `<li class="okli">✓ ${T('Every control was learned.', 'Toate controalele au fost învățate.')}</li>`;
    $d('#calResult').className = 'calresult'; $d('#calResult').textContent = T('Run it again any time: Calibrate button in the toolbar, or Audio settings → Controller calibration.', 'Poți relua oricând: butonul Calibrate din bara de sus, sau Audio settings → Controller calibration.');
    $d('#calMsg').textContent = ''; $d('#calVal').textContent = ''; $d('#calBarI').style.width = '0%';
    $d('#calSkip').hidden = true; $d('#calBack').hidden = true; $d('#calDone').textContent = T('Close', 'Închide');
    idx = CTRL.length;
  }
  function open(fromStep) {
    build(); setRunning(true); idx = -1; show();
    if (!dlg.open) dlg.show();
  }
  function reset() { cal = blank(); save(); }
  function maybeFirstRun() {
    if (cal.done || firstRun || new URLSearchParams(location.search).has('selftest')) return;
    firstRun = true; setTimeout(() => { if (!cal.done && !(dlg && dlg.open)) open(); }, 1200);
  }

  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
  on('btnCal', () => open()); on('aRecal', () => { const d = document.getElementById('audiodlg'); if (d && d.open) d.close(); open(); });
  on('aCalReset', () => { reset(); const m = document.getElementById('aCalState'); if (m) m.textContent = 'Calibration cleared: the built-in mapping is used.'; });
  on('btnFs', () => {
    if (window.electronAPI && window.electronAPI.toggleFullscreen) window.electronAPI.toggleFullscreen();
    else if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
  });
  window.calib = { handle, open, reset, maybeFirstRun, CTRL, get cal() { return cal; }, get active() { return !!learning; }, get running() { return running; }, get index() { return idx; } };
})();
