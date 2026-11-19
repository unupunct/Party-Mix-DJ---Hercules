'use strict';
/* Console faceplate: the DJ screen drawn after the user's Hercules DJ Console (the original, Windows Edition), top view.
   A black body with a silver plate. Per deck: TREBLE / MEDIUM / BASS and VOLUME knobs, a monitor (headphone) button with its green light, PITCH BEND - / +,
   a vertical PITCH fader, MASTER TEMPO (beat lock / scratch, with its red light), a LAYER button with the three pad buttons 3 2 1 and the FX / CUE / LOOP lights,
   TRACK back / forward, a big CUE and a big PLAY / PAUSE button, AUTO BEAT (sync) and LOAD in the middle, and a big studded jog pad (the HARMONIC MATCH hub sits in its centre).
   In the middle: the joystick (the DJ filter) and the crossfader. BROWSE, MASTER and HEADPHONES VOLUME are on-screen controls on the black frame.
   The photo is 500 x 422; the design is that photo x 1.04 (x 1.3 more sideways, so the face is as wide as the column between the side panels) plus a 16 px frame on top (708 x 456), scaled to the window.
   Globals from app.js: decks, ctl, playlist, sel, nat, loadToDeck, moveSel, trackLabel, clamp, toast, lsGet, lsSet. */
