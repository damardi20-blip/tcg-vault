// Escáner de cartas, todo en el propio móvil y gratis:
// 1. Recorta la carta (busca sus bordes dentro del marco).
// 2. Compara la ilustración con la "huella" de las ~20.000 cartas del catálogo (data/sigs.bin).
// 3. Lee el número ("044/128") y el nombre con Tesseract.js.
// 4. Junta las dos pistas y confirma las mejores comparando con la imagen real de cada candidata.

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
  $('#scan-btn').onclick = () => { added = 0; open(); };
  $('#scanner-close').onclick = close;
  $('#scanner-shot').onclick = () => { noCard = 0; captureFromVideo(); };
  $('#scanner-photo').onclick = () => $('#scanner-file').click();
  $('#scanner-file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) captureFromFile(f); };
}

// Un mensaje con `hold` (ms) no se sobrescribe por los avisos automáticos durante ese tiempo.
let statusHold = 0;
function status(msg, hold = 0) {
  if (!hold && Date.now() < statusHold) return;
  if (hold) statusHold = Date.now() + hold;
  $('#scanner-status').textContent = msg;
}

let added = 0;   // cartas añadidas seguidas con «+» (escaneo en cadena)
async function open(msg = null) {
  $('#scanner').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  noCard = 0;
  statusHold = 0;
  if (msg) status(msg, 3000); else status('Encuadra la carta dentro del marco y pulsa el botón');
  // Con IA solo hace falta el índice de cartas. El lector de texto (~10 MB) y las huellas (~3 MB) del
  // escáner sin IA solo se descargan si no hay internet (o si la IA falla, al usarlos).
  ctx.loadCards().catch(() => {});
  if (!aiAvailable()) { getWorker().catch(() => {}); ctx.loadCards().then(loadSigs).catch(() => {}); }
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
    status('Encuadra la carta: se captura sola al dejarla quieta');
    autoScan();
  } catch (e) {
    console.warn(e);
    status('No se pudo abrir la cámara (revisa los permisos). Puedes pulsar «Foto».');
  }
}

