// Escáner de cartas: abre la cámara, recorta la carta del marco y lee el texto
// (nombre y número "044/128") con Tesseract.js, todo en el propio móvil y gratis.
// Después busca en el catálogo las cartas que mejor encajan.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let ctx = null;          // funciones que nos pasa app.js
let stream = null;
let workerPromise = null;
let busy = false;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function initScanner(context) {
  ctx = context;
  $('#scan-btn').onclick = open;
  $('#scanner-close').onclick = close;
  $('#scanner-shot').onclick = captureFromVideo;
  $('#scanner-photo').onclick = () => $('#scanner-file').click();
  $('#scanner-file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) captureFromFile(f); };
}

function status(msg) { $('#scanner-status').textContent = msg; }

async function open() {
  $('#scanner').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  status('Encuadra la carta dentro del marco y pulsa el botón');
  getWorker().catch(() => {});   // empieza a descargar el lector de texto mientras tanto
  if (!navigator.mediaDevices?.getUserMedia) {
    status('Este navegador no permite usar la cámara aquí. Pulsa «Foto».');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
    });
    const v = $('#scanner-video');
    v.srcObject = stream;
    await v.play().catch(() => {});
  } catch (e) {
    console.warn(e);
    status('No se pudo abrir la cámara (revisa los permisos). Puedes pulsar «Foto».');
  }
}

function close() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  $('#scanner-video').srcObject = null;
  $('#scanner').classList.add('hidden');
  $('#scanner-frame').classList.remove('busy');
  document.body.style.overflow = '';
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (!window.Tesseract) await loadScript(TESSERACT_URL);
      return window.Tesseract.createWorker('eng');
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

// Recorta del vídeo la zona del marco amarillo (el vídeo se muestra con object-fit: cover).
function cropFromVideo() {
  const v = $('#scanner-video');
  if (!v.videoWidth) return null;
  const box = v.getBoundingClientRect();
  const fr = $('#scanner-frame').getBoundingClientRect();
  const scale = Math.max(box.width / v.videoWidth, box.height / v.videoHeight);
  const offX = (box.width - v.videoWidth * scale) / 2;
  const offY = (box.height - v.videoHeight * scale) / 2;
  const sx = (fr.left - box.left - offX) / scale;
  const sy = (fr.top - box.top - offY) / scale;
  const sw = fr.width / scale;
  const sh = fr.height / scale;
  const c = document.createElement('canvas');
  const outH = Math.min(1400, Math.round(sh));
  c.height = outH;
  c.width = Math.round(outH * (sw / sh));
  c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

// Saca un trozo de la carta (en proporciones 0-1), ampliado y en escala de grises con más contraste.
function region(src, x0, y0, x1, y1, upscale = 2) {
  const w = Math.round((x1 - x0) * src.width), h = Math.round((y1 - y0) * src.height);
  const c = document.createElement('canvas');
  c.width = w * upscale; c.height = h * upscale;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, x0 * src.width, y0 * src.height, w, h, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    l = Math.max(0, Math.min(255, (l - 128) * 1.5 + 128));
    d[i] = d[i + 1] = d[i + 2] = l;
  }
  g.putImageData(img, 0, 0);
  return c;
}

async function captureFromVideo() {
  if (busy) return;
  const c = cropFromVideo();
  if (!c) { status('La cámara aún no está lista. Prueba otra vez o usa «Foto».'); return; }
  await analyze(c, true);
}

async function captureFromFile(file) {
  if (busy) return;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) { status('No se pudo leer la foto.'); return; }
  const max = 1600;
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  await analyze(c, false);
}