(() => {
  const root = document.getElementById('decks');
  if (!root) return;
  root.classList.add('console', 'hercules');
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const html = (tag, cls, parent, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; if (parent) parent.appendChild(e); return e; };
  const place = (e, x, y, w, h) => { e.style.left = x + 'px'; e.style.top = y + 'px'; if (w != null) e.style.width = w + 'px'; if (h != null) e.style.height = h + 'px'; return e; };
  const rad = d => (d - 90) * Math.PI / 180;
  const arc = (cx, cy, r, a0, a1) => { const p = a => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))].map(v => v.toFixed(2)); const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0},${y0} A${r},${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${x1},${y1}`; };
  const S = 1.04, SX = 1.3, OY = 16, DW = 708, DH = 456;   // photo -> design: the face is stretched sideways (x * 1.3) so it reaches the panels beside it; sizes stay round
  const X = x => DW / 2 + (x - 250) * S * SX, Y = y => y * S + OY;
  const cp = (e, x, y, w, h) => place(e, X(x) - w / 2, Y(y) - h / 2, w, h);   // centre an element on a photo point
  let K = 1;                                     // current scale (design px -> screen px)

  /* ---------------------------------------------------------------- stage: the printed face, the two deck layers and the mixer layer */
  const stage = html('div', 'stage'), board = html('div', 'board', stage);
  const [deckA, deckB] = [root.querySelector('.deck.a'), root.querySelector('.deck.b')], mixer = root.querySelector('.mixer');
  const deckEls = [deckA, deckB];
  place(board, 0, 0, DW, DH);
  // the face: black body, rubber rails, silver plate, badge, printed marks (drawn once)
  const face = svgEl('svg', { class: 'hface', viewBox: `0 0 ${DW} ${DH}`, width: DW, height: DH }, board);
  { const defs = svgEl('defs', {}, face);
    const g1 = svgEl('linearGradient', { id: 'hbody', x1: 0, y1: 0, x2: 0, y2: 1 }, defs); [['0', '#2a2a2b'], ['.5', '#161617'], ['1', '#0b0b0c']].forEach(([o, c]) => svgEl('stop', { offset: o, 'stop-color': c }, g1));
    const g2 = svgEl('linearGradient', { id: 'hplate', x1: 0, y1: 0, x2: 0, y2: 1 }, defs); [['0', '#d8d8d2'], ['.55', '#c3c3bd'], ['1', '#b0b1ab']].forEach(([o, c]) => svgEl('stop', { offset: o, 'stop-color': c }, g2));
    const g3 = svgEl('radialGradient', { id: 'hstick', cx: .38, cy: .32, r: .9 }, defs); [['0', '#5d5d60'], ['.55', '#1b1b1d'], ['1', '#050506']].forEach(([o, c]) => svgEl('stop', { offset: o, 'stop-color': c }, g3));
    const g4 = svgEl('linearGradient', { id: 'hring', x1: 0, y1: 0, x2: 1, y2: 1 }, defs); [['0', '#f4f4ef'], ['.5', '#b9bab4'], ['1', '#8e8f89']].forEach(([o, c]) => svgEl('stop', { offset: o, 'stop-color': c }, g4));
    svgEl('rect', { x: 0, y: 0, width: DW, height: DH, rx: 30, fill: 'url(#hbody)', stroke: '#000', 'stroke-width': 2 }, face);
    for (const sx of [0, 1]) for (let k = 0; k < 7; k++) svgEl('rect', { x: sx ? DW - 11 : 3, y: 60 + k * 50, width: 8, height: 30, rx: 3, fill: '#0d0d0e', stroke: '#2e2e30', 'stroke-width': 1 }, face);   // the grooves of the rubber rails
    svgEl('rect', { x: 14, y: 40, width: DW - 28, height: DH - 52, rx: 20, fill: 'url(#hplate)', stroke: '#6f706a', 'stroke-width': 1.5 }, face);
    svgEl('rect', { x: 16, y: 42, width: DW - 32, height: DH - 56, rx: 18, fill: 'none', stroke: '#ffffff66', 'stroke-width': 1 }, face);
    svgEl('ellipse', { cx: DW / 2, cy: 22, rx: 66, ry: 16, fill: '#0a0a0b', stroke: '#47474a', 'stroke-width': 1.5 }, face);
    { const t = svgEl('text', { x: DW / 2, y: 28, 'text-anchor': 'middle', fill: '#f2f2ee', 'font-family': 'Georgia,serif', 'font-style': 'italic', 'font-weight': 700, 'font-size': 15 }, face); t.textContent = 'DJ CONSOLE'; }
    // printed marks (dark grey on the silver)
    const lab = (txt, x, y, o = {}) => { const at = { x: X(x), y: Y(y), 'text-anchor': o.a || 'middle', fill: o.c || '#2d2d2b', 'font-family': 'Segoe UI,Arial,sans-serif', 'font-weight': o.w || 700, 'font-size': o.s || 7.5, 'letter-spacing': o.ls || 0.3 }; if (o.rot) at.transform = `rotate(${o.rot} ${X(x)} ${Y(y)})`; const t = svgEl('text', at, face); t.textContent = txt; return t; };
    for (const m of [0, 1]) {
      const mx = x => (m ? 500 - x : x);
      lab('Treble', mx(50), 52, { s: 8 }); lab('Medium', mx(50), 115, { s: 8 }); lab('Bass', mx(50), 178, { s: 8 }); lab('Volume', mx(100), 52, { s: 8 });
      lab('Pitch bend', mx(99), 183, { s: 7 }); lab('Pitch', mx(152), 224, { s: 8.5 }); lab('TRACK', mx(50), 266, { s: 6.8, ls: 1 });
      lab('MASTER TEMPO', mx(m ? 208 : 208), 158, { s: 5.4, rot: -90, ls: 0.6 });
      // the pitch fader slot with its scale
      svgEl('rect', { x: X(mx(152)) - 3.5, y: Y(90), width: 7, height: 120 * S, rx: 3, fill: '#101011', stroke: '#6a6b65', 'stroke-width': 1 }, face);
      for (let k = 0; k <= 8; k++) svgEl('line', { x1: X(mx(152)) + (m ? 8 : -8), y1: Y(90) + k * 15 * S, x2: X(mx(152)) + (m ? 13 : -13), y2: Y(90) + k * 15 * S, stroke: '#3a3a38', 'stroke-width': k % 4 === 0 ? 1.6 : 1 }, face);
    }
    lab('AUTO BEAT', 247, 266, { s: 7.6, ls: 1.4 }); lab('crossfader', 247, 354, { s: 11, w: 400, ls: 1 }).setAttribute('font-style', 'italic');
    // the joystick base: silver ring and a dark well
    svgEl('circle', { cx: X(247), cy: Y(143), r: 41, fill: 'url(#hring)', stroke: '#6e6f69', 'stroke-width': 1.2 }, face);
    svgEl('circle', { cx: X(247), cy: Y(143), r: 31, fill: '#0e0e0f', stroke: '#2a2a2c', 'stroke-width': 1 }, face);
    // the crossfader slot with its scale
    svgEl('rect', { x: X(247) - 96 * SX, y: Y(370) - 3.5, width: 192 * SX, height: 7, rx: 3, fill: '#101011', stroke: '#6a6b65', 'stroke-width': 1 }, face);
    for (let k = 0; k <= 20; k++) svgEl('line', { x1: X(247) - 96 * SX + k * 9.6 * SX, y1: Y(370) - 12, x2: X(247) - 96 * SX + k * 9.6 * SX, y2: Y(370) - (k % 5 === 0 ? 7 : 9), stroke: '#33332f', 'stroke-width': k === 10 ? 1.8 : 1 }, face);
    // on-screen controls on the black frame
    const wl = (txt, x, y, a) => { const t = svgEl('text', { x, y, 'text-anchor': a || 'middle', fill: '#c9c9c4', 'font-family': 'Segoe UI,Arial,sans-serif', 'font-weight': 700, 'font-size': 6.6, 'letter-spacing': 0.5 }, face); t.textContent = txt; };
    wl('BROWSE', X(62) + 20, 30, 'start'); wl('MASTER', X(398) - 15, 37, 'end'); wl('PHONES', X(452) - 15, 37, 'end');
  }
  stage.append(deckA, mixer, deckB); root.appendChild(stage);
  for (const e of [deckA, mixer, deckB]) place(e, 0, 0, DW, DH);
  const fit = () => { const W = root.clientWidth, H = root.clientHeight || DH; K = Math.max(0.3, Math.min(W / DW, H / DH)); stage.style.transform = `scale(${K})`; stage.style.left = Math.max(0, (W - DW * K) / 2) + 'px'; stage.style.top = Math.max(0, (H - DH * K) / 2) + 'px'; };
  new ResizeObserver(fit).observe(root); fit();

  // the Hercules console has no party lights: kept as inert stand-ins so the modules that look at them keep working
  const lights = { mode: 'off', last: [-1, -1, -1], lastSend: 0, level: 0, iv: [0, 0, 0] }, setLights = () => {};

  /* ---------------------------------------------------------------- rotary knobs (bound to the existing range inputs) */
  const KNOB_TEXT = { treble: 'TREBLE', mid: 'MEDIUM', bass: 'BASS', vol: 'VOLUME', master: 'MASTER', headMix: 'PHONES' };
  const knobs = [];
  function makeKnob(input) {
    const name = input.id, min = +input.min, max = +input.max, def = name.endsWith('.vol') ? 0 : (min + max) / 2;
    const wrap = input.closest('.knob'); wrap.classList.add('kwrap'); input.classList.add('vh');
    const w = html('div', 'kn'); w.dataset.ctl = name; w.tabIndex = 0; w.setAttribute('role', 'slider'); w.title = 'Drag up/down, scroll, double-click to reset';
    const s = svgEl('svg', { viewBox: '0 0 64 64' }, w);
    for (let k = 0; k <= 10; k++) { const a = rad(-135 + 27 * k), r0 = 29, r1 = k % 5 === 0 ? 33 : 31; svgEl('line', { x1: 32 + r0 * Math.cos(a), y1: 32 + r0 * Math.sin(a), x2: 32 + r1 * Math.cos(a), y2: 32 + r1 * Math.sin(a), class: 'kn-tick' }, s); }
    const val = svgEl('path', { class: 'kn-val' }, s);
    svgEl('circle', { cx: 32, cy: 32, r: 24, class: 'kn-body' }, s);
    svgEl('circle', { cx: 32, cy: 32, r: 24, class: 'kn-ridge' }, s);
    const cap = svgEl('g', {}, s);
    svgEl('circle', { cx: 32, cy: 32, r: 18, class: 'kn-cap' }, cap);
    svgEl('rect', { x: 30, y: 9, width: 4, height: 15, rx: 1.6, class: 'kn-ind' }, cap);
    wrap.insertBefore(w, wrap.firstChild);
    const key = name.replace(/^d\d\./, ''), t = KNOB_TEXT[key]; const sp = wrap.querySelector('span'); if (sp) sp.textContent = t || sp.textContent;
    const draw = () => { const v = clamp((+input.value - min) / (max - min), 0, 1), a = -135 + 270 * v; cap.setAttribute('transform', `rotate(${a} 32 32)`); val.setAttribute('d', v <= 0.001 ? '' : arc(32, 32, 27.5, -135, a)); w.dataset.v = v.toFixed(3); w.setAttribute('aria-valuenow', String(Math.round(v * 100))); };
    const set = v01 => ctl[name].set(min + clamp(v01, 0, 1) * (max - min));
    const orig = ctl[name].set; ctl[name].set = v => { orig(v); draw(); };        // controller / app changes move the knob too
    input.addEventListener('input', draw);
    let drag = null;
    w.addEventListener('pointerdown', e => { try { w.setPointerCapture(e.pointerId); } catch {} drag = { y: e.clientY, v: (+input.value - min) / (max - min) }; e.preventDefault(); });
    w.addEventListener('pointermove', e => { if (drag) set(drag.v + (drag.y - e.clientY) / ((e.shiftKey ? 600 : 160) * K)); });
    w.addEventListener('pointerup', () => { drag = null; });
    w.addEventListener('wheel', e => { e.preventDefault(); set((+input.value - min) / (max - min) + (e.deltaY < 0 ? 0.04 : -0.04)); }, { passive: false });
    w.addEventListener('dblclick', () => ctl[name].set(def));
    w.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set((+input.value - min) / (max - min) + 0.04); else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set((+input.value - min) / (max - min) - 0.04); });
    draw(); knobs.push({ name, draw, wrap });
  }
  // the channel volume is a knob on the console: turn the fader input of each channel into one
  mixer.querySelectorAll('.ch').forEach(ch => { const f = ch.querySelector('.fader'); const kw = html('div', 'knob', ch); kw.appendChild(f); html('span', '', kw, 'VOLUME'); f.classList.remove('fader'); });
  root.querySelectorAll('.knob input[type=range]').forEach(makeKnob);
  const knobWrap = id => document.getElementById(id).closest('.knob');

  /* ---------------------------------------------------------------- jog pads (studded black rubber) with the HARMONIC MATCH hub */
  const jogs = [], JR = 76, JC = [[147, 297], [348, 297]];
  function makeJog(d) {
    const D = deckEls[d.i], box = html('div', 'jogbox'); place(box, X(JC[d.i][0]) - JR - 3, Y(JC[d.i][1]) - JR - 3, 2 * JR + 6, 2 * JR + 6);
    const s = svgEl('svg', { viewBox: '0 0 220 220', class: 'jog', role: 'img', 'aria-label': 'Jog wheel, Deck ' + (d.i + 1) }, box);
    const defs = svgEl('defs', {}, s);
    const rg = svgEl('radialGradient', { id: 'plat' + d.i, cx: .4, cy: .32, r: .95 }, defs); [['0', '#3a3a3c'], ['.6', '#19191a'], ['1', '#070708']].forEach(([o, c]) => svgEl('stop', { offset: o, 'stop-color': c }, rg));
    const pat = svgEl('pattern', { id: 'dots' + d.i, width: 8, height: 8, patternUnits: 'userSpaceOnUse' }, defs); svgEl('circle', { cx: 4, cy: 4, r: 1.9, fill: '#4a4a4d' }, pat); svgEl('circle', { cx: 3.4, cy: 3.4, r: 0.7, fill: '#8a8a8e' }, pat);
    svgEl('circle', { cx: 110, cy: 110, r: 109, class: 'j-case' }, s);
    const C = 2 * Math.PI * 100;
    svgEl('circle', { cx: 110, cy: 110, r: 100, class: 'j-progbg' }, s);
    const prog = svgEl('circle', { cx: 110, cy: 110, r: 100, class: 'j-prog', 'stroke-dasharray': C.toFixed(1), 'stroke-dashoffset': C.toFixed(1), transform: 'rotate(-90 110 110)' }, s);
    const rot = svgEl('g', { class: 'j-rot' }, s);
    svgEl('circle', { cx: 110, cy: 110, r: 96, fill: `url(#plat${d.i})`, class: 'j-plat' }, rot);
    svgEl('circle', { cx: 110, cy: 110, r: 92, fill: `url(#dots${d.i})`, class: 'j-dots' }, rot);
    svgEl('circle', { cx: 74, cy: 62, r: 15, class: 'j-bump' }, rot);                                      // the raised bump of the pad: it shows the rotation
    const led = svgEl('circle', { cx: 110, cy: 110, r: 0, class: 'j-led' }, s);                                // (kept so other code can dim / light it; not drawn)
    const hit = svgEl('circle', { cx: 110, cy: 110, r: 96, class: 'j-hit' }, s);
    const hub = svgEl('g', { class: 'hub', tabindex: 0, role: 'button', 'aria-label': 'Harmonic Match: find the next song for Deck ' + (d.i + 1) }, s);
    svgEl('title', {}, hub).textContent = 'HARMONIC MATCH: find the next song for Deck ' + (d.i + 1) + ' (opens the Harmonic Match tab)';
    svgEl('circle', { cx: 110, cy: 110, r: 46, class: 'h-bg' }, hub);
    for (let k = 0; k < 48; k++) svgEl('line', { x1: 110, y1: 66, x2: 110, y2: k % 4 === 0 ? 73 : 70, class: 'h-tick', transform: `rotate(${k * 7.5} 110 110)` }, hub);
    svgEl('circle', { cx: 110, cy: 110, r: 37, class: 'h-edge' }, hub);
    const t = (y, cls, txt) => { const e = svgEl('text', { x: 110, y, 'text-anchor': 'middle', class: cls }, hub); e.textContent = txt; return e; };
    t(104, 'h-t1', 'HARMONIC'); t(117, 'h-t2', 'MATCH'); const info = t(130, 'h-info', 'Deck ' + (d.i + 1));
    D.appendChild(box);

    let drag = null, acc = 0, offset = 0;
    const ang = (e, r) => Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
    hit.addEventListener('pointerdown', e => { try { hit.setPointerCapture(e.pointerId); } catch {} drag = { last: ang(e, s.getBoundingClientRect()) }; });
    hit.addEventListener('pointermove', e => {
      if (!drag) return; const a = ang(e, s.getBoundingClientRect()); let dd = a - drag.last; if (dd > 180) dd -= 360; if (dd < -180) dd += 360; drag.last = a;
      offset += dd; acc += dd / 5;
      while (Math.abs(acc) >= 1) { d.jog(Math.sign(acc)); acc -= Math.sign(acc); }
    });
    const end = () => { drag = null; acc = 0; };
    hit.addEventListener('pointerup', end); hit.addEventListener('pointercancel', end);
    hit.addEventListener('wheel', e => { e.preventDefault(); d.jog(e.deltaY < 0 ? 2 : -2); offset += e.deltaY < 0 ? 10 : -10; }, { passive: false });
    const open = () => window.harmonic && window.harmonic.openForDeck(d.i);
    hub.addEventListener('click', open);
    hub.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    jogs.push({ d, rot, prog, C, info, hub, led, angle: 0, get offset() { return offset; }, set offset(v) { offset = v; } });
  }
  decks.forEach(makeJog);

  /* ---------------------------------------------------------------- decks: every control at its place on the photo */
  const ICON_PFL = '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="3" y="13" width="4.5" height="7" rx="1.6" fill="currentColor"/><rect x="16.5" y="13" width="4.5" height="7" rx="1.6" fill="currentColor"/></svg>';
  const cur = () => playlist[sel];
  const lockLeds = [], monLeds = [];
  function layoutDeck(d) {
    const D = deckEls[d.i], m = d.i, mx = x => (m ? 500 - x : x), hc = k => `d${d.i}.${k}`;
    // overview strip moves up under the big waveform
    const ov = D.querySelector('canvas.ov'), wave = document.querySelectorAll('#waves .wavebox')[d.i];
    if (ov && wave) { ov.classList.add('ovbar'); wave.appendChild(ov); }
    const row = D.querySelector('.row'), q = a => row.querySelector(`[data-act=${a}]`);
    const scr = q('scr'), pfl = q('pfl'), sync = q('sync'), cue = q('cue'), play = q('play');
    scr.hidden = true; D.appendChild(scr);                       // (the SOURCE / Harmonic Match button lives in the centre of the jog pad; the element stays for the app)
    // the monitor (headphone) button with its green light
    pfl.innerHTML = ICON_PFL; pfl.classList.add('hbtn', 'round', 'mon'); pfl.title = 'Monitor: cue this deck in the headphones'; cp(pfl, mx(100), 128, 26, 26); D.appendChild(pfl);
    { const l = html('i', 'mled g', D); cp(l, mx(100), 153, 8, 8); monLeds.push(l); }
    // the small control buttons (every one is also a hardware button: data-hc is the control id)
    const mk = (txt, key, x, y, w, h, title, cls = '', abs = false) => { const b = html('button', 'hbtn ' + cls, D, txt); b.dataset.hc = hc(key); b.title = title; cp(b, abs ? x : mx(x), y, w, h); return b; };
    const press = (b, key, hold) => b.addEventListener('pointerdown', e => { e.preventDefault(); window.herc.button(hc(key), true); if (!hold) window.herc.button(hc(key), false); else { const up = () => { window.herc.button(hc(key), false); window.removeEventListener('pointerup', up); }; window.addEventListener('pointerup', up); } });
    // (on the right deck the pairs keep their reading order, back then forward / minus then plus: the photo is not mirrored there)
    press(mk('⏮', 'prev', m ? 437 : 38, 243, 24, 22, 'TRACK back: select the previous track in the playlist', 'sq', true), 'prev');
    press(mk('⏭', 'next', m ? 462 : 63, 243, 24, 22, 'TRACK forward: select the next track in the playlist', 'sq', true), 'next');
    press(mk('−', 'bendDn', m ? 388 : 86, 203, 26, 26, 'Pitch bend: slow the track down while you hold it', 'round', true), 'bendDn', true);
    press(mk('+', 'bendUp', m ? 414 : 112, 203, 26, 26, 'Pitch bend: speed the track up while you hold it', 'round', true), 'bendUp', true);
    { const lock = mk(m ? '▶' : '◀', 'beatlock', 190, 147, 24, 24, 'MASTER TEMPO / BEAT LOCK: scratch mode of the jog pad (the red light shows it is on)', 'tri'); press(lock, 'beatlock'); const l = html('i', 'mled r', D); cp(l, mx(168), 147, 8, 8); lockLeds.push(l); }
    const lay = mk(m ? '◀' : '▶', 'layer', 230, 88, 26, 24, 'LAYER: FX / CUE / LOOP (the three pad buttons 3 2 1 change meaning)', 'tri'); press(lay, 'layer');
    press(mk('LOAD', 'load', 216, 196, 56, 24, 'Load the selected track into this deck', 'big'), 'load');
    // pads 3 2 1 (the DOM pads are 1 2 3 4)
    const pads = D.querySelector('.pads'); pads.classList.add('padrow'); place(pads, 0, 0, DW, DH);
    [...pads.querySelectorAll('.pad')].forEach((p, n) => { if (n < 3) cp(p, mx([208, 181, 155][n]), [72, 68, 63][n], 24, 24); });
    // the layer lights (FX / CUE / LOOP) with their labels: the existing mode buttons, one per light
    const modes = D.querySelector('.modes'); modes.classList.add('modelist', 'layerlist'); place(modes, 0, 0, DW, DH);
    const LAY = { jump: ['FX', 178, 97, '#ff5a3a'], hot: ['CUE', 193, 108, '#ffd23a'], loop: ['LOOP', 189, 121, '#3ad25a'] };
    [...modes.querySelectorAll('button')].forEach(b => { const L = LAY[b.dataset.mode]; if (!L) { b.hidden = true; return; } b.textContent = L[0]; b.insertAdjacentHTML('beforeend', '<u></u>'); b.style.setProperty('--lc', L[3]); b.classList.add(m ? 'rside' : 'lside'); cp(b, mx(L[1]) + (m ? 12 : -12) * 0, L[2], 40, 12); b.style.left = (X(mx(L[1])) - (m ? 5 : 35)) + 'px'; });
    ['jump', 'hot', 'loop'].forEach(mm => modes.appendChild(modes.querySelector(`[data-mode="${mm}"]`)));   // FX, CUE, LOOP (the order printed on the console)
    // CUE and PLAY / PAUSE (big), AUTO BEAT (sync)
    cue.classList.add('hwb', 'bigcue'); cue.textContent = 'CUE'; cp(cue, m ? 443 : 50, 298, 52, 62); D.appendChild(cue);
    play.classList.add('hwb', 'bigplay', 'play'); play.innerHTML = '<svg viewBox="0 0 40 24"><path d="M5 3 L19 12 L5 21 Z" fill="currentColor"/><rect x="24" y="4" width="4.6" height="16" fill="currentColor"/><rect x="32" y="4" width="4.6" height="16" fill="currentColor"/></svg>'; cp(play, m ? 430 : 68, 350, 66, 46); D.appendChild(play);
    sync.classList.add('hwb', 'autobeat'); sync.textContent = m ? '◀' : '▶'; sync.title = 'AUTO BEAT (sync): match the tempo and the beat of the other deck'; cp(sync, m ? 275 : 219, 243, 28, 26); D.appendChild(sync);
    row.remove();
    place(D.querySelector('.loopinfo'), X(mx(58)) - 40, Y(420) - 2, 80, 8);
    // the pitch fader (a vertical slider; top = -%, bottom = +%)
    const pitch = D.querySelector('.pitch'); pitch.classList.add('tempo'); place(pitch, X(mx(152)) - 14, Y(84), 28, 130 * S);
    [...pitch.children].forEach(c => { if (c.classList.contains('dim') || c.tagName === 'BUTTON') c.remove(); });
    pitch.querySelector('input').addEventListener('dblclick', () => ctl[`d${d.i}.pitch`].set(0));
    pitch.querySelector('input').title = 'Pitch (double-click: 0%). Top = -%, bottom = +%.';
    // the knobs of this channel
    for (const [id, x, y] of [['treble', 50, 72], ['mid', 50, 135], ['bass', 50, 198], ['vol', 100, 72]]) { const k = knobWrap(`d${d.i}.${id}`); mixer.appendChild(k); cp(k, mx(x), y, 38, 38); }
    { const g = knobWrap(`d${d.i}.gain`); mixer.appendChild(g); g.style.display = 'none'; }   // (the console has no gain knob: the control stays, hidden)
  }
  decks.forEach(layoutDeck);
  mixer.querySelector('h3').remove(); mixer.querySelector('.chs').remove();

  /* ---------------------------------------------------------------- the middle and the frame: joystick (filter), crossfader, browse, master, phones */
  { const g = knobWrap('headGain'); mixer.appendChild(g); g.style.display = 'none'; }   // (the joystick is the filter control)
  for (const [id, x, y] of [['master', 398, 17], ['headMix', 452, 17]]) { const k = knobWrap(id); mixer.appendChild(k); cp(k, x - 0, y, 26, 26); k.classList.add('topk'); }
  // the joystick: a black ball you drag left / right (filter: left = low-pass, right = high-pass); it springs back to the centre when released
  const stick = html('div', 'stick', mixer); stick.id = 'stick'; stick.title = 'JOYSTICK = the DJ filter: drag left (low-pass) / right (high-pass); let go and it returns to the centre. Works on the master, on any channel.'; cp(stick, 247, 143, 76, 76);
  const ball = html('i', '', stick);
  { const RMAX = 17; let drag = null, back = 0;
    const draw = () => { const v = (+ctl.headGain.el.value - 0.5) * 2; ball.style.transform = `translate(${(v * RMAX).toFixed(1)}px, 0)`; };
    const o2 = ctl.headGain.set; ctl.headGain.set = v => { o2(v); draw(); };
    const putX = dx => ctl.headGain.set(0.5 + clamp(dx / RMAX, -1, 1) / 2);
    stick.addEventListener('pointerdown', e => { try { stick.setPointerCapture(e.pointerId); } catch {} cancelAnimationFrame(back); drag = { x: e.clientX, v: (+ctl.headGain.el.value - 0.5) * 2 * RMAX }; e.preventDefault(); });
    stick.addEventListener('pointermove', e => { if (drag) putX(drag.v + (e.clientX - drag.x) / K); });
    const release = () => { if (!drag) return; drag = null; const spring = () => { const v = +ctl.headGain.el.value - 0.5; if (Math.abs(v) < 0.01) { ctl.headGain.set(0.5); return; } ctl.headGain.set(0.5 + v * 0.7); back = requestAnimationFrame(spring); }; spring(); };
    stick.addEventListener('pointerup', release); stick.addEventListener('pointercancel', release);
    stick.addEventListener('dblclick', () => ctl.headGain.set(0.5));
    draw(); }
  // browse wheel (on the frame, top left) and the hidden LOAD 1 / LOAD 2 (the console has LOAD per deck)
  const bk = html('div', 'bk', mixer); bk.id = 'browseKnob'; bk.tabIndex = 0; bk.setAttribute('role', 'slider'); bk.title = 'Browse: turn (drag or scroll) to move through the playlist, press to load into the free deck'; cp(bk, 62, 10, 34, 34);
  bk.innerHTML = '<svg viewBox="0 0 80 80"><circle class="bk-ring" cx="40" cy="40" r="37"/><circle class="bk-body" cx="40" cy="40" r="32"/><g id="bkRot"><circle class="bk-rib" cx="40" cy="40" r="28.5"/><circle class="bk-rib2" cx="40" cy="40" r="28.5"/><circle class="bk-cap" cx="40" cy="40" r="24"/></g><circle class="bk-shine" cx="40" cy="40" r="24"/></svg>';
  for (const [id, txt] of [['cLoadA', '1'], ['cLoadB', '2']]) { const b = html('button', 'loadbtn', mixer, txt); b.id = id; b.hidden = true; b.setAttribute('aria-label', 'LOAD ' + txt); }
  // the crossfader
  const xf = document.getElementById('xf'), xw = html('div', 'xwrap', mixer); place(xw, X(247) - 100 * SX, Y(370) - 15, 200 * SX, 30); xw.appendChild(xf); xf.classList.add('xfade'); html('div', 'xmid', xw);
  xf.addEventListener('dblclick', () => ctl.xf.set(0));
  mixer.querySelectorAll(':scope > div:not([class])').forEach(e => { if (/CROSSFADER/.test(e.textContent)) e.remove(); });
  [...mixer.children].forEach(e => { if (e.tagName === 'DIV' && !e.className && /CROSSFADER/.test(e.textContent)) e.remove(); });
  mixer.querySelector('.mrow') && mixer.querySelector('.mrow').remove();

  document.getElementById('cLoadA').onclick = () => cur() ? loadToDeck(decks[0], cur()) : toast('The playlist is empty');
  document.getElementById('cLoadB').onclick = () => cur() ? loadToDeck(decks[1], cur()) : toast('The playlist is empty');
  let bkAngle = 0, bkDrag = null, bkAcc = 0;
  const bkStep = n => { moveSel(n); bkAngle += n * 14; document.getElementById('bkRot').setAttribute('transform', `rotate(${bkAngle} 40 40)`); };
  bk.addEventListener('pointerdown', e => { try { bk.setPointerCapture(e.pointerId); } catch {} bkDrag = { y: e.clientY, moved: false }; });
  bk.addEventListener('pointermove', e => { if (!bkDrag) return; bkAcc += (bkDrag.y - e.clientY) / K; bkDrag.y = e.clientY; if (Math.abs(bkAcc) > 2) bkDrag.moved = true; while (Math.abs(bkAcc) >= 8) { bkStep(bkAcc > 0 ? -1 : 1); bkAcc -= Math.sign(bkAcc) * 8; } });
  bk.addEventListener('pointerup', () => { const moved = bkDrag && bkDrag.moved; bkDrag = null; bkAcc = 0; if (!moved && cur()) loadToDeck(decks.find(x => !x.playing) || decks[0], cur()); });
  bk.addEventListener('wheel', e => { e.preventDefault(); bkStep(e.deltaY > 0 ? 1 : -1); }, { passive: false });
  bk.addEventListener('keydown', e => { if (e.key === 'ArrowDown') bkStep(1); else if (e.key === 'ArrowUp') bkStep(-1); else if (e.key === 'Enter' && cur()) loadToDeck(decks.find(x => !x.playing) || decks[0], cur()); });

  /* ---------------------------------------------------------------- animation: the pads turn, the lights follow the decks */
  let last = performance.now(), slow = 0;
  const benders = decks.map(d => [deckEls[d.i].querySelector(`[data-hc="d${d.i}.bendDn"]`), deckEls[d.i].querySelector(`[data-hc="d${d.i}.bendUp"]`)]);
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!window.__djHidden) {
      for (const j of jogs) {
        const d = j.d;
        if (d.buf && d.playing) j.angle += 200 * d.effRate * dt;            // 33 1/3 rpm = 200 degrees per second
        j.angle += j.offset; j.offset = 0;
        j.rot.setAttribute('transform', `rotate(${(j.angle % 360).toFixed(2)} 110 110)`);
        j.prog.setAttribute('stroke-dashoffset', (j.C * (1 - (d.buf && d.dur ? clamp(d.pos() / d.dur, 0, 1) : 0))).toFixed(1));
        j.hub.classList.toggle('active', !!(window.harmonic && window.harmonic.hm.sourceMode === String(d.i)));
        lockLeds[d.i].classList.toggle('lit', !!d.scratch); monLeds[d.i].classList.toggle('lit', !!d.pflOn);
        benders[d.i][0].classList.toggle('lit', d.bendBtn < 0); benders[d.i][1].classList.toggle('lit', d.bendBtn > 0);
      }
      if ((slow += dt) > 0.25) {
        slow = 0;
        for (const j of jogs) { const d = j.d, f = d.feat; j.info.textContent = !d.buf ? 'Deck ' + (d.i + 1) : (f && f.key ? f.key.camelot + (f.key.confidence < 0.35 ? '?' : '') + ' · ' : '') + (d.an && d.an.bpm ? (d.an.bpm * d.rate).toFixed(1) : '–'); }
        const it = cur(); bk.title = 'Browse: turn to move through the playlist, press to load into the free deck. Selected: ' + (it ? trackLabel(it) : '–');
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  document.querySelectorAll('.wavebox .tm').forEach(el => { el.style.cursor = 'pointer'; el.title = 'Click: switch between elapsed and remaining time'; el.addEventListener('click', () => { lsSet('timeRemaining', !lsGet('timeRemaining', false)); lastUi.forEach(u => { u.tm = null; }); }); });
  window.consoleSkin = { jogs, knobs, bkStep, lights, setLights, stage, get scale() { return K; }, boardW: 708, designH: DH, panelTop: 22, panelH: 414 };
})();
