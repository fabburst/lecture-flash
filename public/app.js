(() => {
  const $ = id => document.getElementById(id);
  const DEFI = [250, 300, 375, 500, 750];
  let doc = null, words = [], i = 0, timer = null, playing = false, defi = false, defiStep = 0;
  let wpm = +localStorage.getItem('lf-wpm') || 300;
  $('speed').value = wpm;

  const countWords = t => t.split(/\s+/).filter(Boolean).length;
  const fmtTime = n => { const s = Math.round(n / wpm * 60 * 1.15); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0'); };

  function show(d) {
    doc = d; $('err').textContent = '';
    $('ttl').textContent = d.title || 'Texte';
    $('prev').textContent = d.text.slice(0, 320) + (d.text.length > 320 ? '…' : '');
    updateMeta(); $('info').hidden = false;
    $('info').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function updateMeta() { if (doc) { const n = countWords(doc.text); $('meta').textContent = `${n} mots · ≈ ${fmtTime(n)} à ${wpm} mots/min`; } }

  $('f').addEventListener('submit', async e => {
    e.preventDefault();
    const u = $('url').value.trim(); if (!u) return;
    $('go').disabled = true; $('go').textContent = 'Extraction…'; $('err').textContent = ''; $('info').hidden = true;
    try {
      const r = await fetch('/api/extract?url=' + encodeURIComponent(u));
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.text) throw new Error(j.error || 'Impossible de lire ce lien, colle le texte directement.');
      show(j);
    } catch (er) { $('err').textContent = er.message; $('raw').open = true; }
    finally { $('go').disabled = false; $('go').textContent = 'Extraire'; }
  });
  $('useTxt').onclick = () => { const t = $('txt').value.trim(); if (!t) return; show({ title: 'Texte collé', text: t }); };

  // tokenize: keep paragraph markers
  function tokenize(t) {
    const out = [];
    t.split(/\n\s*\n+/).forEach((p, pi, arr) => {
      const ws = p.split(/\s+/).filter(Boolean);
      ws.forEach((w, k) => out.push({ w, para: k === ws.length - 1 && pi < arr.length - 1 }));
    });
    return out;
  }
  const orpIdx = len => len <= 1 ? 0 : len <= 5 ? 1 : len <= 9 ? 2 : len <= 13 ? 3 : 4;

  const cv = document.createElement('canvas').getContext('2d');
  function render(tok) {
    const w = tok.w;
    // ORP on letters only (skip leading punctuation)
    const lead = (w.match(/^[^\p{L}\p{N}]*/u) || [''])[0].length;
    const core = w.slice(lead).replace(/[^\p{L}\p{N}]+$/u, '');
    const idx = Math.min(w.length - 1, lead + orpIdx(core.length || w.length));
    $('pre').textContent = w.slice(0, idx); $('orp').textContent = w[idx] || ''; $('post').textContent = w.slice(idx + 1);
    const el = $('word'); const cs = getComputedStyle(el);
    cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const pre = cv.measureText(w.slice(0, idx)).width, mid = cv.measureText(w[idx] || '').width;
    const st = $('stage').getBoundingClientRect();
    const focal = st.width * 0.42;
    el.style.left = (focal - pre - mid / 2) + 'px';
  }
  function delay(tok) {
    let d = 60000 / wpm;
    if (/[.!?;:…]["»”')\]]*$/.test(tok.w)) d *= 1.8; else if (/[,–—]["»”')\]]*$/.test(tok.w)) d *= 1.3;
    if (tok.w.length > 8) d *= 1 + Math.min(0.5, (tok.w.length - 8) * 0.06);
    if (tok.para) d += 60000 / wpm * 1.2;
    return d;
  }
  function setWpm(v, save = true) {
    wpm = v; $('speed').value = v; $('wpm').innerHTML = `<i>${v} mots/min</i>`;
    if (save) localStorage.setItem('lf-wpm', v); updateMeta();
  }
  function step() {
    if (!playing) return;
    if (i >= words.length) {
      if (defi && defiStep < DEFI.length - 1) { defiStep++; setWpm(DEFI[defiStep], false); i = 0; $('hint').textContent = 'Plus vite !'; timer = setTimeout(() => { $('hint').textContent = ''; step(); }, 1200); return; }
      pause(); $('hint').textContent = 'Terminé · ↺ pour relire'; i = words.length; return;
    }
    const tok = words[i]; render(tok); i++;
    $('bar').style.width = (i / words.length * 100) + '%';
    timer = setTimeout(step, delay(tok));
  }
  function play() { if (i >= words.length) i = 0; playing = true; $('hint').textContent = ''; step(); }
  function pause() { playing = false; clearTimeout(timer); $('hint').textContent = 'Pause · touchez pour reprendre'; }

  async function openReader() {
    if (!doc) return;
    words = tokenize(doc.text); i = 0; defi = false; defiStep = 0; $('defi').classList.remove('on');
    setWpm(wpm, false);
    $('reader').hidden = false; document.body.style.overflow = 'hidden';
    const r = document.documentElement;
    try { if (r.requestFullscreen) await r.requestFullscreen({ navigationUI: 'hide' }); else if (r.webkitRequestFullscreen) r.webkitRequestFullscreen(); } catch {}
    try { await document.fonts.ready; } catch {}
    render(words[0] || { w: '' }); $('bar').style.width = '0';
    $('hint').textContent = 'Touchez pour commencer';
  }
  function closeReader() {
    pause(); $('reader').hidden = true; document.body.style.overflow = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
  }
  $('lire').onclick = openReader;
  $('stage').onclick = () => playing ? pause() : play();
  $('exit').onclick = closeReader;
  $('restart').onclick = () => { const was = playing; pause(); i = 0; if (defi) { defiStep = 0; setWpm(DEFI[0], false); } render(words[0] || { w: '' }); $('bar').style.width = '0'; if (was) play(); };
  $('defi').onclick = () => { defi = !defi; $('defi').classList.toggle('on', defi); pause(); i = 0; defiStep = 0; setWpm(defi ? DEFI[0] : (+localStorage.getItem('lf-wpm') || 300), false); render(words[0] || { w: '' }); $('hint').textContent = defi ? 'Défi : 250 → 750 mots/min · touchez' : 'Touchez pour commencer'; };
  $('speed').addEventListener('input', e => setWpm(+e.target.value, !defi));
  window.addEventListener('resize', () => { if (!$('reader').hidden && words.length) render(words[Math.max(0, i - 1)]); });
  document.addEventListener('keydown', e => { if ($('reader').hidden) return; if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); } if (e.key === 'Escape') closeReader(); });
  setWpm(wpm, false);
  // share target / ?url=
  const q = new URLSearchParams(location.search).get('url') || new URLSearchParams(location.search).get('text');
  if (q) { const m = q.match(/https?:\/\/\S+/); if (m) { $('url').value = m[0]; $('f').requestSubmit(); } }
})();
