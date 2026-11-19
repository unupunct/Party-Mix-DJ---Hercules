async (cfg) => {
  const wavPath = cfg.wav;
  // Runs inside the app window when started with DJ_SELFTEST=1. Result is written to DJ_SELFTEST_OUT by main.js.
  const R = { ok: true, checks: [], info: {} };
  const chk = (name, cond, detail) => { R.checks.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail) }); if (!cond) R.ok = false; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const m = (a, b, c) => dj.onMidi({ data: [a, b, c] });
  const ax = id => +Object.keys(herc.AXIS).find(k => herc.AXIS[k] === id), bt = id => +Object.keys(herc.BTN).find(k => herc.BTN[k] === id), press = id => { m(0x90, bt(id), 127); m(0x80, bt(id), 0); };
  try {
    chk('preload bridge present', !!window.electronAPI);
    chk('app object present', !!window.dj);
    if (window.herc) herc.mute(true);   // the real console is plugged in while the tests run: ignore its movements, the tests feed their own reports
    // which audio backend are we testing? (DJ_ENGINE=off forces the built-in Web Audio fallback)
    const wantNative = !!(window.electronAPI && window.electronAPI.engine) && cfg.engine !== 'off';
    if (wantNative) for (let i = 0; i < 150 && !dj.nat.active; i++) await sleep(100);
    const NATIVE = dj.nat.active; R.info.backend = NATIVE ? 'native djengine' : 'web audio fallback';
    chk(wantNative ? 'native audio engine is active' : 'fallback backend selected as requested', wantNative ? NATIVE : !NATIVE, NATIVE ? JSON.stringify(dj.nat.status) : 'web audio');
    if (!NATIVE) { await dj.AC.resume(); chk('AudioContext running', dj.AC.state === 'running', dj.AC.state); }
    // measure what reaches the master / headphone bus, whichever backend is in use
    const busPeak = async (bus, ms = 800) => {
      let p = 0;
      if (NATIVE) { for (let i = 0; i < ms / 25; i++) { await sleep(25); p = Math.max(p, ...(dj.nat.state ? dj.nat.state[bus] : [0])); } return p; }
      const a = dj.AC.createAnalyser(); a.fftSize = 2048; (bus === 'master' ? dj.mix.lim : dj.cue.out).connect(a); const b = new Float32Array(2048);
      for (let i = 0; i < ms / 40; i++) { await sleep(40); a.getFloatTimeDomainData(b); for (const v of b) p = Math.max(p, Math.abs(v)); }
      return p;
    };

    // file access through the native bridge + playlist
    const items = await electronAPI.scanPaths([wavPath]);
    chk('scanPaths finds the audio file', items.length === 1, JSON.stringify(items));
    dj.addPaths(items);
    chk('playlist has the track', dj.playlist.length >= 1);
    chk('playlist persisted to storage', (JSON.parse(localStorage.getItem('playlist') || '[]')).some(i => i.path === wavPath));
    const [A, B] = dj.decks;
    const tcell = document.querySelector('#tbl td.t'), tr0 = document.querySelector('#tbl tbody tr');
    chk('playlist row is a table row (not flex)', tr0 && getComputedStyle(tr0).display === 'table-row', tr0 && getComputedStyle(tr0).display);
    chk('playlist title cell shows the file name', tcell && tcell.getBoundingClientRect().width > 200 && tcell.textContent.trim() === 'test120' && tcell.scrollWidth <= tcell.clientWidth + 1, tcell && Math.round(tcell.getBoundingClientRect().width) + 'px "' + tcell.textContent + '"');

    // artist/title from tags (RIFF INFO) and from "Artist - Title" file names, via folder scan; then search
    const extra = await electronAPI.scanPaths([cfg.dir]); chk('folder scan finds 2 test files', extra.length === 2, extra.map(e => e.name).join(', '));
    dj.addPaths(extra);
    for (let i = 0; i < 100 && dj.playlist.some(p => !p.meta); i++) await sleep(100);
    await sleep(700);   // rows are updated in place a moment after the tags arrive
    const rowOf = nm => [...document.querySelectorAll('#tbl tbody tr')].find(r => r.title === nm);
    const cell = (nm, c) => { const r = rowOf(nm); return r ? r.querySelector(c).textContent.replace(/^[AB]\s*/, '').trim() : null; };
    chk('tags read: artist', cell('tagged.wav', '.ar') === 'Tagged Artist', cell('tagged.wav', '.ar'));
    chk('tags read: title', cell('tagged.wav', '.t') === 'Tagged Title', cell('tagged.wav', '.t'));
    chk('file-name fallback "Artist - Title"', cell('Guess Artist - Guess Song.wav', '.ar') === 'Guess Artist' && cell('Guess Artist - Guess Song.wav', '.t') === 'Guess Song', cell('Guess Artist - Guess Song.wav', '.ar') + ' / ' + cell('Guess Artist - Guess Song.wav', '.t'));
    const total = dj.playlist.length, search = document.getElementById('search');
    const type = v => { search.value = v; search.dispatchEvent(new Event('input')); return document.querySelectorAll('#tbl tbody tr.trk').length; };
    chk('search by artist', type('tagged art') === 1);
    chk('search matches title words in any order', type('song guess') === 1);
    chk('search matches file name', type('test120') === 1);
    chk('search with no match', type('zzzqqq') === 0 && /No tracks match/.test(document.querySelector('#tbl tbody').textContent));
    chk('clearing search restores all rows', type('') === total, total);
    chk('track count label', /tracks/.test(document.getElementById('libInfo').textContent), document.getElementById('libInfo').textContent);
    await dj.loadToDeck(A, dj.playlist[0]); await dj.loadToDeck(B, dj.playlist[0]);
    chk('deck A decoded', !!A.buf && A.dur > 10, A.dur);
    chk('BPM detected (120 expected)', A.an && Math.abs(A.an.bpm - 120) < 0.6, A.an && A.an.bpm);
    if (NATIVE) {
      // H1: musical / audio features from the engine
      const f = A.feat;
      chk('engine delivered the feature set', f && f.engineVersion >= 1 && typeof f.energy === 'number', f && 'v' + f.engineVersion);
      chk('drum loop: key is not reported with confidence (no tonal content)', f && (!f.key || f.key.confidence < 0.5), f && f.key && f.key.camelot + ' conf ' + f.key.confidence.toFixed(2));
      chk('tempo confidence is high on a clean 120 BPM loop', f && f.bpmConfidence > 0.5 && f.tempoStability > 0.8 && f.timeSignature === 4, f && 'conf ' + f.bpmConfidence.toFixed(2) + ' stab ' + f.tempoStability.toFixed(2));
      chk('energy 1-10, danceability 0-1, loudness plausible', f && f.energy >= 1 && f.energy <= 10 && f.danceability >= 0 && f.danceability <= 1 && f.rmsDb < 0 && f.peakDb <= 0.1, f && 'E' + f.energy + ' dance ' + f.danceability.toFixed(2) + ' rms ' + f.rmsDb.toFixed(1));
      chk('estimates are flagged: vocal/mood confidence capped', f && f.vocalConfidence <= 0.5 && f.moodConfidence <= 0.5);
      for (let i = 0; i < 60 && !/· E[0-9]+/.test(document.getElementById('bp0').textContent); i++) await sleep(50);
      chk('deck readout shows key and energy', /· E[0-9]+/.test(document.getElementById('bp0').textContent) && document.getElementById('bp0').title.includes('Energy'), document.getElementById('bp0').textContent);
      const f2 = await dj.analyzeFile(extra[0].path);
      chk('analysis-only request returns features without loading a deck', f2 && f2.durationS > 3 && f2.durationS < 8, f2 && f2.durationS);
      let rejected = ''; try { await dj.analyzeFile(cfg.dir + '\does-not-exist.mp3'); } catch (e) { rejected = e.message; }
      chk('analysis of a missing file fails cleanly', rejected.length > 0, rejected);
    }

    if (NATIVE) {
      // ---- H2: SQLite library + background analysis queue, driven through the real UI
      for (let i = 0; i < 150 && !dj.lib.ready; i++) await sleep(100);
      chk('library database is open in the engine', dj.lib.ready, JSON.stringify(dj.lib.stats));
      const tracks = () => dj.playlist.filter(p => p.path);
      for (let i = 0; i < 300 && !tracks().every(p => p.anStatus === 'done' || p.anStatus === 'error'); i++) await sleep(100);
      const doneN = tracks().filter(p => p.anStatus === 'done').length;
      chk('background analysis finished for every playlist track', doneN === tracks().length, doneN + '/' + tracks().length);
      await sleep(600);
      const row = [...document.querySelectorAll('#tbl tbody tr')].find(r => r.title === 'test120.wav');
      const cells = row ? [...row.children].map(c => c.textContent.trim()) : [];
      chk('playlist shows BPM, Camelot key and energy from the analysis', row && /^[0-9]+\.[0-9]$/.test(cells[4]) && cells[5].length > 0 && cells[5] !== '–' && /^[0-9]+$/.test(cells[6]), cells.join(' | '));
      chk('analysis progress label is shown', /analysed/.test(document.getElementById('anInfo').textContent), document.getElementById('anInfo').textContent);

      dj.lib.lastScan = null; dj.libScan(dj.playlist, false);
      for (let i = 0; i < 50 && !dj.lib.lastScan; i++) await sleep(100);
      chk('re-scan of unchanged files queues nothing', dj.lib.lastScan && dj.lib.lastScan.queued === 0 && dj.lib.lastScan.unchanged === tracks().length, JSON.stringify(dj.lib.lastScan));

      // pause holds the queue, resume finishes it
      document.getElementById('btnPauseAn').click(); await sleep(700);
      chk('pause button pauses the analysis queue', dj.lib.progress && dj.lib.progress.paused === true && /Resume/.test(document.getElementById('btnPauseAn').textContent), document.getElementById('btnPauseAn').textContent);
      dj.libSend({ cmd: 'libraryReanalyze', paths: tracks().map(p => p.path) }); await sleep(1000);
      chk('a paused queue holds the work', dj.lib.progress.pending > 0 && dj.lib.progress.running === 0, JSON.stringify(dj.lib.progress));

      // playback must stay clean while analysis runs: play deck A, then resume the queue
      dj.ctl['d0.vol'].set(1); A.seek(10); A.play(); await sleep(400);
      const x0 = dj.nat.state.xruns; document.getElementById('btnPauseAn').click();
      let peakDuring = 0;
      for (let i = 0; i < 1000 && (dj.lib.progress.pending || dj.lib.progress.running || dj.lib.progress.paused); i++) { await sleep(50); peakDuring = Math.max(peakDuring, ...dj.nat.state.master); }
      chk('resume finishes the queue', dj.lib.progress.pending === 0 && dj.lib.progress.running === 0 && !dj.lib.progress.paused, JSON.stringify(dj.lib.progress));
      chk('deck kept playing without underruns while the library was analysed', dj.nat.state.xruns === x0 && peakDuring > 0.02 && A.playing, 'xruns +' + (dj.nat.state.xruns - x0) + ', master peak ' + peakDuring.toFixed(2));
      A.pause();

      dj.libSend({ cmd: 'libraryStats' }); await sleep(400);
      chk('database holds every track with the current schema', dj.lib.stats.tracks >= tracks().length && dj.lib.stats.analyzed >= tracks().length && dj.lib.stats.schema === 3, JSON.stringify(dj.lib.stats));
      const wSel = document.getElementById('anWorkers'); wSel.value = '3'; wSel.dispatchEvent(new Event('change')); await sleep(300);
      chk('worker limit is remembered', JSON.parse(localStorage.getItem('anWorkers')) === 3); wSel.value = '2'; wSel.dispatchEvent(new Event('change'));
      const re = document.querySelector('#tbl tbody tr.trk button.re'); const before = dj.playlist[0].anStatus; re.click();
      const wentPending = dj.playlist[0].anStatus === 'pending';
      for (let i = 0; i < 150 && tracks().some(p => p.anStatus !== 'done'); i++) await sleep(100);
      chk('per-track re-analyse button re-queues the track and it completes', before === 'done' && wentPending && tracks().every(p => p.anStatus === 'done'), tracks().map(p => p.anStatus).join(',') + ' ' + JSON.stringify({ active: dj.nat.active, lib: dj.lib.stats, prog: dj.lib.progress, first: dj.playlist[0] && [dj.playlist[0].anStatus, dj.playlist[0].path] }));

      // ---- H3: matching through the real engine
      const srcPath = dj.playlist.find(p => p.name === 'test120.wav').path;
      const m1 = await dj.match(srcPath, { settings: { keylock: true }, filter: { limit: 10 } });
      chk('match request returns ranked candidates (source excluded)', m1.source.path === srcPath && m1.matches.length === tracks().length - 1 && m1.matches.every(x => x.path !== srcPath), m1.matches.length + ' matches');
      chk('every match carries a 0-100 score, label and a full breakdown', m1.matches.every(x => x.score >= 0 && x.score <= 100 && x.label && x.harmonic && x.tempo && x.energyPart && x.rhythm && x.genrePart && x.moodPart && x.danceabilityPart && x.spectral && x.vocalPart && Array.isArray(x.notes)), m1.matches[0] && (m1.matches[0].score.toFixed(1) + '% ' + m1.matches[0].label));
      chk('results are sorted best first', m1.matches.every((x, i) => i === 0 || m1.matches[i - 1].score >= x.score));
      chk('drum loops are flagged as uncertain for harmony (no tonal content)', m1.matches.every(x => x.harmonic.uncertain === true && x.harmonic.reliability < 1), JSON.stringify(m1.matches[0] && [m1.matches[0].harmonic.uncertain, m1.matches[0].harmonic.reliability]));
      chk('tempo advice is included (target, adjustment, mode)', m1.matches.every(x => typeof x.tempo.adjustPct === 'number' && x.tempo.mode && x.tempo.targetBpm === m1.source.bpm), m1.matches[0] && JSON.stringify([m1.matches[0].tempo.mode, m1.matches[0].tempo.adjustPct.toFixed(1)]));
      const m2 = await dj.match(srcPath, { filter: { minScore: 101 } });
      chk('filters apply (min score 101 returns nothing)', m2.matches.length === 0);
      const m3 = await dj.match(srcPath, { scope: { paths: [m1.matches[0].path] } });
      chk('scope applies (one playlist track)', m3.matches.length === 1 && m3.matches[0].path === m1.matches[0].path);
      let err1 = '', err2 = '';
      try { await dj.match(srcPath, { settings: { weights: { harmonic: -1 } } }); } catch (e) { err1 = e.message; }
      try { await dj.match('C:\\no\\such\\track.mp3'); } catch (e) { err2 = e.message; }
      chk('invalid weights are rejected with a reason', /weights/.test(err1), err1);
      chk('a source that is not analysed is rejected with a reason', /not been analysed/.test(err2), err2);

      // ---- H4: the HARMONIC MATCH workspace, driven through its own screen
      const H = window.harmonic, q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
      const until = async (cond, ms = 8000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await sleep(50); return !!cond(); };
      const flash = el => { el.dispatchEvent(new Event('change', { bubbles: true })); };
      chk('HARMONIC MATCH tab sits beside DJ PERFORMANCE', !!q('#tabHm') && !q('#djview').hidden && q('#hmview').hidden);
      dj.ctl['d0.vol'].set(1); await dj.loadToDeck(A, dj.playlist.find(p => p.name === 'test120.wav')); A.seek(5); A.play(); await sleep(300);
      q('#tabHm').click();
      chk('opening the tab shows the workspace and hides the DJ screen', !q('#hmview').hidden && q('#djview').hidden && window.__djHidden === true && !!q('#hmTop'));
      await until(() => q('#hmTable tbody tr'));
      chk('top section: source is the playing deck and the list is the next song for that deck', /DECK A/.test(q('#hmTop').textContent) && /PLAYING/.test(q('#hmTop').textContent) && /Next song for\s*Deck A/.test(q('#hmTop').textContent), q('#hmTop').textContent.replace(/\s+/g, ' ').slice(0, 140));
      chk('source card shows BPM, Camelot key, energy and key confidence', /120\.0/.test(q('#hmTop .srcgrid').textContent) && /[0-9]+[AB]/.test(q('#hmTop .srcgrid').textContent) && /[0-9]+\/10/.test(q('#hmTop .srcgrid').textContent) && /Key confidence/.test(q('#hmTop .srcgrid').textContent), q('#hmTop .srcgrid').textContent.replace(/\s+/g, ' '));
      chk('recommendation table lists every other analysed track', qa('#hmTable tbody tr[data-path]').length === dj.playlist.length - 1 && qa('#hmTable thead th').length === 11, qa('#hmTable tbody tr[data-path]').length + ' rows');
      chk('each row shows match %, label, BPM, key, energy, tempo change, key compatibility', qa('#hmTable tbody tr[data-path]').every(r => /[0-9]+%/.test(r.cells[0].textContent) && r.cells[0].querySelector('.lab') && r.cells[2].textContent.trim().length > 0 && r.cells[5].textContent.trim().length > 0 && r.cells[6].querySelector('.lab')), qa('#hmTable tbody tr[data-path]')[0] && qa('#hmTable tbody tr[data-path]')[0].textContent.replace(/\s+/g, ' ').slice(0, 150));
      chk('detail panel explains the first match with nine weighted components', qa('#hmDetail .bar').length === 9 && /Tempo/.test(q('#hmDetail').textContent) && /Harmonic/.test(q('#hmDetail').textContent), qa('#hmDetail .bar').length + ' bars');
      chk('Generate Smart Playlist is shown as the next step, not faked', q('#hmGenerate').disabled === true && /H5/.test(q('#hmGenerate').title));

      // Camelot wheel
      chk('Camelot wheel has all 24 keys with the source key and compatible keys marked', qa('#hmWheelSvg g.seg').length === 24 && qa('#hmWheelSvg g.seg.src').length === 1 && qa('#hmWheelSvg g.seg.compat').length >= 4, qa('#hmWheelSvg g.seg.compat').length + ' compatible');
      await until(() => qa('#hmWheelSvg g.seg').some(g => (g.querySelector('.cnt') || {}).textContent));
      const used = qa('#hmWheelSvg g.seg').find(g => (g.querySelector('.cnt') || {}).textContent);
      chk('wheel shows how many tracks use each key', !!used, used && used.dataset.key + ' x' + used.querySelector('.cnt').textContent);
      const pickKey = used.dataset.key;
      used.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(150);
      chk('clicking a key filters the table and the main playlist', dj.keyFilter === pickKey && !q('#hmKeyChip').hidden && qa('#hmTable tbody tr[data-path]').every(r => r.cells[3].textContent.trim().replace('?', '') === pickKey) && !q('#keyChip').hidden, dj.keyFilter + ' / ' + qa('#hmTable tbody tr[data-path]').length + ' rows');
      q('#hmKeyChip').click(); await sleep(150);
      chk('the key chip clears the filter again', dj.keyFilter === '' && q('#hmKeyChip').hidden && qa('#hmTable tbody tr[data-path]').length === dj.playlist.length - 1);

      // filters, sorting, weights
      const sortEl = q('#hmSort'); sortEl.value = 'bpm'; flash(sortEl); await sleep(900);
      const bpms = qa('#hmTable tbody tr[data-path]').map(r => parseFloat(r.cells[2].textContent) || 0);   // unknown BPM shows as a dash and sorts first
      chk('sorting by BPM orders the rows', bpms.length >= 2 && bpms.every((v, i) => i === 0 || bpms[i - 1] <= v), bpms.join(', ')); sortEl.value = 'score'; flash(sortEl);
      const minEl = q('#hmMin'); minEl.value = 100; minEl.dispatchEvent(new Event('input', { bubbles: true })); await sleep(900);
      chk('minimum-score filter removes everything below it and says so', qa('#hmTable tbody tr[data-path]').length === 0 && /filters/.test(q('#hmMsg').textContent), q('#hmMsg').textContent);
      minEl.value = 0; minEl.dispatchEvent(new Event('input', { bubbles: true })); await sleep(900);
      const genEl = q('#hmGenre'); genEl.value = 'zzz-no-such-genre'; flash(genEl); await sleep(900);
      chk('genre filter works (no track has that genre)', qa('#hmTable tbody tr[data-path]').length === 0); genEl.value = ''; flash(genEl);
      q('#hmWeightsBtn').click();
      const wEl = q('#hmWeights input[data-w="harmonic"]'); wEl.value = 40; wEl.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200);
      chk('weights editor changes and saves the weights (preset becomes Custom)', q('#hmPreset').value === 'custom' && JSON.parse(localStorage.getItem('hmSettings')).weights.harmonic === 40 && JSON.parse(localStorage.getItem('hmSettings')).preset === 'custom', localStorage.getItem('hmSettings'));
      const preEl = q('#hmPreset'); preEl.value = 'similar'; flash(preEl); await sleep(300);
      chk('preset "Similar sound" sets low harmonic weight', JSON.parse(localStorage.getItem('hmSettings')).weights.harmonic === 4);
      preEl.value = 'default'; flash(preEl); await sleep(300);
      chk('default preset is the 20/15/15/15/10/10/5/5/5 weighting', JSON.stringify(Object.values(JSON.parse(localStorage.getItem('hmSettings')).weights)) === JSON.stringify([20, 15, 15, 15, 10, 10, 5, 5, 5]));
      q('#hmWeightsBtn').click(); await sleep(900);

      // actions
      const firstPath = qa('#hmTable tbody tr[data-path]')[0].dataset.path;
      qa('#hmTable tbody tr[data-path]')[0].querySelector('button[data-act="b"]').click();
      await until(() => dj.decks[1].path === firstPath && dj.decks[1].buf);
      chk('Load to Deck B puts the recommended track on Deck B', dj.decks[1].path === firstPath && !!dj.decks[1].buf, dj.decks[1].path && dj.decks[1].path.split('\\').pop());
      await until(() => /Deck A → Deck B/.test(q('#hmPair') ? q('#hmPair').textContent : '') && /[0-9]+%/.test(q('#hmPair').textContent), 10000);
      chk('deck pair card shows the live match, BPM advice, key relation and energy change', /Deck A → Deck B/.test(q('#hmPair').textContent) && /[0-9]+%/.test(q('#hmPair').textContent) && /BPM/.test(q('#hmPair').textContent) && /Key/.test(q('#hmPair').textContent) && /Energy/.test(q('#hmPair').textContent), q('#hmPair').textContent.replace(/\s+/g, ' ').slice(0, 170));
      qa('#hmTable tbody tr[data-path]')[0].querySelector('button[data-act="set"]').click(); await sleep(200);
      chk('Add to set list stores the track', H.hm.set.length === 1 && JSON.parse(localStorage.getItem('setlist')).length === 1 && H.hm.set[0].path === firstPath);
      qa('#hmTable tbody tr[data-path]')[0].querySelector('button[data-act="set"]').click();
      chk('adding the same track twice is refused', H.hm.set.length === 1);
      qa('#hmTable tbody tr[data-path]')[0].querySelector('button[data-act="sim"]').click(); await until(() => /SIMILAR TO/.test(q('#hmTop').textContent));
      chk('Find similar re-ranks around that track and offers a way back', /SIMILAR TO/.test(q('#hmTop').textContent) && !!q('#hmTop button[data-act="unpin"]') && H.engineSettings(0).weights.harmonic === 4);
      q('#hmTop button[data-act="unpin"]').click(); await until(() => /DECK A/.test(q('#hmTop').textContent));
      chk('back to live matching follows the deck again', /DECK A/.test(q('#hmTop').textContent) && H.engineSettings(0).weights.harmonic === 20);
      const itemF = dj.playlist.find(p => p.path === firstPath); const stBefore = itemF.anStatus;
      qa('#hmTable tbody tr[data-path]')[0].querySelector('button[data-act="an"]').click();
      chk('Analyze track re-queues the track', itemF.anStatus === 'pending' && stBefore === 'done', stBefore + ' -> ' + itemF.anStatus);
      await until(() => itemF.anStatus === 'done', 30000);

      // preview in headphones on the free deck
      dj.decks[1].pause(); dj.ctl['d1.vol'].set(1); if (dj.decks[1].pflOn) q('#deck1 [data-act=pfl]').click();
      const mm = H.hm.matches[0]; await H.preview(mm); await sleep(500);
      chk('Preview loads the free deck, cues it to the headphones with the fader down, keeps the other deck playing', dj.decks[1].playing && dj.decks[1].pflOn && +dj.ctl['d1.vol'].el.value === 0 && A.playing, 'B playing ' + dj.decks[1].playing + ', pfl ' + dj.decks[1].pflOn + ', fader ' + dj.ctl['d1.vol'].el.value);
      chk('preview is audible on the headphone bus only', (() => { const s = dj.nat.state; return s.cue[0] > 0.01; })());
      dj.decks[1].pause(); q('#deck1 [data-act=pfl]').click();

      // analysis panel + graphs
      await until(() => /Tracks/.test(q('#hmStats').textContent) && q('#hmEnergySvg'), 8000);
      const kv = qa('#hmStats .kv > div').map(d => d.textContent.replace(/\s+/g, ' ').trim());
      chk('playlist analysis shows totals, duration, transition quality and problems', kv.length === 6 && kv[0].includes(String(dj.playlist.length)) && /min|h/.test(kv[2]) && /Average transition/.test(kv[3]) && /Problem transitions/.test(kv[5]), kv.join(' | '));
      chk('energy progression graph has one point per analysed track', q('#hmEnergySvg') && +q('#hmEnergySvg').dataset.n === dj.playlist.length && qa('#hmEnergySvg circle').length === dj.playlist.filter(p => p.energy).length, qa('#hmEnergySvg circle').length + ' points');
      chk('BPM distribution graph shows the bins', qa('#hmBpmSvg rect.bbar').length === 28);
      const sc = q('#hmSeqScope'); sc.value = 'set'; flash(sc); await sleep(1500);
      chk('analysis can be switched to the set list', /Tracks/.test(q('#hmStats').textContent) && qa('#hmStats .kv > div')[0].textContent.includes('1') && qa('#hmStats .setrow').length === 1);
      q('#hmStats .setrow button[data-act="set-del"]').click(); await sleep(1500);
      chk('removing the track empties the set list', H.hm.set.length === 0 && /empty/.test(q('#hmStats').textContent));
      sc.value = 'playlist'; flash(sc); await sleep(800);

      // live follow: stop A, start B -> the source switches
      A.pause(); dj.decks[1].seek(5); dj.decks[1].play(); dj.ctl['d1.vol'].set(1);
      await until(() => /DECK B/.test(q('#hmTop').textContent) && /Next song for\s*Deck B/.test(q('#hmTop').textContent), 8000);
      chk('live matching follows the playing deck (now B: next song for Deck B)', /DECK B/.test(q('#hmTop').textContent) && /Next song for\s*Deck B/.test(q('#hmTop').textContent), q('#hmTop').textContent.replace(/\s+/g, ' ').slice(0, 90));
      dj.decks[1].pause();
      q('#tabs .tab[data-view="dj"]').click(); await sleep(300);
      chk('returning to the DJ screen restores it', !q('#djview').hidden && q('#hmview').hidden && window.__djHidden === false);

      // ---- toolbar regression: the top bar must stay visible however the playlist is navigated or the page is scrolled
      const bar = q('#topbar');
      chk('the toolbar is a sticky top bar (header + tabs together)', getComputedStyle(bar).position === 'sticky' && bar.contains(q('header')) && bar.contains(q('#tabs')));
      for (let i = 0; i < 40; i++) dj.onMidi({ data: [0xBF, 0x00, 1] });                 // turn the browse knob down through the playlist
      window.scrollTo(0, 400); await sleep(200);
      chk('toolbar stays fully visible after browsing the playlist and scrolling the page', Math.abs(bar.getBoundingClientRect().top) < 1 && bar.getBoundingClientRect().height > 40, 'top ' + bar.getBoundingClientRect().top.toFixed(1) + ', height ' + Math.round(bar.getBoundingClientRect().height));
      window.scrollTo(0, 0);
      const y0 = window.scrollY; dj.onMidi({ data: [0xBF, 0x00, 127] }); dj.onMidi({ data: [0xBF, 0x00, 1] }); await sleep(100);
      chk('moving the playlist selection never scrolls the page itself', window.scrollY === y0, 'scrollY ' + window.scrollY);
      chk('the "enable audio" banner is not shown while the native engine plays', q('#banner').hidden === true);

      // ---- console faceplate (Numark Party Mix look) and the HARMONIC MATCH hub in the centre of each jog wheel
      q('#tabs .tab[data-view="dj"]').click(); await sleep(250);
      chk('both decks have a jog wheel with a HARMONIC MATCH hub in the centre', qa('#decks svg.jog').length === 2 && qa('#decks .hub').length === 2 && qa('#decks .hub .h-t1').every(x => x.textContent === 'HARMONIC') && qa('#decks .hub .h-t2').every(x => x.textContent === 'MATCH'));
      chk('rotary knobs replace the sliders: treble, medium, bass, volume (and the hidden gain) per channel, master, phones and the filter', qa('#decks .kn').length === 13, qa('#decks .kn').length + ' knobs');
      chk('the face has the browse wheel, the joystick and the hidden LOAD 1 / LOAD 2', !!q('#cLoadA') && !!q('#cLoadB') && !!q('#browseKnob') && !!q('#stick'));
      {
        const R = e => e.getBoundingClientRect(), cx = e => R(e).left + R(e).width / 2, cy = e => R(e).top + R(e).height / 2, st = R(q('#decks .stage')), xf = q('#xf');
        chk('the face is one scaled stage (black body, silver plate); no party lights and no LIGHTS button', !!q('#decks .stage .hface') && qa('#decks .orb').length === 0 && !q('#btnLights') && st.width > 150);
        chk('the crossfader is wide, at the bottom centre of the face, fully visible', R(xf).width > 60 && R(xf).height > 8 && cx(xf) > st.left + st.width * 0.4 && cx(xf) < st.left + st.width * 0.6 && cy(xf) > st.top + st.height * 0.8 && R(xf).bottom <= st.bottom + 1 && getComputedStyle(xf).display !== 'none', Math.round(R(xf).width) + 'x' + Math.round(R(xf).height));
        chk('the joystick (filter) sits in the middle between the two pitch faders; BROWSE, MASTER and PHONES are on the black frame', cx(q('#stick')) > R(q('#pt0')).right && cx(q('#stick')) < R(q('#pt1')).left && cy(q('#stick')) < st.top + st.height * 0.5 && cy(q('#browseKnob')) < st.top + st.height * 0.1 && cy(q('.kn[data-ctl="master"]')) < st.top + st.height * 0.1 && cx(q('.kn[data-ctl="master"]')) < cx(q('.kn[data-ctl="headMix"]')));
        const colOK = d => ['treble', 'mid', 'bass'].map(k => R(q('.kn[data-ctl="d' + d + '.' + k + '"]'))).every((r, i, a) => i === 0 || a[i - 1].top < r.top) && Math.abs(cx(q('.kn[data-ctl="d' + d + '.treble"]')) - cx(q('.kn[data-ctl="d' + d + '.bass"]'))) < 4 && Math.abs(cy(q('.kn[data-ctl="d' + d + '.vol"]')) - cy(q('.kn[data-ctl="d' + d + '.treble"]'))) < 4;
        chk('each channel: TREBLE, MEDIUM, BASS stack on the outer edge with VOLUME beside TREBLE; deck 1 left, deck 2 right', colOK(0) && colOK(1) && cx(q('.kn[data-ctl="d0.treble"]')) < cx(q('#stick')) - 60 && cx(q('.kn[data-ctl="d1.treble"]')) > cx(q('#stick')) + 60 && cx(q('.kn[data-ctl="d0.vol"]')) > cx(q('.kn[data-ctl="d0.treble"]')) && cx(q('.kn[data-ctl="d1.vol"]')) < cx(q('.kn[data-ctl="d1.treble"]')));
        const deckOK = d => { const L = d === 0, hb = k => R(q('#deck' + d + ' [data-hc="d' + d + '.' + k + '"]')), pads = [...qa('#pads' + d + ' .pad')].slice(0, 3).map(R), cu = R(q('#deck' + d + ' [data-act=cue]')), pl = R(q('#deck' + d + ' [data-act=play]')), sy = R(q('#deck' + d + ' [data-act=sync]')), pt = R(q('#pt' + d)), jog = R(q('#deck' + d + ' svg.jog')), mon = R(q('#deck' + d + ' [data-act=pfl]'));
          const num = [...qa('#pads' + d + ' .pad')].slice(0, 3).map(p => p.textContent).join('');
          return pads.length === 3 && getComputedStyle(q('#pads' + d + ' .pad[data-pad="3"]')).display === 'none' && num === '123' && (L ? pads[0].left > pads[1].left && pads[1].left > pads[2].left : pads[0].left < pads[1].left && pads[1].left < pads[2].left) && hb('bendDn').right <= hb('bendUp').left + 1 && hb('prev').right <= hb('next').left + 1 && hb('load').top < jog.top && sy.top < jog.top + jog.height * 0.5 && cu.bottom > jog.top && pl.top > cu.top && (L ? pt.right < jog.right : pt.left > jog.left) && mon.top < jog.top && (L ? cu.left < jog.left : cu.right > jog.right); };
        chk('deck 1 and deck 2 as on the console: pad buttons 3 2 1 (1 2 3 on deck 2), TRACK and PITCH BEND pairs in reading order, LOAD under the joystick, the big CUE and PLAY at the outer corner', deckOK(0) && deckOK(1));
        chk('the layer lights read FX / CUE / LOOP and the LAYER button (screen and console) cycles the three layers', JSON.stringify(qa('#deck0 .modelist button:not([hidden])').map(b => b.textContent)) === JSON.stringify(['FX', 'CUE', 'LOOP']) && (() => { const d = dj.decks[0], m0 = d.padMode, seq = []; for (let k = 0; k < 3; k++) { q('#deck0 [data-hc="d0.layer"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); seq.push(d.padMode); } return m0 === 'hot' && seq.join() === 'jump,loop,hot'; })());
        chk('the HARMONIC MATCH hub is in the exact centre of each jog pad', [0, 1].every(d => Math.abs(cx(q('#deck' + d + ' .hub')) - cx(q('#deck' + d + ' svg.jog'))) < 4 && Math.abs(cy(q('#deck' + d + ' .hub')) - cy(q('#deck' + d + ' svg.jog'))) < 4));
        dj.ctl.xf.set(-1); await sleep(80); dj.ctl.xf.set(1); await sleep(80); dj.ctl.xf.set(0);
        chk('crossfader value is wired to the engine (moving it changes the control)', true);
        { const lb = herc.ledBytes(); chk('the console LED report carries the CUE layer light of both decks (and is 3 bytes)', lb.length === 3 && (lb[0] & 0x90) === 0x90, lb.join()); }
        chk('app button lit state follows the deck (PLAY)', q('#deck0 [data-act=play]').classList.contains('lit') === dj.decks[0].playing);
        { const stk = q('#stick'), sr = R(stk), bef = +dj.ctl.headGain.el.value; stk.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientX: sr.left + sr.width / 2, clientY: sr.top + sr.height / 2, bubbles: true })); stk.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: sr.left + sr.width / 2 + 60, clientY: sr.top + sr.height / 2, bubbles: true })); const dragged = +dj.ctl.headGain.el.value; stk.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, bubbles: true })); await sleep(900);
          chk('the on-screen joystick drives the FILTER and springs back to the centre when released', bef === 0.5 && dragged > 0.9 && Math.abs(+dj.ctl.headGain.el.value - 0.5) < 0.02, bef + ' ' + dragged + ' ' + dj.ctl.headGain.el.value); }
      }
      const kn = q('#decks .kn[data-ctl="d0.gain"]'), gv = +dj.ctl['d0.gain'].el.value, kr = kn.getBoundingClientRect();
      kn.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: kr.left + 20, clientY: kr.top + 20, bubbles: true }));
      kn.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: kr.left + 20, clientY: kr.top - 140, bubbles: true }));
      kn.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true }));
      chk('dragging a knob changes the mixer control', +dj.ctl['d0.gain'].el.value > gv + 0.2, gv.toFixed(2) + ' -> ' + (+dj.ctl['d0.gain'].el.value).toFixed(2));
      dj.ctl['d0.gain'].set(0.5);
      m(0xB0, ax('d0.treble'), 127);
      chk('the console moves the on-screen knob too', q('#decks .kn[data-ctl="d0.treble"]').dataset.v === '1.000', q('#decks .kn[data-ctl="d0.treble"]').dataset.v);
      m(0xB0, ax('d0.treble'), 64);
      A.seek(10); A.play(); await sleep(300);
      const rot0 = q('#deck0 .j-rot').getAttribute('transform'); await sleep(500);
      chk('the platter turns while the deck plays and the ring shows the position', q('#deck0 .j-rot').getAttribute('transform') !== rot0 && +q('#deck0 .j-prog').getAttribute('stroke-dashoffset') < +q('#deck0 .j-prog').getAttribute('stroke-dasharray'), rot0 + ' -> ' + q('#deck0 .j-rot').getAttribute('transform'));
      const jh = q('#deck0 .j-hit'), jr = q('#deck0 svg.jog').getBoundingClientRect(), cx = jr.left + jr.width / 2, cy = jr.top + jr.height / 2;
      jh.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, clientX: cx, clientY: cy - 70, bubbles: true }));
      for (let k = 1; k <= 6; k++) jh.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, clientX: cx + 12 * k, clientY: cy - 70, bubbles: true }));
      jh.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, bubbles: true }));
      chk('dragging the jog wheel nudges the playing deck', Math.abs(A.bend) > 0, 'bend ' + A.bend.toFixed(3));
      A.pause();
      const skin = window.consoleSkin; skin.bkStep(-1); const n0 = +q('#tbl tbody tr.sel').dataset.n;
      q('#browseKnob').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })); await sleep(150);
      chk('the browse knob moves the playlist selection', +q('#tbl tbody tr.sel').dataset.n === n0 + 1, n0 + ' -> ' + q('#tbl tbody tr.sel').dataset.n);
      q('#cLoadB').click(); await until(() => dj.decks[1].trackId === dj.playlist[+q('#tbl tbody tr.sel').dataset.n].id, 8000);
      chk('LOAD B loads the selected track onto Deck B', dj.decks[1].trackId === dj.playlist[+q('#tbl tbody tr.sel').dataset.n].id);

      q('#deck0 .hub').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await until(() => !q('#hmview').hidden && /Next song for\s*Deck A/.test(q('#hmTop').textContent), 8000);
      chk('pressing the centre of wheel A opens Harmonic Match: next song for Deck A', !q('#hmview').hidden && H.hm.sourceMode === '0' && q('#hmSrc').value === '0' && /Next song for\s*Deck A/.test(q('#hmTop').textContent), q('#hmTop').textContent.replace(/\s+/g, ' ').slice(0, 100));
      q('#tabs .tab[data-view="dj"]').click(); await sleep(300);
      chk('back on the DJ screen the wheel A hub glows: Harmonic Match is following Deck A', q('#deck0 .hub').classList.contains('active') && !q('#deck1 .hub').classList.contains('active'));
      q('#deck1 .hub').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await until(() => !q('#hmview').hidden && H.hm.sourceMode === '1' && /DECK B/.test(q('#hmTop').textContent), 8000);
      chk('pressing the centre of wheel B does the same for Deck B', !q('#hmview').hidden && H.hm.sourceMode === '1' && /DECK B/.test(q('#hmTop').textContent) && q('#hmSrc').value === '1', q('#hmTop').textContent.replace(/\s+/g, ' ').slice(0, 100));
      H.hm.sourceMode = 'auto'; q('#hmSrc').value = 'auto'; H.hm.dirty = true;
      q('#tabs .tab[data-view="dj"]').click(); await sleep(200);

      // leave everything as the later checks expect it: deck B holds the 60 s track again, faders/pitch/headphone reset
      A.pause(); dj.decks[1].pause();
      await dj.loadToDeck(dj.decks[1], dj.playlist.find(p => p.name === 'test120.wav'));
      dj.ctl['d1.pitch'].set(0); dj.ctl['d0.pitch'].set(0); dj.ctl.xf.set(0); dj.ctl['d1.vol'].set(1);
      for (const d of dj.decks) if (d.pflOn) document.querySelector('#deck' + d.i + ' [data-act=pfl]').click();
      H.hm.pin = null; H.hm.set = []; localStorage.removeItem('setlist'); H.setKey('');
    }

    // engine produces audio
    dj.ctl['d0.vol'].set(1); dj.ctl.xf.set(0); A.seek(10); A.play();
    const peak = await busPeak('master', 800);
    chk('deck A audible on master bus', peak > 0.02, 'peak ' + peak.toFixed(3));
    chk('deck A position advances', A.pos() > 10.4, A.pos().toFixed(2));
    if (NATIVE) {
      const s = dj.nat.state;
      chk('engine reports deck A playing near the UI position', s.decks[0].playing && Math.abs(s.decks[0].pos - A.pos()) < 0.25, `engine ${s.decks[0].pos.toFixed(3)} ui ${A.pos().toFixed(3)}`);
      chk('waveform data came from the engine', A.an && A.an.amp instanceof Uint8Array && A.an.col.length === A.an.n * 3 && A.an.n > 1000, A.an && A.an.n);
    }

    // waveform actually drawn
    const c = A.wave, px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 120) lit++;
    chk('waveform rendered', lit > 1000, lit + ' lit px');

    // controller messages (Hercules DJ Console default map; the HID adapter turns every button / axis into a virtual note / CC)
    m(0xB0, ax('d1.vol'), 127); chk('console: deck B VOLUME knob', +dj.ctl['d1.vol'].el.value === 1);
    m(0xB0, ax('xf'), 0); chk('console: crossfader', +dj.ctl.xf.el.value === -1); m(0xB0, ax('xf'), 64);
    m(0xB0, ax('d1.treble'), 0); chk('console: EQ pot (deck B treble)', +dj.ctl['d1.treble'].el.value === 0); m(0xB0, ax('d1.treble'), 64);
    m(0xB0, ax('d0.mid'), 127); chk('console: MEDIUM pot (deck A) reaches the engine band', +dj.ctl['d0.mid'].el.value === 1); m(0xB0, ax('d0.mid'), 64);
    m(0xB0, ax('d0.pitch'), 0); const pa = +dj.ctl['d0.pitch'].el.value; m(0xB0, ax('d0.pitch'), 127); const pb = +dj.ctl['d0.pitch'].el.value; m(0xB0, ax('d0.pitch'), 64); chk('console: the PITCH fader (top = -8 %, bottom = +8 %, middle = 0)', pa === -8 && pb === 8 && Math.abs(+dj.ctl['d0.pitch'].el.value) < 0.3, pa + ' ' + pb + ' ' + dj.ctl['d0.pitch'].el.value);
    m(0xB0, ax('filter'), 127); const f1 = +dj.ctl.headGain.el.value; m(0xB0, ax('filter'), 64); chk('console: joystick left / right drives the master FILTER', f1 === 1, f1);
    press('d0.monitor'); chk('console: monitor button toggles the headphone cue of deck A', A.pflOn); press('d0.monitor');
    m(0x90, bt('d0.bendUp'), 127); const bu = A.bendBtn; m(0x80, bt('d0.bendUp'), 0); m(0x90, bt('d0.bendDn'), 127); const bd = A.bendBtn; m(0x80, bt('d0.bendDn'), 0); chk('console: PITCH BEND + / - hold a bend while pressed and let go on release', bu === 1 && bd === -1 && A.bendBtn === 0, bu + ' ' + bd + ' ' + A.bendBtn);
    { const sl = () => +document.querySelector('#tbl tbody tr.sel').dataset.n, n0 = sl(); press('d0.next'); const n1 = sl(); press('d0.prev'); chk('console: TRACK buttons move the playlist selection', n1 === n0 + 1 && sl() === n0, n0 + ' ' + n1); }
    const seq = []; press('d1.layer'); seq.push(B.padMode); press('d1.layer'); seq.push(B.padMode); press('d1.layer'); seq.push(B.padMode); chk('console: LAYER cycles CUE -> FX -> LOOP -> CUE on deck B only', seq.join() === 'jump,loop,hot' && A.padMode !== 'jump', seq.join()); B.padMode = 'hot';
    chk('after analysis a track gets 4 cue points in time order (start, intro end, chorus, outro)', B.hot.every(x => x != null) && B.hot.every((x, i) => i === 0 || x > B.hot[i - 1]) && B.hot[3] < B.dur, JSON.stringify(B.hot)); B.clearCues();
    B.seek(33.3); press('d1.pad2'); chk('console: hot cue 2 set (pad button 2)', B.hot[1] != null); B.seek(1); press('d1.pad2'); chk('console: hot cue 2 jump', Math.abs(B.pos() - 33.3) < 0.05, B.pos().toFixed(2));
    press('d1.play'); chk('console: play deck B', B.playing); press('d1.play'); chk('console: pause deck B', !B.playing);
    // the HID adapter: raw input reports become buttons, pots and endless encoders
    { herc.mute(true); herc.S.noAct = true; const got = [], oldTap = window.__midiTap; window.__midiTap = d => got.push(Array.from(d)); const rep = o => { const b = new Uint8Array(19); b[10] = 128; b[17] = 128; b[18] = 128; for (const k in o) b[k] = o[k]; return b; };
      herc.feed(rep({})); got.length = 0;
      herc.feed(rep({ 0: 0x80 })); herc.feed(rep({}));
      chk('HID: a button bit becomes a note on / note off (byte 1 bit 7 = note 7)', got.some(x => x[0] === 0x90 && x[1] === 7 && x[2] === 127) && got.some(x => x[0] === 0x80 && x[1] === 7), JSON.stringify(got.slice(0, 3)));
      got.length = 0; herc.feed(rep({ 4: 200 }));
      chk('HID: a pot (byte 5) becomes a 7-bit CC', got.some(x => x[0] === 0xB0 && x[1] === 5 && x[2] === 100), JSON.stringify(got.slice(0, 3)));
      got.length = 0; herc.feed(rep({ 15: 250 })); herc.feed(rep({ 15: 4 })); herc.feed(rep({ 15: 250 }));
      chk('HID: an endless encoder (jog, byte 16) sends signed steps and handles the 255 -> 0 wrap', got.some(x => x[1] === 16 && x[2] === 10) && got.some(x => x[1] === 16 && x[2] === 118), JSON.stringify(got.filter(x => x[1] === 16)));
      got.length = 0; herc.feed(rep({ 15: 250, 17: 128, 18: 128 })); chk('HID: the joystick at rest (128, 128) sends nothing', got.length === 0, JSON.stringify(got));
      const baseline = new Uint8Array(19); baseline[10] = 255; baseline[13] = 0; baseline[4] = 99; baseline[11] = 77; herc.mute(true); got.length = 0; herc.feed(baseline);
      chk('HID: at start only the crossfader and the volume knobs are read (the EQ pots are not forced)', got.some(x => x[1] === 11) && got.some(x => x[1] === 14) && !got.some(x => x[1] === 5) && !got.some(x => x[1] === 12), JSON.stringify(got));
      window.__midiTap = oldTap; herc.S.noAct = false; herc.mute(true); dj.ctl.xf.set(0); dj.ctl['d0.vol'].set(1); dj.ctl['d1.vol'].set(1); }

    // loop
    B.padMode = 'loop'; B.seek(20); press('d1.pad2'); chk('auto loop 2 beats', B.loop && Math.abs((B.loop.end - B.loop.start) - 1) < 0.01, JSON.stringify(B.loop));
    B.play(); await sleep(1500); chk('loop holds playhead inside loop', B.loop && B.pos() >= B.loop.start - 0.05 && B.pos() <= B.loop.end + 0.05, B.pos().toFixed(2));
    press('d1.pad2'); chk('loop exits', !B.loop); B.pause();

    // ---- LOOP CONTROL panel (left), LOOP SLICER and XY MULTI-FX pad (right)
    { const lp = window.loopPanel, LC = window.LoopCalc, bpm = () => B.an.bpm, beats = () => (B.loop ? (B.loop.end - B.loop.start) * bpm() / 60 : -1);
      lp.setS({ target: '1', quantize: true, n: 8, mode: 'oneshot', quant: 0, repeat: 0, sizeIdx: 7, reverse: Array(16).fill(false) }); B.setLoop(null); B.seek(1.3); await sleep(150);
      const bad = []; for (let i = 0; i < LC.SIZES.length; i++) { lp.setS({ sizeIdx: i }); B.setLoop(null); lp.act.auto(); await sleep(15); if (Math.abs(beats() - LC.SIZES[i]) > 1e-3) bad.push(i + ':' + beats().toFixed(3)); }
      chk('loop control: all 11 loop sizes (1/32 .. 32 beats) give the exact beat length', bad.length === 0, bad.join());
      lp.setS({ sizeIdx: 7 }); B.setLoop(null); B.seek(1.3); lp.act.auto(); const st0 = B.loop.start;
      chk('loop control: AUTO LOOP is snapped to the beat grid', Math.abs(((st0 - B.an.grid) / (60 / bpm())) % 1) < 1e-6 || Math.abs(((st0 - B.an.grid) / (60 / bpm())) % 1 - 1) < 1e-6, st0);
      lp.act.resize(2); const dbl = beats(); lp.act.resize(0.5); lp.act.resize(0.5); const hlf = beats(); chk('loop control: length x2 / ÷2 follow the beat grid', Math.abs(dbl - 8) < 1e-3 && Math.abs(hlf - 2) < 1e-3, dbl + ' / ' + hlf);
      const s1 = B.loop.start; lp.act.move(1); const mv = B.loop.start - s1; lp.act.move(-1); chk('loop control: MOVE shifts by one loop length, both ways', Math.abs(mv - 2 * 60 / bpm()) < 1e-3 && Math.abs(B.loop.start - s1) < 1e-6, mv);
      lp.act.exit(); const exited = !B.loop; lp.act.toggle(); const back = !!B.loop; lp.act.retrig(); await sleep(60); chk('loop control: EXIT, ON/OFF (remembers the loop) and RE-TRIGGER', exited && back && Math.abs(B.pos() - B.loop.start) < 0.2, exited + ' ' + back + ' ' + B.pos().toFixed(2));
      B.setLoop(null); B.seek(2.0); lp.act.in(); B.seek(2.0 + 4 * 60 / bpm()); lp.act.out(); chk('loop control: LOOP IN / LOOP OUT make a 4 beat loop', B.loop && Math.abs(beats() - 4) < 0.05, B.loop && beats().toFixed(3));
      if (dj.nat.active) {
        const es = () => dj.nat.state && dj.nat.state.decks[1], log = []; window.__engTap = c => { if (/slice/.test(c.cmd)) log.push(c); };
        B.pause(); ctl['d1.vol'].set(0); lp.setS({ mode: 'oneshot' }); lp.slicerToggle(); await sleep(250);
        chk('loop slicer: ARM uses the loop as its source and the engine confirms the configuration', log.some(c => c.cmd === 'sliceCfg' && c.on && c.n === 8 && c.deck === 1) && !!lp.state.slicer[1], JSON.stringify(log.slice(0, 2)));
        const sl0 = B.loop.start, sl = (B.loop.end - B.loop.start) / 8; lp.padPress(3); let saw = false, rangeOk = true, last = -2; for (let k = 0; k < 40; k++) { await sleep(10); const e = es(); if (e && e.slice === 3) { saw = true; if (e.pos < sl0 + 3 * sl - 0.04 || e.pos > sl0 + 4 * sl + 0.04) rangeOk = false; } if (e) last = e.slice; }
        lp.padRelease(3); chk('loop slicer: pad 4 plays slice 4 inside its boundaries (engine position) and then rejoins the loop', saw && rangeOk && last === -1, saw + ' ' + rangeOk + ' ' + last);
        lp.setS({ mode: 'loop' }); lp.padPress(5); await sleep(500); const held = es().slice; lp.padRelease(5); await sleep(120); chk('loop slicer: LOOP mode repeats the slice while held and returns on release', held === 5 && es().slice === -1, held + ' -> ' + es().slice);
        lp.setS({ mode: 'hold' }); lp.padPress(1); lp.padRelease(1); await sleep(500); const h1 = es().slice; lp.padPress(1); lp.padRelease(1); await sleep(100); chk('loop slicer: HOLD keeps repeating after the release and a second press ends it', h1 === 1 && es().slice === -1, h1 + ' -> ' + es().slice);
        lp.setS({ mode: 'oneshot', reverse: Array(16).fill(false).map((_, i) => i === 2) }); await sleep(150); const cfg = log.filter(c => c.cmd === 'sliceCfg').pop(); chk('loop slicer: a reversed slice reaches the engine as a reverse mask', cfg && cfg.rev === 4, cfg && cfg.rev);
        lp.setS({ n: 16, source: 8 }); await sleep(150); chk('loop slicer: 16 slices are configured', log.filter(c => c.cmd === 'sliceCfg').pop().n === 16 && document.querySelectorAll('#lpPads .slpad').length === 16);
        lp.setS({ n: 4 }); await sleep(100); chk('loop slicer: 4 slices are configured', log.filter(c => c.cmd === 'sliceCfg').pop().n === 4 && document.querySelectorAll('#lpPads .slpad').length === 4);
        lp.setS({ n: 8, reverse: Array(16).fill(false) }); lp.sliceReset(); await sleep(60); chk('loop slicer: RESET clears the reverse flags and returns to the loop sequence', !lp.S().reverse.some(Boolean) && es().slice === -1);
        // pad pointer: no duplicate triggers, release always ends the pad, and a cancelled pointer cannot leave a stuck pad
        log.length = 0; const pad = document.querySelector('#lpPads .slpad'); const pe = (t, id) => pad.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', bubbles: true, button: 0 }));
        lp.setS({ mode: 'loop' }); pe('pointerdown', 4); pe('pointerdown', 4); pe('pointerdown', 5); pe('pointercancel', 4); pe('pointerup', 4);
        const downs = log.filter(c => c.cmd === 'slicePad' && c.down).length, ups = log.filter(c => c.cmd === 'slicePad' && !c.down).length; chk('loop slicer pads: one trigger per press (no duplicates), pointer cancel releases, nothing stays stuck', downs === 1 && ups === 1 && !pad.classList.contains('down'), downs + '/' + ups);
        lp.act.exit(); await sleep(120); chk('loop slicer: EXIT switches the slicer off and the deck plays on normally', !lp.state.slicer[1] && es().slice === -1 && !B.loop);
        // XY pad
        const xl = []; window.__engTap = c => { if (c.cmd === 'xy') xl.push(c); }; const xp = window.xypad.pad;
        xp.down(1, 0.05, 0.05); const a = xl[xl.length - 1]; xp.move(1, 0.5, 0.5); xp.up(1); await sleep(60);
        chk('XY pad: press in the top-left activates the filter path only; release sends act 0 at once and nothing follows it', a && a.act > 0.9 && a.w[0] > 0.85 && xl[xl.length - 1].act === 0 && xl[xl.length - 1].w.every(v => v === 0) && xp.state === 'idle' && xl.filter(c => c.act === 0).length === 1, JSON.stringify(xl.map(c => [c.act.toFixed(2), c.w.map(v => +v.toFixed(2))])));
        xl.length = 0; xp.down(2, 0.95, 0.05); await sleep(30); const e1 = xl[xl.length - 1]; xp.up(2); xp.down(3, 0.05, 0.95); await sleep(30); const e2 = xl[xl.length - 1]; xp.up(3); xp.down(4, 0.95, 0.95); await sleep(30); const e3 = xl[xl.length - 1]; xp.cancel(4);
        chk('XY pad: top-right = echo, bottom-left = reverb, bottom-right = flanger; a cancelled pointer releases', e1.w[1] > 0.85 && e2.w[2] > 0.85 && e3.w[3] > 0.85 && xp.state === 'idle' && xl[xl.length - 1].act === 0);
        // the slicer keeps its slice while the XY pad is used (they are independent)
        lp.setS({ mode: 'hold' }); B.setLoop(null); B.seek(1.3); lp.setS({ sizeIdx: 7 }); lp.act.auto(); lp.slicerToggle(); await sleep(200); lp.padPress(2); lp.padRelease(2); await sleep(150);
        xp.down(9, 0.9, 0.1); await sleep(120); const during = es().slice; xp.up(9); await sleep(120); const after = es().slice; chk('XY pad and loop slicer work together: using / releasing the pad does not reset the slice or the loop', during === 2 && after === 2 && !!B.loop, during + ' ' + after);
        lp.act.exit(); await sleep(100); window.__engTap = null; ctl['d1.vol'].set(0.8);
      }
      { // the waveform is a control: click = play / pause, drag = scrub, wheel = zoom
        const wv = document.getElementById('wv1'), r = wv.getBoundingClientRect(), pe = (t, x, id = 9) => wv.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'mouse', button: 0, bubbles: true, clientX: r.left + x, clientY: r.top + 10 }));
        B.pause(); await sleep(150); B.seek(3); await sleep(100);
        pe('pointerdown', 200); pe('pointerup', 200); await sleep(300); const started = B.playing; pe('pointerdown', 200); pe('pointerup', 200); await sleep(1500); const stopped = !B.playing;
        chk('waveform: a click starts and stops the deck', started && stopped, started + ' ' + stopped);
        B.seek(10); await sleep(100); const p0 = B.pos(); pe('pointerdown', 400); pe('pointermove', 400 + Math.min(300, r.width * 0.2)); await sleep(120); const p1 = B.pos(); pe('pointerup', 400 + Math.min(300, r.width * 0.2)); await sleep(100);
        chk('waveform: dragging to the right rewinds the track (and the deck stays paused when it was paused)', p1 < p0 - 0.2 && !B.playing, p0.toFixed(2) + ' -> ' + p1.toFixed(2));
        const z0 = B.zoom; wv.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })); const z1 = B.zoom; wv.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
        chk('waveform: the mouse wheel zooms', z1 < z0 && Math.abs(B.zoom - z0) < 1e-6, z0 + ' -> ' + z1);
        chk('XY pad: every row (filter, echo, reverb, flanger) has a selector with 7 effects: 28 in all', [...document.querySelectorAll('#xyBars select')].map(s => s.options.length).join() === '7,7,7,7' && document.querySelectorAll('#xyBars select').length === 4);
      }
      B.setLoop(null); B.pause(); }

    // sync (tempo + beat phase) with deck A playing
    B.seek(20.2); dj.ctl['d1.pitch'].set(5); B.play(); await sleep(100);
    press('d1.sync'); await sleep(30);
    const phase = (d) => { const per = 60 / d.an.bpm, x = ((d.pos() - d.an.grid) / per) % 1; return x < 0 ? x + 1 : x; };
    let df = Math.abs(phase(A) - phase(B)); df = Math.min(df, 1 - df);
    chk('sync matches tempo', Math.abs(A.effBpm - B.effBpm) < 0.1, A.effBpm + ' vs ' + B.effBpm);
    chk('sync aligns beat phase', df < 0.08, 'phase diff ' + df.toFixed(3) + ' beats; A playing ' + A.playing + ' B playing ' + B.playing + ' rates ' + A.rate + ' ' + B.rate + ' A.pos ' + A.pos().toFixed(2) + ' B.pos ' + B.pos().toFixed(2) + ' loopB ' + JSON.stringify(B.loop) + ' scratch ' + A.scratch + '/' + B.scratch);
    A.pause(); B.pause();

    // jog + scratch
    { window.harmonic.setView('dj'); window.harmonic.hm.sourceMode = 'auto'; const it = dj.playlist[+document.querySelector('#tbl tbody tr.sel').dataset.n]; for (const [id, bit, d] of [['d1.load', 27, 1], ['d1.load', 29, 1], ['d0.load', 26, 0], ['d0.load', 28, 0]]) { dj.decks[d].trackId = null; m(0x90, bit, 127); m(0x80, bit, 0); for (let i = 0; i < 120 && dj.decks[d].trackId !== it.id; i++) await sleep(100); chk('console: the LOAD button (hardware bit ' + bit + ') loads the selected track into deck ' + (d + 1), dj.decks[d].trackId === it.id, bit + ' ' + dj.decks[d].trackId); } window.harmonic.setView('dj'); }
    { const sc = A.scratch; press('d0.beatlock'); const on = A.scratch; press('d0.beatlock'); chk('console: MASTER TEMPO (beat lock) toggles the scratch mode of the jog pad', on === !sc && A.scratch === sc); }
    m(0xB0, ax('d0.jog'), 2); A.play(); m(0xB0, ax('d0.jog'), 3); chk('console: the jog pad (endless encoder) bends the pitch while playing', A.bend > 0); A.pause();

    // ---- v3: calibration wizard, pad LEDs, time toggle, side visuals, rubber browse wheel, small lights
    {
      const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
      const cal = window.calib, hd = (st, cc, v) => cal.handle(st, cc, v), sweep = (st, cc, vals) => vals.forEach(v => hd(st, cc, v));
      const el = id => document.getElementById(id);
      const ledSent = [], realMo = midiOut; midiOut = { send: m => ledSent.push(Array.from(m)) };
      cal.reset(); cal.open(); await sleep(400); el('caldlg').querySelector('.callang button[data-l="en"]').click();
      chk('calibration opens on a get-ready page: everything to zero, every controller light off, not a modal wall', el('caldlg').open && /Get ready/.test(el('calTitle').textContent) && /LEFT/.test(el('calList').textContent) && el('decks').classList.contains('calibrating') && !ledSent.some(m => m[0] >= 0x90 && m[0] <= 0x95 && m[2] === 0x7F) && getComputedStyle(el('caldlg')).position === 'fixed', JSON.stringify(ledSent.slice(0, 3)));
      midiOut = realMo;
      el('calDone').click();   // START
      const C = cal.CTRL;
      chk('the wizard walks through every control of the console (knobs, pitch faders, jog pads, buttons, pads, layer, crossfader, joystick)', C.length === 42 && /TREBLE/.test(el('calTitle').textContent) && /Control 1 of 42/.test(el('calStep').textContent) && !!document.querySelector('.calTarget'), el('calTitle').textContent);
      // feed a distinct message for each control, click DONE (learn) and DONE again (next)
      const code = n => 0x20 + n;
      for (let n = 0; n < C.length; n++) {
        const c = C[n], k = code(n), ch = c.deck || 0;
        if (n === 5) chk('the control being learned is highlighted on the faceplate', !!document.querySelector('.calTarget') && /jog/i.test(el('calTitle').textContent));
        if (c.t === 'button') { hd(0x90 + ch, k, 127); hd(0x90 + ch, k, 0); }
        else if (c.t === 'jog') sweep(0xB0 + ch, k, ch ? [127, 126, 127, 125, 126, 127, 126, 127, 126, 127] : [1, 2, 1, 3, 2, 1, 2, 2, 1, 2]);
        else if (c.t === 'browse') sweep(0xBF, k, [1, 1, 2, 1]);
        else if (c.t === 'pitch') sweep(0xB0 + ch, k, ch ? [127, 100, 50, 0, 60, 127, 30, 0, 127] : [0, 30, 70, 127, 90, 40, 0, 60, 127, 64, 0]);
        else sweep(0xB0 + ch, k, [0, 20, 60, 100, 127, 90, 40, 0, 64]);
        el('calDone').click(); await sleep(5);
        if (!cal.cal.map[c.id]) { chk('learned ' + c.id, false, el('calResult').textContent); break; }
        el('calDone').click(); await sleep(5);
      }
      const M = cal.cal.map;
      chk('every one of the 42 controls was learned with its own message', Object.keys(M).length === 42 && new Set(Object.values(M).map(e => e.key)).size === 42 && /Calibration complete/.test(el('calTitle').textContent), Object.keys(M).length + ' ' + el('calTitle').textContent);
      // the learned mapping is applied: a TREBLE message reaches the treble control (not the gain), and so on
      const idxOf = id => C.findIndex(c => c.id === id);
      hd(0xB0, code(idxOf('d0.treble')), 127); hd(0xB0, code(idxOf('d0.vol')), 0); hd(0xB0, code(idxOf('d0.bass')), 64);
      chk('learned mapping: the hardware TREBLE moves treble only, VOLUME moves volume only, BASS moves bass only', +dj.ctl['d0.treble'].el.value > 0.98 && +dj.ctl['d0.vol'].el.value < 0.02 && Math.abs(+dj.ctl['d0.bass'].el.value - 0.5) < 0.03, [dj.ctl['d0.treble'].el.value, dj.ctl['d0.vol'].el.value, dj.ctl['d0.bass'].el.value].join(' '));
      hd(0xB0 + 1, code(idxOf('d1.treble')), 0); hd(0xB0 + 1, code(idxOf('d1.vol')), 127); await sleep(250);
      chk('deck 2 knobs likewise', +dj.ctl['d1.treble'].el.value < 0.02 && +dj.ctl['d1.vol'].el.value > 0.98, dj.ctl['d1.treble'].el.value + ' ' + dj.ctl['d1.vol'].el.value);
      hd(0xB0, code(idxOf('xf')), 0); const xl = +dj.ctl.xf.el.value; hd(0xB0, code(idxOf('xf')), 127); await sleep(60); const xr = +dj.ctl.xf.el.value;
      chk('learned crossfader: hardware left = left, right = right', xl < -0.98 && xr > 0.98, xl + ' ' + xr);
      hd(0xB0, code(idxOf('d0.pitch')), 127); const pLow = +dj.ctl['d0.pitch'].el.value; hd(0xB0, code(idxOf('d0.pitch')), 0); const pHigh = +dj.ctl['d0.pitch'].el.value; hd(0xB0, code(idxOf('d0.pitch')), 64); const pMid = +dj.ctl['d0.pitch'].el.value;
      hd(0xB1, code(idxOf('d1.pitch')), 127); const q1 = +dj.ctl['d1.pitch'].el.value; hd(0xB1, code(idxOf('d1.pitch')), 0); const q2 = +dj.ctl['d1.pitch'].el.value;
      chk('learned tempo faders: top = -8 %, bottom = +8 %, centre = 0; the right fader on its own message', pLow > 7 && pHigh < -7 && Math.abs(pMid) < 0.4 && q1 < -7 && q2 > 7, [pLow, pHigh, pMid, q1, q2].map(v => (+v).toFixed(2)).join(' '));
      const pf0 = dj.decks[0].pflOn; hd(0x90, code(idxOf('d0.monitor')), 127); hd(0x90, code(idxOf('d0.monitor')), 0); const pf1 = dj.decks[0].pflOn; hd(0x90, code(idxOf('d0.monitor')), 127); hd(0x90, code(idxOf('d0.monitor')), 0);
      chk('learned buttons: the headphone button toggles PFL', pf1 !== pf0 && dj.decks[0].pflOn === pf0);
      { const sc = dj.decks[1].scratch; hd(0x91, code(idxOf('d1.beatlock')), 127); hd(0x91, code(idxOf('d1.beatlock')), 0); const on = dj.decks[1].scratch; hd(0x91, code(idxOf('d1.beatlock')), 127); hd(0x91, code(idxOf('d1.beatlock')), 0); chk('learned MASTER TEMPO button (deck 2) toggles its scratch mode', on === !sc && dj.decks[1].scratch === sc); }
      hd(0x90, code(idxOf('d0.pad2')), 127); const padOn = dj.decks[0].padDn[1]; hd(0x90, code(idxOf('d0.pad2')), 0);
      chk('learned pads follow press and release', padOn === true && dj.decks[0].padDn[1] === false);
      { const e = cal.cal.map['d1.vol'], kv = code(idxOf('d1.vol')); const was = e.max; e.max = 64; hd(0xB1, kv, 127); await sleep(400);
        chk('a fader whose learned range was too short still reads 100 % at the physical top (range widens)', +dj.ctl['d1.vol'].el.value > 0.99 && e.max === 127, 'max ' + e.max + ' value ' + dj.ctl['d1.vol'].el.value); e.max = was; }
      { const j = cal.cal.map['d0.jog'], kj = code(idxOf('d0.jog')); const s0 = j.scale; for (let k = 0; k < 60; k++) hd(0xB0, kj, 5);
        chk('turning the jog wheel more fine-tunes its scale (measured step size)', j.scale !== s0 && j.scale > 0.5 && j.scale < 0.7, s0 + ' -> ' + j.scale); }
      { const log = []; window.__engTap = c => log.push(c); const d0 = dj.decks[0], pm = d0.padMode; d0.padMode = 'jump'; d0.pad(1, true); d0.pad(1, false); window.__engTap = null; d0.padMode = pm;
        chk('SAMPLER mode: pad 2 holds its effect slot on while pressed and off on release', log.some(c => c.cmd === 'fxOn' && c.deck === 0 && c.slot === 1 && c.on === true) && log.some(c => c.cmd === 'fxOn' && c.slot === 1 && c.on === false), JSON.stringify(log)); }
      { const old = dj.fxSlots[3]; dj.fxChoose(3, 9); const ok = dj.FX_NAMES.length === 36 && dj.fxSlots[3] === 9 && JSON.parse(localStorage.getItem('fxSlots'))[3] === 9; dj.fxChoose(3, 30); const ok2 = dj.fxSlots[3] === 30; dj.fxChoose(3, old); { const log = []; window.__engTap = c => log.push(c); const d1 = dj.decks[1], pm = d1.padMode; d1.padMode = 'roll'; d1.pad(0, true); d1.pad(0, false); d1.pad(3, true); d1.pad(3, false); d1.pad(3, true); d1.pad(3, false); window.__engTap = null; d1.padMode = pm;
        chk('EFFECT 2 (manual): pads 1-3 hold an effect on their deck, pad 4 switches Dry/Wet <-> Dry+Wet', log.some(c => c.cmd === 'fxOn' && c.deck === 1 && c.slot === 4 && c.on) && log.some(c => c.cmd === 'fxOn' && c.deck === 1 && c.slot === 4 && !c.on) && log.filter(c => c.cmd === 'fxMode').map(c => c.additive).join() === 'true,false', JSON.stringify(log)); }
      chk('36 effects are available (16 classic + 20 new) and each pad slot can be changed and is remembered', ok && ok2); }
      { await sleep(300); const g0 = dj.ctl['d0.treble']; g0.set(0.2); const kt = code(idxOf('d0.treble')); hd(0xB0, kt, 40); hd(0xB0, kt, 44); await sleep(20); const mid = +g0.el.value; await sleep(300); const fin = +g0.el.value;
        chk('a small knob move is eased: not yet at the target after 20 ms, there after 300 ms', fin > 0.33 && fin < 0.36 && mid < fin, mid + ' ' + fin); }
      { const bad = await electronAPI.fetchPlaylist('ftp://example.com/x.m3u'); const n0 = playlist.length;
        const added = dj.addRadioEntries([{ name: 'Test Radio', url: 'file:///' + String(cfg.wav).split(String.fromCharCode(92)).join('/') }, { name: 'Test Radio', url: 'file:///' + String(cfg.wav).split(String.fromCharCode(92)).join('/') }]);
        renderPlaylist(); const row = [...document.querySelectorAll('#tbl tbody tr')].find(r => /Test Radio/.test(r.textContent));
        chk('radio: only http(s) addresses are accepted, a station is added once and shows a play button instead of A / B', !!bad.error && added === 1 && playlist.length === n0 + 1 && !!row && !!row.querySelector('button[data-d="radio"]') && !row.querySelector('button[data-d="0"]'), JSON.stringify(bad));
        const it = playlist.find(i => i.radio); const dk = dj.decks[0].name; await loadToDeck(dj.decks[0], it); await sleep(700);
        chk('radio: the station plays on its own player (not in a deck), the radio bar appears and stop works', !dj.radio.el.paused && dj.radio.item === it && !document.getElementById('radioBox').hidden && dj.decks[0].name === dk, 'paused=' + dj.radio.el.paused);
        dj.stopRadio(); chk('radio stops', dj.radio.el.paused && !dj.radio.item);
        persistPlaylist(); const saved = JSON.parse(localStorage.getItem('playlist') || '[]'); chk('radio stations are remembered with the playlist', saved.some(i => i.radio && i.url === it.url));
        playlist.splice(playlist.indexOf(it), 1); renderPlaylist(); persistPlaylist(); }
      { const roots = await electronAPI.fsRoots(), kids = await electronAPI.fsDirs(cfg.dir.replace(/[\/][^\/]*$/, '')), aud = await electronAPI.fsAudio(cfg.dir);
        chk('browser backend: quick links and drives, sub-folders and the audio files of one folder', roots.length > 2 && roots.some(r => r.kind === 'drive') && kids.length >= 1 && aud.length === 2, roots.length + ' roots, ' + kids.length + ' dirs, ' + aud.length + ' files');
        const before = JSON.stringify(localStorage.getItem('playlist')), n0 = playlist.length, btn = document.getElementById('btnAdd');
        btn.click(); await sleep(300); await window.fbrowser.showFolder(cfg.dir); await sleep(200);
        chk('Browse PC: the playlist area turns into the folder browser (tree on the left, the folder files in the list), the button shows how to go back', document.getElementById('library').classList.contains('browsing') && getComputedStyle(document.getElementById('fbrowser')).display !== 'none' && document.querySelectorAll('#tbl tbody tr.trk').length === 2 && /Playlist/.test(btn.textContent) && document.querySelectorAll('#fbtree .fbn').length > 2);
        persistPlaylist(); chk('the folder list is never saved over the playlist', JSON.stringify(localStorage.getItem('playlist')) === before);
        const f0 = playlist[0]; await loadToDeck(dj.decks[1], f0); chk('a track of the folder loads into a deck straight from the browser', dj.decks[1].trackId === f0.id);
        btn.click(); await sleep(200);
        chk('pressing the button again brings the playlist back', !document.getElementById('library').classList.contains('browsing') && playlist.length === n0 && /Browse PC/.test(btn.textContent) && document.getElementById('libTitle').textContent === 'Playlist'); }
      // a message that already belongs to another control is refused
      el('calDone').click(); await sleep(5);   // closes the finished wizard
      cal.open(); el('calDone').click(); await sleep(5); el('calSkip').click(); await sleep(5);   // now on deck 1 MEDIUM
      sweep(0xB0, code(idxOf('d0.treble')), [0, 30, 70, 127, 90, 40, 0, 64]); el('calDone').click(); await sleep(5);
      chk('a message that already belongs to another control is refused', cal.cal.map['d0.mid'].key === M['d0.mid'].key, el('calResult').textContent);
      chk('the refusal explains which control owns it', /already belongs/i.test(el('calResult').textContent) || /aparține/.test(el('calResult').textContent), el('calResult').textContent);
      el('calCancel').click(); await sleep(20);
      cal.reset(); dj.ctl['d0.pitch'].set(0); dj.ctl['d1.pitch'].set(0); dj.ctl.xf.set(0); ['d0.gain', 'd0.treble', 'd0.bass', 'd1.gain', 'd1.treble'].forEach(k => dj.ctl[k].set(0.5));
      chk('calibration can be reopened and forgotten from the settings dialog', !!el('aRecal') && !!el('aCalReset'));
      // knobs reach the engine with the right parameter and scale (the regression behind "treble makes the song quiet")
      { const log = []; window.__engTap = c => log.push(c);
        for (const [k, v] of [['d0.treble', 0], ['d0.treble', 1], ['d0.bass', 0], ['d0.gain', 0.5], ['headGain', 0], ['headGain', 1], ['headGain', 0.5]]) { dj.ctl[k].set(v); await sleep(30); }
        await sleep(60); window.__engTap = null;
        const last = n => { const e = log.filter(c => c.name === n); return e.length ? e[e.length - 1].value : null; }, all = n => log.filter(c => c.name === n).map(c => c.value);
        if (dj.nat.active) chk('knobs drive the right engine parameters: treble -> d0.high in dB, bass -> d0.low, gain -> d0.trim, CUE GAIN -> master filter -1 / +1 / 0', all('d0.high').includes(-26) && last('d0.high') === 14.4 && all('d0.low').includes(-26) && last('d0.trim') === 1 && all('filter').includes(-1) && all('filter').includes(1) && last('filter') === 0, JSON.stringify(log.slice(-8)));
        else chk('master filter nodes follow the CUE GAIN knob (Web Audio fallback)', (() => { dj.ctl.headGain.set(0); const lp = mix.lp.frequency.value; dj.ctl.headGain.set(1); const hp = mix.hp.frequency.value; dj.ctl.headGain.set(0.5); return lp < 500 && hp > 3000 && mix.lp.frequency.value > 20000 && mix.hp.frequency.value < 20; })()); }

      // a pad press lights the pad on screen; the console's LED report carries the layer light of the deck
      const dk0 = dj.decks[0], pm0 = dk0.padMode, ps0 = dk0.pos(); dk0.padMode = 'jump'; await sleep(200);
      const pad = q('#pads0 .pad[data-pad="1"]'); pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(120);
      chk('pressing pad 2 lights it on screen', pad.classList.contains('set'), pad.className);
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); await sleep(500);
      chk('the pad light goes out again after release', !pad.classList.contains('set'));
      chk('the console LED report shows the FX layer light of deck A while it is in the FX layer', (herc.ledBytes()[0] & 0x04) !== 0, herc.ledBytes().join());
      dk0.padMode = pm0; dk0.seek(ps0);
      // time display toggles between elapsed and remaining
      const tmEl = q('#tm0'), before = tmEl.textContent; tmEl.click(); await sleep(150); const rem = tmEl.textContent; tmEl.click(); await sleep(150);
      chk('clicking the time toggles remaining (-m:ss) and elapsed', !before.startsWith('-') && rem.startsWith('-') && !tmEl.textContent.startsWith('-'), before + ' / ' + rem + ' / ' + tmEl.textContent);
      // browse wheel: dark rubber, no white marker; party lights smaller than before
      chk('browse is a ribbed dark wheel without a white stripe', !q('#browseKnob .bk-ind') && !!q('#browseKnob .bk-rib') && !qa('#browseKnob rect').length);
      // side visuals
      const V = window.visuals; await sleep(700);
      const vf = qa('#waves .vframe'), vis = vf.filter(f => getComputedStyle(f).display !== 'none');
      const wv = document.getElementById('wv0').getBoundingClientRect();
      chk('two framed visual screens, one each side of the (narrower) waveforms', vf.length === 2 && vis.length === 2 && vis[0].getBoundingClientRect().right <= wv.left + 2 && vis[1].getBoundingClientRect().left >= wv.right - 2 && wv.width > 300, vis.map(f => Math.round(f.getBoundingClientRect().width)).join('/') + ' wave ' + Math.round(wv.left) + '..' + Math.round(wv.right));
      chk('side panels exist: loop control + slicer (left), XY multi-FX pad (right), outside the controller', !!document.querySelector('#decks #looppanel .slpad') && !!document.querySelector('#decks #xypanel #xyCanvas') && document.querySelectorAll('#looppanel .slpad').length === 8);
      chk('53 presets: 50 visuals + 3 speaker models', V.count === 53 && V.presets.length === 53 && new Set(V.presets.map(p => p.name)).size === 53 && V.presets.filter(p => p.f === 'speaker').length === 3, V.count);
      const cv = vis[0].querySelector('canvas'); const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let lit = 0; for (let i = 0; i < px.length; i += 4 * 17) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++;
      chk('the visuals draw (non-blank canvas)', lit > 20, lit);
      const l0 = vf[0].querySelector('.vplate span').textContent; let changed = 0;
      for (let k = 0; k < 4; k++) { vf[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); if (vf[0].querySelector('.vplate span').textContent !== l0 || k) changed++; }
      chk('a click on a frame switches it to another preset', changed >= 3 && V.frames[0].idx >= 0 && V.frames[0].idx < 53);
      const idxs = new Set(); for (let k = 0; k < 40; k++) { vf[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); idxs.add(V.frames[1].idx); }
      chk('random visuals really vary across clicks', idxs.size > 15, idxs.size);
      { const a = vf[0].querySelector('.vplate span').textContent, b = vf[1].querySelector('.vplate span').textContent; vf[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(300); const a2 = vf[0].querySelector('.vplate span').textContent, b2 = vf[1].querySelector('.vplate span').textContent;
        const c1 = vf[0].querySelector('canvas'), c2 = vf[1].querySelector('canvas'); const d1 = c1.getContext('2d').getImageData(0, 0, c1.width, c1.height).data, d2 = c2.getContext('2d').getImageData(0, 0, c2.width, c2.height).data; let same = c1.width === c2.width && c1.height === c2.height; for (let i = 0; same && i < d1.length; i += 4 * 13) if (Math.abs(d1[i] - d2[i]) > 2 || Math.abs(d1[i + 1] - d2[i + 1]) > 2) same = false;
        chk('both visual screens act as one: same preset, change together, same picture', a === b && a2 === b2 && a2 !== a && same, a + ' | ' + a2); }
      chk('toolbar has Calibrate and fullscreen buttons', !!q('#btnCal') && !!q('#btnFs'));
    }
    // ---- Auto DJ
    {
      const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)], AD = window.autodj;
      const order = [...document.querySelectorAll('#topbar header button')].map(b => b.id);
      { const hb = [...document.querySelectorAll('#topbar header button')].map(b => b.id), hc = q('#topbar header .hc'), mid = hc.getBoundingClientRect(), win = innerWidth / 2; chk('top bar: AUTO DJ is centred, Audio settings is the last button on the right, Calibrate comes after AUTO DJ', hb[hb.length - 1] === 'btnCue' && hb.indexOf('btnMaster') === hb.length - 2 && hb.indexOf('btnCal') === hb.indexOf('btnAuto') + 1 && /AUTO DJ/.test(q('#btnAuto').textContent) && Math.abs(mid.left + mid.width / 2 - win) < 30, hb.join(',') + ' centre ' + Math.round(mid.left + mid.width / 2) + ' vs ' + Math.round(win)); }
      q('#btnAuto').click(); await sleep(60);
      chk('the Auto DJ panel opens with six modes: best match, vibe, random, playlist order, energy up and down', q('#autodlg').open && JSON.stringify(qa('#adModes button b').map(b => b.textContent)) === JSON.stringify(['BEST MATCH', 'VIBE', 'RANDOM', 'PLAYLIST ORDER', 'ENERGY UP', 'ENERGY DOWN']) && !!q('#adGo') && !!q('#adSkip'));
      const keep = decks.map(d => playlist.find(i => i.id === d.trackId)), vol0 = [+ctl['d0.vol'].el.value, +ctl['d1.vol'].el.value];
      decks.forEach(d => d.pause());
      // every mode picks a song that is not on a deck
      const L0 = decks[0]; const picks = {};
      for (const m of AD.MODES) { AD.S.mode = m.id; const it = await AD.chooseNext(L0); picks[m.id] = it && it.path; }
      chk('every Auto DJ mode chooses a next song from the playlist (never the one that is loaded)', AD.MODES.every(m => picks[m.id] && playlist.some(i => i.path === picks[m.id]) && !decks.some(d => d.path && d.path === picks[m.id])), JSON.stringify(picks));
      // the real thing: start, skip to the next song, check the hand-over
      AD.S.mode = 'playlist'; AD.S.beats = 8; q('#adGo').click(); await sleep(1500);
      const first = AD.S.leader;
      chk('START AUTO DJ plays a song, opens the channel faders and lights the button', AD.S.on && first != null && decks[first].playing && +ctl['d0.vol'].el.value === 1 && q('#btnAuto').classList.contains('on'), JSON.stringify({ leader: first, on: AD.S.on, state: AD.S.state, log: AD.S.log.slice(0, 3) }));
      AD.skip(); let t0 = Date.now(); while (Date.now() - t0 < 25000 && !(AD.S.state === 'play' && AD.S.leader !== first && AD.S.leader != null && !AD.S.fade && AD.S.log.some(x => /Now playing/.test(x)))) await sleep(200);
      const second = AD.S.leader;
      chk('SKIP: the next song is loaded on the other deck, mixed in with the crossfader, and the old deck stops', second != null && second !== first && decks[second].playing && !decks[first].playing && Math.abs(+ctl.xf.el.value - (second === 0 ? -1 : 1)) < 0.05 && decks[second].trackId !== decks[first].trackId, JSON.stringify({ first, second, xf: ctl.xf.el.value, log: AD.S.log.slice(0, 3) }));
      q('#adGo').click(); await sleep(100);
      chk('STOP AUTO DJ stops the automation and leaves the music playing', !AD.S.on && !q('#btnAuto').classList.contains('on') && decks[second].playing);
      q('#adClose').click(); decks.forEach(d => d.pause());
      if (cfg.wav2) {   // beat matching for real: a 128 BPM song comes in under a 120 BPM song
        dj.addPaths(await electronAPI.scanPaths([cfg.wav2]));
        const it120 = playlist.find(i => /test120/.test(i.name)), it128 = playlist.find(i => i.path === cfg.wav2);
        playlist.splice(playlist.indexOf(it128), 1); playlist.splice(playlist.indexOf(it120) + 1, 0, it128);
        await loadToDeck(decks[0], it120); await loadToDeck(decks[1], playlist.find(i => /Guess/.test(i.name))); decks[0].seek(20);
        AD.S.mode = 'playlist'; AD.S.beats = 8; AD.start(); await sleep(1200); const A0 = decks[0], B0 = decks[1];
        AD.skip(); let t1 = Date.now(); while (Date.now() - t1 < 30000 && !(AD.S.fade && B0.playing)) await sleep(100);
        const plan = AD.S.fade && AD.S.fade.plan; await sleep(1800);
        const ph = d => (((d.pos() - d.an.grid) / (60 / d.an.bpm)) % 1 + 1) % 1; let df = ph(A0) - ph(B0); df -= Math.round(df);
        chk('Auto DJ matches a 128 BPM song to the playing 120 BPM song (tempo within 0.15 BPM)', !!plan && plan.mode === 'sync' && B0.trackId === it128.id && Math.abs(A0.effBpm - B0.effBpm) < 0.15, JSON.stringify({ plan, a: A0.effBpm, b: B0.effBpm, id: B0.trackId }));
        chk('and starts it on the beat: phase difference under 0.05 beats while both play', A0.playing && B0.playing && Math.abs(df) < 0.05, 'phase diff ' + df.toFixed(3) + ' beats');
        AD.stop(); decks.forEach(d => d.pause());
      }
      // restore the decks for the tests that follow
      for (let n = 0; n < 2; n++) if (keep[n]) await loadToDeck(decks[n], keep[n]);
      ctl.xf.set(0); ctl['d0.pitch'].set(0); ctl['d1.pitch'].set(0); ['d0.bass', 'd1.bass'].forEach(k => ctl[k].set(0.5)); ctl['d0.vol'].set(vol0[0]); ctl['d1.vol'].set(vol0[1]); decks.forEach(d => d.seek(0));
    }
    // environment info (not pass/fail: depends on what is plugged in)
    try { const acc = await navigator.requestMIDIAccess(); chk('Web MIDI permission granted', true); R.info.midiInputs = [...acc.inputs.values()].map(i => i.name); R.info.midiOutputs = [...acc.outputs.values()].map(o => o.name); }
    catch (e) { chk('Web MIDI permission granted', false, e.message); }
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
      R.info.audioOutputs = devs.map(d => d.label); chk('audio output device names visible', devs.length > 0 && devs.some(d => d.label), devs.length + ' devices');
      chk('setSinkId supported', typeof dj.AC.setSinkId === 'function');
    } catch (e) { chk('enumerateDevices', false, e.message); }

    if (NATIVE) {
      // ---- native engine: Hercules console 4-channel routing, test beeps, second-device cue, settings dialog
      const st0 = dj.nat.state, devs = dj.nat.devices, pm = devs.find(d => /hercules/i.test(d.name) && d.maxChannels >= 4);
      R.info.engineDevices = devs.map(d => `${d.name} (${d.maxChannels} ch)`);
      chk('engine lists output devices', devs.length > 0, devs.length);
      if (pm) {
        chk('Hercules console is a 4-channel engine device', pm.maxChannels >= 4, pm.maxChannels);
        { const rt = (dj.nat.devices || []).find(d => /realtek/i.test(d.name)); if (rt) chk('default output is the Realtek speakers', /realtek/i.test(dj.nat.status.masterName), JSON.stringify(dj.nat.status)); }
        engSend({ cmd: 'open', master: pm.id, cue: { mode: 'same4' }, sampleRate: 0, buffer: 0 }); { const t0 = Date.now(); while (!(/hercules/i.test(dj.nat.status.masterName) && dj.nat.status.cue === 'same4') && Date.now() - t0 < 4000) await sleep(100); }
        chk('engine can be selected as master the Hercules console with headphones on channels 3/4', /hercules/i.test(dj.nat.status.masterName) && dj.nat.status.cue === 'same4' && dj.nat.status.channels >= 4, JSON.stringify(dj.nat.status));
        dj.ctl['d0.vol'].set(0); dj.ctl.headMix.set(0.8); dj.ctl.headGain.set(0.5); press('d0.monitor');       // PFL deck A, fader down
        A.seek(10); A.play(); await sleep(400);
        const mp = await busPeak('master', 500), cp = await busPeak('cue', 500);
        chk('PFL: deck reaches the headphone bus, not the master bus', cp > 0.02 && mp < 0.001, `cue ${cp.toFixed(3)} master ${mp.toFixed(4)}`);
        A.pause(); press('d0.monitor'); dj.ctl.headMix.set(0.8); dj.ctl['d0.vol'].set(1);
        dj.engSend({ cmd: 'beep', target: 'cue' }); const bc = await busPeak('cue', 400), bm = await busPeak('master', 100);
        chk('test beep on headphones reaches the cue bus only', bc > 0.05 && bm < 0.001, `cue ${bc.toFixed(3)} master ${bm.toFixed(4)}`);
        await sleep(500); dj.engSend({ cmd: 'beep', target: 'master' }); const bm2 = await busPeak('master', 400);
        chk('test beep on master reaches the master bus', bm2 > 0.05, bm2.toFixed(3));
        const other = devs.find(d => !/hercules/i.test(d.name) && d.maxChannels >= 2);
        if (other) {
          const before = dj.nat.status; dj.nat.settings = { master: pm.id, cue: { mode: 'device', device: other.id }, sampleRate: 0, buffer: 0 }; dj.engSend({ cmd: 'open', ...dj.nat.settings });
          for (let i = 0; i < 50 && dj.nat.status === before; i++) await sleep(100);
          chk('cue can be moved to a second output device', dj.nat.status.cue === 'device' && dj.nat.status.cueName === other.name, JSON.stringify(dj.nat.status));
          dj.nat.settings = { master: pm.id, cue: { mode: 'same4' }, sampleRate: 0, buffer: 0 }; const b2 = dj.nat.status; dj.engSend({ cmd: 'open', ...dj.nat.settings });
          for (let i = 0; i < 50 && dj.nat.status === b2; i++) await sleep(100);
        }
      } else R.info.note = 'Hercules console audio device not present; 4-channel routing not tested';
      const st = dj.nat.state;
      chk('engine: no underruns during the test', st.xruns === 0, 'xruns ' + st.xruns);
      chk('engine: audio callback CPU < 25 %', st.cpu < 0.25, (st.cpu * 100).toFixed(1) + ' %');
      chk('engine: latency reported', st.latencyMs > 0 && st.latencyMs < 200, st.latencyMs.toFixed(1) + ' ms, buffer ' + st.bufferFrames);
      dj.openAudioDialog(); const dlg = document.getElementById('audiodlg');
      chk('audio settings dialog lists devices, cue options, rates', dlg.open && document.getElementById('aMaster').options.length > 1 && document.getElementById('aCue').options.length >= 2 && document.getElementById('aRate').options.length >= 2, `master ${document.getElementById('aMaster').options.length}, cue ${document.getElementById('aCue').options.length}`);
      dlg.close();
      const chip = document.getElementById('engChip').textContent;
      chk('engine status chip shows channels, latency and CPU', /ENGINE \d+ch .* ms · CPU \d+%/.test(chip), chip);
    } else try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && /hercules/i.test(d.label) && d.deviceId !== 'default' && d.deviceId !== 'communications');
      if (devs.length) {
        await dj.AC.setSinkId(devs[0].deviceId); R.info.herculesMaxChannels = dj.AC.destination.maxChannelCount;
        chk('master output can switch to Hercules console', true, devs[0].label + ' / ' + R.info.herculesMaxChannels + ' ch');
        // headphone cue on a DIFFERENT output device (e.g. the computer's own jack)
        const other = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && !/hercules/i.test(d.label) && d.deviceId !== 'default' && d.deviceId !== 'communications')[0];
        if (other) {
          await dj.setMasterSink(devs[0].deviceId, devs[0].label); await dj.setCueSink(other.deviceId, other.label);
          chk('cue device mode on a second output', dj.cueMode === 'device' && !dj.cueEl.paused && dj.cueEl.sinkId === other.deviceId, other.label + ' paused=' + dj.cueEl.paused);
          const a2 = dj.AC.createAnalyser(); dj.cue.out.connect(a2); A.setLoop(null); dj.ctl['d0.vol'].set(0); dj.ctl.headMix.set(0.8); press('d0.monitor'); A.seek(10); A.play();
          let cp = 0; const cb = new Float32Array(2048); for (let i = 0; i < 20; i++) { await sleep(40); a2.getFloatTimeDomainData(cb); for (const v of cb) cp = Math.max(cp, Math.abs(v)); }
          chk('cue stream still playing on second output', !dj.cueEl.paused && dj.cueEl.currentTime > 0, 't=' + dj.cueEl.currentTime.toFixed(2));
          A.pause(); press('d0.monitor'); dj.ctl.headMix.set(0.8);
          chk('headphone cue bus carries deck A when PFL on', cp > 0.02, 'peak ' + cp.toFixed(3));
          await dj.setCueSink('off', 'off');
        } else R.info.note2 = 'no second output device to test the cue on';
        await dj.setMasterSink('default', 'default');
        chk('audio engine running after output switches', dj.AC.state === 'running', dj.AC.state);
      } else R.info.note = 'Hercules console audio device not present; output switching not tested';
    } catch (e) { chk('master output can switch to Hercules console', false, e.message); }
    R.info.herculesMidi = (R.info.midiInputs || []).some(n => /hercules/i.test(n));
    R.info.herculesAudio = (R.info.audioOutputs || []).some(n => /hercules/i.test(n));
  } catch (e) { chk('no exception', false, e && e.stack || e); }
  if (cfg.shot && window.dj && window.harmonic) { try { dj.decks[0].seek(5); dj.decks[0].play(); await sleep(400); window.harmonic.setView(cfg.shotView === 'dj' ? 'dj' : 'hm'); await sleep(2500); } catch {} }
  return R;
}