function close() {
  clearTimeout(autoTimer);
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
// `margin`: cuánto se amplía el recorte alrededor del marco (0,3 = un 30 % más por cada lado), sin
// salirse del vídeo. Para la IA se usa con margen, por si la carta no cabe justa en el marco.
function cropFromVideo(maxH = 1400, margin = 0) {
  const v = $('#scanner-video');
  if (!v.videoWidth) return null;
  const box = v.getBoundingClientRect();
  const fr = $('#scanner-frame').getBoundingClientRect();
  const scale = Math.max(box.width / v.videoWidth, box.height / v.videoHeight);
  const offX = (box.width - v.videoWidth * scale) / 2;
  const offY = (box.height - v.videoHeight * scale) / 2;
  let sx = (fr.left - box.left - offX) / scale;
  let sy = (fr.top - box.top - offY) / scale;
  let sw = fr.width / scale;
  let sh = fr.height / scale;
  if (margin) {
    const x0 = Math.max(0, sx - sw * margin), y0 = Math.max(0, sy - sh * margin);
    const x1 = Math.min(v.videoWidth, sx + sw * (1 + margin)), y1 = Math.min(v.videoHeight, sy + sh * (1 + margin));
    sx = x0; sy = y0; sw = x1 - x0; sh = y1 - y0;
  }
  const c = document.createElement('canvas');
  const outH = Math.min(maxH, Math.round(sh));
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

async function captureFromVideo(hint = null) {
  if (busy) return;
  clearTimeout(autoTimer);
  const c = cropFromVideo();
  if (!c) { status('La cámara aún no está lista. Prueba otra vez o usa «Foto».'); return; }
  await analyze(c, true, hint, cropFromVideo(1400, 0.3));
}

// ---------- escaneo automático ----------
// Con la cámara abierta, cada medio segundo compara lo que ve con la huella de todas las cartas.
// Cuando la misma carta sale la primera 3 veces seguidas con un parecido claro, captura sola
// (con la imagen a máxima resolución) sin tener que pulsar el botón.
let autoTimer = null, noCard = 0;
function autoScan() {
  if (aiAvailable()) return steadyScan();
  return visualAutoScan();
}
// Con IA: cuando la imagen se queda quieta un momento (la carta está encuadrada), captura sola.
// Si dos veces seguidas no había carta, deja de capturar sola hasta que se pulse el botón.
function steadyScan() {
  let prev = null, still = 0;
  const tick = () => {
    if (!stream || busy) return;
    if (noCard >= 2) { status('Encuadra la carta y pulsa el botón'); return; }
    const c = cropFromVideo(48);
    if (c) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const g = new Float32Array(d.length / 4);
      let mean = 0;
      for (let i = 0; i < g.length; i++) { g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; mean += g[i]; }
      mean /= g.length;
      let varc = 0; for (const v of g) varc += (v - mean) ** 2;
      const detail = Math.sqrt(varc / g.length);
      let diff = 0;
      if (prev && prev.length === g.length) { for (let i = 0; i < g.length; i++) diff += Math.abs(g[i] - prev[i]); diff /= g.length; } else diff = 99;
      prev = g;
      if (diff < 4 && detail > 18) still++; else still = 0;
      status(still >= 2 ? 'Mantén la carta quieta…' : 'Encuadra la carta: se captura sola al dejarla quieta');
      if (still >= 4) { captureFromVideo(); return; }
    }
    autoTimer = setTimeout(tick, 300);
  };
  clearTimeout(autoTimer);
  autoTimer = setTimeout(tick, 800);
}
function visualAutoScan() {
  let lastId = null, streak = 0, misses = 0;
  const tick = async () => {
    if (!stream || busy) return;
    try {
      await ctx.loadCards();
      if (!(await loadSigs())) { autoTimer = setTimeout(tick, 800); return; }
      const c = cropFromVideo(560);
      if (c) {
        const vis = [...visualSearch(findCard(c, true), c).entries()].sort((a, b) => b[1] - a[1]);
        const [id, sim] = vis[0] || [];
        const margin = sim - (vis[1]?.[1] ?? 0);
        // Con una carta delante el parecido pasa de 1,18; con solo fondo no llega (medido con pruebas).
        // Si dos cartas tienen la misma ilustración (reimpresiones), el margen es ~0 y se exige algo más.
        if (id && sim >= (margin < 0.05 ? 1.2 : 1.18)) {
          streak = id === lastId || margin < 0.05 ? streak + 1 : 1;
          misses = 0;
          lastId = id;
          const card = ctx.cards().find(x => x.id === id);
          status(streak >= 2 ? `¿${ctx.cardName(card)}? Mantén la carta quieta…` : 'Buscando la carta…');
          if (streak >= 3) { captureFromVideo(id); return; }
        } else {
          streak = 0; lastId = null; misses++;
          status(misses > 12 ? '¿Reflejos? Inclina un poco la carta, o pulsa el botón para leerla igualmente'
            : 'Encuadra la carta: se captura sola cuando la reconozca');
        }
      }
    } catch (e) { console.warn(e); }
    autoTimer = setTimeout(tick, 450);
  };
  clearTimeout(autoTimer);
  autoTimer = setTimeout(tick, 600);
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

async function analyze(canvas, cropped, hint = null, wide = null) {
  busy = true;
  $('#scanner-shot').disabled = true;
  $('#scanner-frame').classList.add('busy');
  try {
    if (aiAvailable()) {
      status('Reconociendo la carta…');
      try {
        const info = await aiIdentify(wide || canvas);
        if (info && info.found === false) {
          status('No veo ninguna carta. Acércala al marco y pulsa el botón.');
          noCard++;
          return;
        }
        if (info) {
          await ctx.loadCards();
          const result = aiMatch(info);
          if (result.candidates.length) {
            await ctx.ensureSets([...new Set(result.candidates.map(c => c.card.set))]).catch(() => {});
            close();
            showResults(result, aiSummary(info));
            return;
          }
        }
      } catch (e) {
        console.warn('IA:', e);
        if (e.quota) status('Se ha agotado el uso gratuito de la IA por hoy; uso el escáner sin IA…');
      }
    }
    const { result, text } = await recognize(canvas, cropped, hint);
    close();
    showResults(result, text);
  } catch (e) {
    console.error(e);
    status('No se pudo leer la carta (¿sin conexión la primera vez?). Inténtalo de nuevo.');
  } finally {
    busy = false;
    $('#scanner-shot').disabled = false;
    $('#scanner-frame').classList.remove('busy');
    if (stream) setTimeout(() => stream && !busy && autoScan(), 1500);   // si no se reconoció y la cámara sigue abierta, sigue
  }
}

// Todo el reconocimiento (sin pantallas): también se usa para probar el escáner con fotos.
export async function recognize(canvas, cropped = true, hint = null) {
  const card = findCard(canvas, cropped);
  status('Preparando el lector…');
  const [worker] = await Promise.all([getWorker(), ctx.loadCards(), loadSigs().catch(() => null)]);
  status('Buscando la ilustración…');
  const visual = visualSearch(card, canvas);
  // La carta que el escaneo automático vio varias veces seguidas cuenta como pista fuerte.
  if (hint) visual.set(hint, Math.max(visual.get(hint) ?? 0, 1.2));
  status('Leyendo la carta…');
  const texts = [];
  // Número de carta: esquinas de abajo, solo dígitos y "/", bien ampliadas.
  await worker.setParameters({ tessedit_char_whitelist: '0123456789/', tessedit_pageseg_mode: '6' });
  texts.push((await worker.recognize(region(card, 0, 0.88, 0.5, 1, 3))).data.text);
  texts.push((await worker.recognize(region(card, 0.5, 0.88, 1, 1, 3))).data.text);
  // Nombre (arriba) y el resto del texto (idioma, ataques).
  await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' });
  texts.push((await worker.recognize(region(card, 0, 0, 1, 0.14, 2))).data.text);
  texts.push((await worker.recognize(region(card, 0, 0.5, 1, 1, 1.3))).data.text);
  const text = texts.join('\n');
  status('Buscando en el catálogo…');
  const result = match(text, visual);
  status('Comparando con las imágenes del catálogo…');
  await ctx.ensureSets([...new Set(result.candidates.map(c => c.card.set))]).catch(() => {});
  await visualRerank(result, card);
  return { result, text, card };
}


// ---------- reconocimiento con IA (Gemini, plan gratuito de Google) ----------
// La foto se envía a Gemini, que devuelve nombre, número, código e idioma de la carta; con eso se busca
// en el catálogo. Si no hay internet o falla, se usa el escáner sin IA (huellas + lector de texto).
// La foto va a un intermediario en Google Apps Script (scripts/intermediario-gemini.gs) que guarda la
// clave de Gemini en la cuenta de Google del dueño: la clave nunca está en la app ni en GitHub.
const AI = {
  proxy: 'https://script.google.com/macros/s/AKfycbyGhy_bLemfW4j33CsaOJg0nayze1Afm3yZ0C06yfSQogvhz8ex5BAu1XjcfTlypmt3/exec',
};
const AI_PROMPT = `Identify this Pokémon TCG card in the photo (it may be inside a sleeve or toploader, with reflections).
Return ONLY a JSON object with these fields:
- found: true if a Pokémon TCG card is clearly visible, false otherwise
- name_printed: the card name exactly as printed (in the card's language)
- name_en: the official English name of the card (e.g. "Galarian Meowth", "Crobat G", "Charizard ex")
- number: the collector number printed at the bottom before the slash (e.g. "141", "047", "TG12"); "" if not visible
- total: the number after the slash (e.g. "128"); "" if none
- set_code: the small set code printed near the number (e.g. "30C", "M6a", "SVI", "PAL"); "" if none
- language: one of es, en, it, ja, fr, de, pt, other
- set_name_en: the English name of the expansion if you know it
- anniversary_stamp: "30" if the card has the Pikachu "30" 30th anniversary logo, "25" if it has the 25th anniversary logo, "" otherwise`;
export const aiAvailable = () => !!AI.proxy && navigator.onLine !== false;

function toJpeg(canvas, max = 1024) {
  const k = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

export async function aiIdentify(canvas) {
  // text/plain para que el navegador no haga la consulta previa de CORS (Apps Script no la admite).
  const body = JSON.stringify({ image: toJpeg(canvas), prompt: AI_PROMPT });
  let lastErr = null;
  for (let tries = 0; tries < 2; tries++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    try {
      const res = await fetch(AI.proxy, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, signal: ctl.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (data.error === 'cuota') throw Object.assign(new Error('cuota'), { quota: true });
      if (data.error) { lastErr = new Error(data.error); continue; }
      const txt = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      let info = JSON.parse(txt.replace(/^```json|```$/g, '').trim());
      if (Array.isArray(info)) info = info[0];
      return info || null;
    } catch (e) {
      clearTimeout(timer);
      if (e.quota) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('IA no disponible');
}

// Puntúa cada carta del catálogo según lo que ha leído la IA.
export function aiMatch(info) {
  const sets = ctx.sets();
  const nn = x => norm(x).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();   // conserva letras japonesas
  const numN = x => String(x || '').toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1').trim();
  const num = numN(info.number), total = parseInt(info.total, 10) || null;
  const nameEn = nn(info.name_en), namePr = nn(info.name_printed);
  const code = nn(info.set_code).replace(/ /g, '');
  const lang = String(info.language || '').toLowerCase();
  const stamp = String(info.anniversary_stamp || '');
  const setWords = new Set(nn(info.set_name_en).split(' ').filter(w => w.length > 2).map(w => w.replace(/s$/, '')));
  // La IA confunde el logo del 25 y el del 30 aniversario: cualquiera de los dos apunta a estas colecciones.
  const STAMP_SETS = ['30th', '30th-c', 'M6a', 'cel25', 'cel25cc'];
  // Colecciones de reimpresiones que conservan el número original impreso (p. ej. Crobat G 47/127).
  const CLASSIC = ['30th-c', 'cel25cc'];
  const scored = [];
  for (const card of ctx.cards()) {
    const set = sets.get(card.set);
    if (!set) continue;
    let s = 0;
    const names = Object.values(card.name || {}).map(nn);
    if (names.some(n => n && (n === nameEn || n === namePr))) s += 6;
    else if (names.some(n => n && n.length >= 3 && ((nameEn && (nameEn.includes(n) || n.includes(nameEn))) || (namePr && (namePr.includes(n) || n.includes(namePr)))))) s += 3;
    if (s === 0) continue;   // sin coincidencia de nombre no es candidata
    if (num && numN(card.num) === num) { s += 5; if (total && (total === set.official || total === set.total)) s += 3; }
    const sc = nn(set.code).replace(/ /g, '');
    if (code && (code === sc || code === nn(set.id).replace(/ /g, ''))) s += 4;
    else if (code && code.length >= 2 && lev(code, sc) <= 1) s += 2;
    if (lang === 'ja') s += set.japanese ? 2 : -2; else if (lang && set.japanese) s -= 4;
    if (stamp) s += STAMP_SETS.includes(set.id) ? 6 : -6;   // con logo de aniversario no puede ser la carta original
    if (total && set.official && total !== set.official && total !== set.total) s += CLASSIC.includes(set.id) && stamp ? 2 : -3;
    if (setWords.size) {
      const w = new Set(nn(set.name?.en || '').split(' ').filter(x => x.length > 2).map(x => x.replace(/s$/, '')));
      let hit = 0; for (const x of setWords) if (w.has(x)) hit++;
      s += 3 * hit / Math.max(setWords.size, w.size || 1);
    }
    scored.push({ card, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const best = scored[0]?.s || 0;
  return { candidates: scored.filter(x => x.s >= Math.max(6, best - 6)).slice(0, 8), lang: ['es', 'en', 'it', 'ja'].includes(lang) ? lang : null, nums: [] };
}

const aiSummary = info => `Reconocida con IA: ${info.name_printed || info.name_en || '?'}${info.number ? ` · ${info.number}${info.total ? '/' + info.total : ''}` : ''}${info.set_code ? ` · ${info.set_code}` : ''}${info.language ? ` · ${info.language}` : ''}`;

// ---------- recorte automático ----------
// 1.º Separa la carta del fondo: el color del fondo se mide en el borde de la foto y la carta es lo que
//     se diferencia de él. 2.º Si no sale, busca las líneas rectas más marcadas cerca de cada lado.
// Si lo encontrado no tiene forma de carta (63×88 mm), se usa la imagen tal cual.
export function findCard(src, cropped) {
  const W = 200, H = Math.round(W * src.height / src.width);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const box = byBackground(d, W, H) || byEdges(d, W, H);
  if (!box) return src;
  let [left, top, right, bottom] = box;
  const w = right - left, h = bottom - top;
  if (w / h < 0.6 || w / h > 0.84 || (w * h) / (W * H) < (cropped ? 0.25 : 0.1)) return src;
  const k = src.width / W;
  const out = document.createElement('canvas');
  out.width = Math.round(w * k); out.height = Math.round(h * k);
  out.getContext('2d').drawImage(src, left * k, top * k, w * k, h * k, 0, 0, out.width, out.height);
  return out;
}
function byBackground(d, W, H) {
  // Color de fondo: mediana de los píxeles del borde exterior de la foto.
  const border = [];
  for (let x = 0; x < W; x += 2) for (const y of [0, 1, H - 2, H - 1]) border.push(y * W + x);
  for (let y = 0; y < H; y += 2) for (const x of [0, 1, W - 2, W - 1]) border.push(y * W + x);
  const med = ch => { const v = border.map(i => d[i * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  const spread = Math.sqrt(border.reduce((s, i) => s + (d[i * 4] - bg[0]) ** 2 + (d[i * 4 + 1] - bg[1]) ** 2 + (d[i * 4 + 2] - bg[2]) ** 2, 0) / border.length);
  if (spread > 60) return null;   // el borde no es un fondo uniforme (la carta llena el marco)
  const thr = Math.max(45, spread * 2.2);
  const rows = new Float32Array(H), cols = new Float32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) > thr) { rows[y]++; cols[x]++; }
  }
  const span = (prof, n, other) => {
    let a = 0, b = n - 1;
    while (a < n && prof[a] < other * 0.25) a++;
    while (b > a && prof[b] < other * 0.25) b--;
    return b - a > n * 0.2 ? [a, b + 1] : null;
  };
  const ys = span(rows, H, W), xs = span(cols, W, H);
  if (!ys || !xs) return null;
  if ((xs[1] - xs[0]) > W * 0.97 && (ys[1] - ys[0]) > H * 0.97) return null;   // ya es toda la carta
  return [xs[0], ys[0], xs[1], ys[1]];
}
function byEdges(d, W, H) {
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const rows = new Float32Array(H), cols = new Float32Array(W);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    rows[y] += Math.abs(L[i + W] - L[i - W]);
    cols[x] += Math.abs(L[i + 1] - L[i - 1]);
  }
  const edge = (prof, from, to, outerFirst) => {
    let max = 0;
    for (let i = from; i < to; i++) max = Math.max(max, prof[i]);
    if (!max) return null;
    const idx = [];
    for (let i = from; i < to; i++) idx.push(i);
    if (!outerFirst) idx.reverse();
    return idx.find(i => prof[i] >= max * 0.55) ?? null;
  };
  const m = 0.32;
  const box = [edge(cols, 1, Math.round(W * m), true), edge(rows, 1, Math.round(H * m), true),
    edge(cols, Math.round(W * (1 - m)), W - 1, false), edge(rows, Math.round(H * (1 - m)), H - 1, false)];
  return box.some(v => v == null) ? null : box;
}

// ---------- búsqueda visual en todo el catálogo ----------
const FP_W = 8, FP_H = 6, FP_LEN = FP_W * FP_H * 3, CELLS = FP_W * FP_H, DROP = 12;
const cell = new Float32Array(CELLS);
let sigsPromise = null;
export function loadSigs() {
  if (!sigsPromise) {
    sigsPromise = fetch(ctx.sigsUrl).then(r => (r.ok ? r.arrayBuffer() : null)).then(b => (lastSigs = b ? new Int8Array(b) : null));
    sigsPromise.catch(() => { sigsPromise = null; });
  }
  return sigsPromise;
}
// Reduce poco a poco (a saltos de la mitad) para que se parezca a cómo se calculó la huella en el servidor.
function shrink(src, sx, sy, sw, sh, W, H) {
  let c = document.createElement('canvas'), w = sw, h = sh;
  c.width = Math.max(W, Math.round(sw)); c.height = Math.max(H, Math.round(sh));
  c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  while (c.width / 2 >= W && c.height / 2 >= H) {
    const n = document.createElement('canvas');
    n.width = Math.round(c.width / 2); n.height = Math.round(c.height / 2);
    const g = n.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(c, 0, 0, n.width, n.height);
    c = n;
  }
  const f = document.createElement('canvas');
  f.width = W; f.height = H;
  const g = f.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, W, H);
  return g.getImageData(0, 0, W, H).data;
}
function fingerprint(src) {
  const w = src.width, h = src.height;
  const d = shrink(src, w * 0.09, h * 0.11, w * 0.82, h * 0.40, FP_W, FP_H);
  const n = FP_W * FP_H, v = new Float32Array(FP_LEN);
  for (let ch = 0; ch < 3; ch++) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += d[i * 4 + ch];
    mean /= n;
    let sd = 0;
    for (let i = 0; i < n; i++) sd += (d[i * 4 + ch] - mean) ** 2;
    sd = Math.sqrt(sd / n) || 1;
    for (let i = 0; i < n; i++) v[ch * n + i] = ((d[i * 4 + ch] - mean) / sd) * 40;
  }
  return v;
}
// Devuelve un mapa id de carta → parecido con las 60 más parecidas de todo el catálogo
// (≈1,2 o más si es la misma carta; ≈0,9-1,1 si no se parece).
export function visualSearch(photo, alt = null) {
  const out = new Map();
  const all = ctx.cards();
  const sigs = sigsPromise && lastSigs;
  if (!sigs || sigs.length < all.length * FP_LEN) return out;
  // Varias versiones del recorte (por si los bordes no son exactos): se queda con el mejor parecido.
  // y, si el recorte automático pudo equivocarse, también la imagen sin recortar.
  const fps = [photo, alt].filter((x, i) => x && (i === 0 || x !== photo)).flatMap(src => [0, 0.03, -0.03].map(m => fingerprint(inset(src, m))));
  const top = [];
  for (let k = 0; k < all.length; k++) {
    const o = k * FP_LEN;
    let nz = 0;
    for (let i = 0; i < FP_LEN; i += 7) nz |= sigs[o + i];
    if (!nz) continue;
    let sim = -1;
    for (const fp of fps) {
      // Parecido por zonas: se descartan las 12 zonas (de 48) que menos se parecen, que suelen ser
      // reflejos de luz o la funda. Así un brillo en la foto no estropea la comparación.
      for (let j = 0; j < CELLS; j++) cell[j] = sigs[o + j] * fp[j] + sigs[o + CELLS + j] * fp[CELLS + j] + sigs[o + 2 * CELLS + j] * fp[2 * CELLS + j];
      cell.sort();
      let s = 0;
      for (let j = DROP; j < CELLS; j++) s += cell[j];
      if (s > sim) sim = s;
    }
    sim /= (CELLS - DROP) * 3 * 1600;
    if (top.length < 60 || sim > top[top.length - 1][1]) {
      top.push([k, sim]); top.sort((a, b) => b[1] - a[1]); if (top.length > 60) top.pop();
    }
  }
  for (const [k, sim] of top) out.set(all[k].id, sim);
  return out;
}
let lastSigs = null;
// Recorte con margen (m > 0 quita borde, m < 0 añade).
function inset(src, m) {
  if (!m) return src;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const dx = src.width * m, dy = src.height * m;
  c.getContext('2d').drawImage(src, dx, dy, src.width - 2 * dx, src.height - 2 * dy, 0, 0, c.width, c.height);
  return c;
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

export function match(rawText, visual = new Map()) {
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
    // Parecido de la ilustración con todo el catálogo (las 60 más parecidas).
    const vis = visual.get(card.id);
    if (vis != null) s += Math.max(0, vis - 0.9) * 30;
    if (s >= 3 || (vis != null && vis > 1.0)) scored.push({ card, s, vis });
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
  list = list.slice(0, 25);
  const queue = [...list];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const item = queue.shift();
      item.card = ctx.full(item.card.id) || item.card;
      const sig = await cardSignature(item.card, result.lang);
      item.sim = sig ? similarity(photoSig, sig) : 0;
      item.s += Math.max(0, item.sim) * 20;
    }
  }));
  list.sort((a, b) => b.s - a.s);
  // Sin texto, solo nos quedamos con parecidos claros.
  result.candidates = list.filter(x => x.s >= 4 || x.sim > 0.5).slice(0, 8);
}

function showResults({ candidates, lang }, text) {
  ctx.openSheet(el => {
    const list = candidates.map(({ card }) => {
      const l = lang && (ctx.sets().get(card.set).langs.includes(lang)) ? lang : null;
      const price = ctx.price(card, l);
      return `<div class="cand-row"><button class="cand" data-id="${esc(card.id)}" data-lang="${l || ''}">${ctx.thumbHTML(card, l || undefined)}
        <div class="info"><b>${esc(ctx.cardName(card, l || undefined))}</b><span class="muted">${esc(ctx.cardCode(card))}</span></div>
        <div class="price">${ctx.eur(price)}</div></button>
        <button class="cand-add" data-id="${esc(card.id)}" data-lang="${l || ''}" aria-label="Añadir y escanear la siguiente">+</button></div>`;
    }).join('');
    el.innerHTML = `<div class="scan-results">
      <h2>${candidates.length ? (candidates.length === 1 || candidates[0].s - (candidates[1]?.s || 0) >= 3 ? '¿Es esta carta?' : '¿Cuál de estas es?') : 'No he reconocido la carta'}</h2>
      ${candidates.length ? '<div class="note">Pulsa <b>+</b> para añadirla (1 copia, NM) y escanear la siguiente, o pulsa la carta para ver su ficha.</div>' : ''}
      ${lang ? `<div class="note">Parece una carta en ${({ es: 'español', en: 'inglés', it: 'italiano', ja: 'japonés' })[lang]}.</div>` : ''}
      ${list || '<p class="muted">Prueba con más luz, sin reflejos y con la carta llenando el marco. También puedes buscarla por nombre o número.</p>'}
      <div class="form" style="margin-top:14px">
        <input id="scan-q" type="search" placeholder="Buscar a mano: nombre o número (ej. 044)">
        <div id="scan-q-res"></div>
        <button class="btn secondary block" id="scan-again">Escanear otra vez</button>
      </div>
      <details style="margin-top:12px"><summary class="muted">${text.startsWith('Reconocida con IA') ? 'Qué ha leído la IA' : 'Texto leído'}</summary><div class="ocr-text">${esc(text.trim() || '(nada)')}</div></details>
    </div>`;
    el.querySelectorAll('.cand').forEach(b => b.onclick = () => ctx.openCard(b.dataset.id, b.dataset.lang || null));
    // Escaneo en cadena: «+» añade la carta (1 copia, NM) y vuelve a abrir la cámara para la siguiente.
    el.querySelectorAll('.cand-add').forEach(b => b.onclick = async () => {
      b.disabled = true;
      const msg = await ctx.quickAdd(b.dataset.id, b.dataset.lang || null);
      ctx.closeScannerSheet();
      added++;
      open(msg ? `✓ ${msg} · ${added} en esta sesión. Siguiente carta…` : null);
    });
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

// Para pruebas: parecido de una imagen con una carta concreta del catálogo (según su huella).
export function simTo(photo, id) {
  const all = ctx.cards(), k = all.findIndex(c => c.id === id);
  if (k < 0 || !lastSigs) return null;
  const fp = fingerprint(photo), o = k * FP_LEN;
  let s = 0, nz = 0;
  for (let i = 0; i < FP_LEN; i++) { s += lastSigs[o + i] * fp[i]; nz |= lastSigs[o + i]; }
  return nz ? s / (FP_LEN * 1600) : 'sin huella';
}