async function analyze(canvas, cropped) {
  busy = true;
  $('#scanner-shot').disabled = true;
  $('#scanner-frame').classList.add('busy');
  try {
    status('Preparando el lector de texto…');
    const worker = await getWorker();
    status('Leyendo la carta…');
    const texts = [];
    if (cropped) {
      // Parte de abajo (número de carta) y parte de arriba (nombre), ampliadas; y la carta entera.
      texts.push((await worker.recognize(region(canvas, 0, 0.86, 1, 1, 2.5))).data.text);
      texts.push((await worker.recognize(region(canvas, 0, 0, 1, 0.13, 2))).data.text);
      texts.push((await worker.recognize(region(canvas, 0, 0, 1, 1, 1))).data.text);
    } else {
      texts.push((await worker.recognize(region(canvas, 0, 0, 1, 1, 1))).data.text);
      texts.push((await worker.recognize(region(canvas, 0, 0.55, 1, 1, 1.6))).data.text);
    }
    const text = texts.join('\n');
    status('Buscando en el catálogo…');
    await ctx.loadCards();
    const result = match(text);
    status('Comparando con las imágenes del catálogo…');
    await visualRerank(result, canvas);
    await ctx.ensureSets(result.candidates.map(c => c.card.set)).catch(() => {});
    close();
    showResults(result, text);
  } catch (e) {
    console.error(e);
    status('No se pudo leer la carta (¿sin conexión la primera vez?). Inténtalo de nuevo.');
  } finally {
    busy = false;
    $('#scanner-shot').disabled = false;
    $('#scanner-frame').classList.remove('busy');
  }
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

// Palabras típicas de cada idioma para adivinar en qué idioma está la carta.
const LANG_HINTS = {
  es: ['basico', 'debilidad', 'resistencia', 'retirada', 'ilus', 'evoluciona', 'entrenador', 'partidario', 'objeto', 'energia basica'],
  en: ['basic', 'weakness', 'resistance', 'retreat', 'evolves', 'trainer', 'supporter', 'item', 'stage', 'illus'],
  it: ['base', 'debolezza', 'resistenza', 'ritirata', 'evoluzione', 'allenatore', 'aiuto', 'strumento', 'fase', 'illustr'],
};

export function match(rawText) {
  const text = norm(rawText);
  // Los "/" a veces se leen como "|", "\", "l" o "1" pegado.
  const nums = [...rawText.matchAll(/(\d{1,3})\s*[\/|\\]\s*(\d{2,3})/g)].map(m => ({ n: parseInt(m[1], 10), total: parseInt(m[2], 10) }));
  const loose = new Set([...rawText.matchAll(/\b(\d{3})\b/g)].map(m => parseInt(m[1], 10)));
  const words = [...new Set(text.split(/[^a-z0-9']+/).filter(w => w.length >= 4 && w.length <= 16))];

  let lang = null, best = 0;
  for (const [l, hints] of Object.entries(LANG_HINTS)) {
    const s = hints.filter(h => text.includes(h)).length;
    if (s > best) { best = s; lang = l; }
  }

  const sets = ctx.sets();
  const scored = [];
  for (const card of ctx.cards()) {
    let s = 0;
    const set = sets.get(card.set);
    const n = parseInt(card.num, 10);
    for (const x of nums) {
      const totalOk = x.total === set.official || x.total === set.total;
      if (x.n === n) { s += 5; if (totalOk) s += 3; }
      else if (!isNaN(n) && oneDigitOff(x.n, n)) s += totalOk ? 3 : 1;   // el lector a veces confunde un dígito (044 → 034)
    }
    if (!nums.length && loose.has(n)) s += 2;
    let nameHit = 0;
    // Nombres normalizados (se calculan una vez por carta)
    if (!card._nn) card._nn = Object.entries(card.name || {}).filter(([l, nm]) => l !== 'ja' && nm).map(([, nm]) => {
      const nn = norm(nm);
      return [nn, nn.split(/\s+/).sort((a, b) => b.length - a.length)[0]];
    });
    for (const [nn, first] of card._nn) {
      if (nn.length >= 3 && text.includes(nn)) { nameHit = Math.max(nameHit, 4 + Math.min(nn.length / 5, 2)); continue; }
      if (first && first.length >= 4) for (const w of words) {
        if (w[0] !== first[0] && w[1] !== first[1]) continue;
        const d = lev(w, first);
        if (d <= (first.length >= 7 ? 2 : 1)) { nameHit = Math.max(nameHit, 3); break; }
      }
    }
    s += nameHit;
    if (s >= 3) scored.push({ card, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return { candidates: scored.slice(0, 40), lang, nums };
}

function oneDigitOff(a, b) {
  const x = String(a).padStart(3, '0'), y = String(b).padStart(3, '0');
  let d = 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) d++;
  return d === 1;
}

// ---------- comparación visual ----------
// Reduce la ilustración de la carta a una miniatura de 16×12 colores normalizados
// (así importa poco la luz de la foto) y la compara con la de cada candidata.
const SIG_W = 16, SIG_H = 12;
const sigCache = new Map();

function signature(src) {
  const c = document.createElement('canvas');
  c.width = SIG_W; c.height = SIG_H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  const w = src.width, h = src.height;
  g.drawImage(src, w * 0.09, h * 0.11, w * 0.82, h * 0.40, 0, 0, SIG_W, SIG_H);   // zona de la ilustración
  const d = g.getImageData(0, 0, SIG_W, SIG_H).data;
  const n = SIG_W * SIG_H, v = new Float32Array(n * 3);
  for (let ch = 0; ch < 3; ch++) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += d[i * 4 + ch];
    mean /= n;
    let sd = 0;
    for (let i = 0; i < n; i++) sd += (d[i * 4 + ch] - mean) ** 2;
    sd = Math.sqrt(sd / n) || 1;
    for (let i = 0; i < n; i++) v[ch * n + i] = (d[i * 4 + ch] - mean) / sd;
  }
  return v;
}

function similarity(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / a.length;   // correlación: 1 = idénticas, 0 = nada que ver
}

async function cardSignature(card, lang) {
  const url = ctx.imgUrl(card, lang, 'low');
  if (!url) return null;
  if (sigCache.has(url)) return sigCache.get(url);
  const p = fetch(url).then(r => (r.ok ? r.blob() : null)).then(b => (b ? createImageBitmap(b) : null))
    .then(bmp => (bmp ? signature(bmp) : null)).catch(() => null);
  sigCache.set(url, p);
  return p;
}

export async function visualRerank(result, photo) {
  const photoSig = signature(photo);
  let list = result.candidates;
  // Si el texto no dio pistas, se compara con las cartas de la colección abierta en el catálogo.
  if (!list.length) list = ctx.fallbackCards().map(card => ({ card, s: 0 }));
  const queue = [...list];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const sig = await cardSignature(item.card, result.lang);
      item.sim = sig ? similarity(photoSig, sig) : 0;
      item.s += Math.max(0, item.sim) * 20;
    }
  }));
  list.sort((a, b) => b.s - a.s);
  // Sin texto, solo nos quedamos con parecidos claros.
  result.candidates = list.filter(x => x.s >= 4 || x.sim > 0.55).slice(0, 8);
}

function showResults({ candidates, lang }, text) {
  ctx.openSheet(el => {
    const list = candidates.map(({ card }) => {
      const l = lang && (ctx.sets().get(card.set).langs.includes(lang)) ? lang : null;
      const price = ctx.price(card, l);
      return `<button class="cand" data-id="${esc(card.id)}" data-lang="${l || ''}">${ctx.thumbHTML(card, l || undefined)}
        <div class="info"><b>${esc(ctx.cardName(card, l || undefined))}</b><span class="muted">${esc(ctx.cardCode(card))}</span></div>
        <div class="price">${ctx.eur(price)}</div></button>`;
    }).join('');
    el.innerHTML = `<div class="scan-results">
      <h2>${candidates.length ? (candidates.length === 1 || candidates[0].s - (candidates[1]?.s || 0) >= 3 ? '¿Es esta carta?' : '¿Cuál de estas es?') : 'No he reconocido la carta'}</h2>
      ${lang ? `<div class="note">Parece una carta en ${({ es: 'español', en: 'inglés', it: 'italiano' })[lang]}.</div>` : ''}
      ${list || '<p class="muted">Prueba con más luz, sin reflejos y con la carta llenando el marco. También puedes buscarla por nombre o número.</p>'}
      <div class="form" style="margin-top:14px">
        <input id="scan-q" type="search" placeholder="Buscar a mano: nombre o número (ej. 044)">
        <div id="scan-q-res"></div>
        <button class="btn secondary block" id="scan-again">Escanear otra vez</button>
      </div>
      <details style="margin-top:12px"><summary class="muted">Texto leído</summary><div class="ocr-text">${esc(text.trim() || '(nada)')}</div></details>
    </div>`;
    el.querySelectorAll('.cand').forEach(b => b.onclick = () => ctx.openCard(b.dataset.id, b.dataset.lang || null));
    el.querySelector('#scan-again').onclick = () => { ctx.closeScannerSheet(); open(); };
    const q = el.querySelector('#scan-q');
    q.oninput = () => {
      const v = norm(q.value).trim();
      const res = el.querySelector('#scan-q-res');
      if (!v) { res.innerHTML = ''; return; }
      const found = ctx.cards().filter(c => {
        if (/^\d+$/.test(v)) return parseInt(c.num, 10) === parseInt(v, 10);
        return Object.values(c.name || {}).some(n => norm(n).includes(v));
      }).slice(0, 12);
      res.innerHTML = found.map(card => `<button class="cand" data-id="${esc(card.id)}">${ctx.thumbHTML(card)}<div class="info"><b>${esc(ctx.cardName(card))}</b><span class="muted">${esc(ctx.cardCode(card))}</span></div><div class="price">${ctx.eur(ctx.price(card))}</div></button>`).join('') || '<p class="muted">Sin resultados.</p>';
      res.querySelectorAll('.cand').forEach(b => b.onclick = () => ctx.openCard(b.dataset.id));
    };
  });
}
