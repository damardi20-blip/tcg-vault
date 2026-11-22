// Análisis de centrado de una carta, en el propio móvil.
// 1. Foto de la carta (de frente). 2. La app propone 8 líneas: 4 en el borde exterior de la carta y 4 en el
// borde interior del marco. 3. Se ajustan arrastrando (con lupa) o con los botones de 1 píxel.
// 4. Calcula izquierda/derecha y arriba/abajo y la nota máxima por centrado en PSA, BGS, SGC, CGC y TAG.

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Nota máxima según el lado más ancho (%), de las normas públicas de cada empresa (orientativo).
// Cada fila: [nota, % máximo del lado más ancho].
const GRADES = {
  PSA: { front: [[10, 55], [9, 60], [8, 65], [7, 70], [6, 80], [5, 85], [3, 90], [1, 100]], back: [[10, 75], [9, 90], [1, 100]] },
  BGS: { front: [[10, 50], [9.5, 55], [9, 60], [8.5, 65], [8, 70], [7, 75], [6, 80], [5, 85], [4, 90], [1, 100]], back: [[10, 55], [9.5, 60], [9, 80], [8.5, 90], [8, 95], [1, 100]] },
  SGC: { front: [[10, 55], [9.5, 60], [9, 65], [8.5, 70], [7, 75], [6, 80], [5, 85], [4, 90], [1, 100]], back: [[10, 70], [9.5, 75], [9, 80], [8, 85], [7, 90], [1, 100]] },
  CGC: { front: [[10, 55], [9.5, 60], [9, 62.5], [8.5, 65], [8, 70], [7, 75], [6, 80], [5, 85], [4, 90], [1, 100]], back: [[10, 75], [9.5, 80], [9, 85], [8, 90], [1, 100]] },
  TAG: { front: [[10, 55], [9, 60], [8, 65], [7, 70], [6, 75], [5, 80], [4, 85], [3, 90], [1, 100]], back: [[10, 75], [9, 85], [8, 90], [1, 100]] },
};
export function gradeFor(company, side, worst) {
  for (const [g, max] of GRADES[company][side]) if (worst <= max + 1e-9) return g;
  return 1;
}
const pct = (a, b) => (a + b > 0 ? (a / (a + b)) * 100 : 50);
export function centeringOf(o, i) {
  const l = i.l - o.l, r = o.r - i.r, t = i.t - o.t, b = o.b - i.b;
  const lr = [pct(l, r), pct(r, l)], tb = [pct(t, b), pct(b, t)];
  return { lr, tb, worst: Math.max(...lr, ...tb) };
}
const fmt = v => v.toFixed(1).replace('.', ',');

let st = null;   // estado de la pantalla abierta

// `image` (opcional): un lienzo con la foto ya hecha (p. ej. desde la cámara del escáner); si no, se pide.
// `onClose` (opcional): se llama al cerrar (el escáner lo usa para volver a la cámara).
export function openCentering({ title, items = [], onSave, toast, image = null, onClose = null }) {
  st = { title, items, onSave, toast, onClose, side: 'front', mode: 'normal', img: null, o: null, i: null, sel: null, drag: null, results: {} };
  let el = $('#cent');
  if (!el) { el = document.createElement('div'); el.id = 'cent'; el.className = 'cent'; document.body.appendChild(el); }
  document.body.style.overflow = 'hidden';
  if (image) { st.img = image; autoDetect(); renderEditor(); } else renderStart();
}
function close() {
  const after = st?.onClose;
  $('#cent')?.remove();
  document.body.style.overflow = '';
  st = null;
  after?.();
}

function header() {
  return `<div class="cent-bar"><b>Centrado${st.title ? ' · ' + esc(st.title) : ''}</b><button class="icon-btn" id="cent-close" type="button" aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
}
function sideSeg() {
  return `<div class="seg small" id="cent-side"><button data-s="front" class="${st.side === 'front' ? 'on' : ''}">Delante</button><button data-s="back" class="${st.side === 'back' ? 'on' : ''}">Detrás</button></div>`;
}

function renderStart() {
  const el = $('#cent');
  el.innerHTML = `${header()}
    <div class="cent-body">
      ${sideSeg()}
      <p class="muted" style="margin:14px 0 8px">Haz una foto de la carta <b>de frente</b>, que se vea entera y con algo de fondo alrededor. Mejor sin funda gruesa y sin reflejos.</p>
      <div class="cent-pick">
        <label class="btn">Hacer foto<input type="file" accept="image/*" capture="environment" hidden id="cent-cam"></label>
        <label class="btn secondary">Elegir de la galería<input type="file" accept="image/*" hidden id="cent-gal"></label>
      </div>
      ${Object.keys(st.results).length ? summaryHTML() : ''}
    </div>`;
  el.querySelector('#cent-close').onclick = close;
  el.querySelector('#cent-side').onclick = e => { const b = e.target.closest('[data-s]'); if (b) { st.side = b.dataset.s; renderStart(); } };
  for (const id of ['#cent-cam', '#cent-gal']) el.querySelector(id).onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) await loadImage(f);
  };
  if (Object.keys(st.results).length) renderSaveBox();
}

async function loadImage(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) { st.toast?.('No se pudo leer la foto'); return; }
  const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  st.img = c;
  autoDetect();
  renderEditor();
}

// ---------- detección automática ----------
// Perfiles de "cuánto cambia la luz" por columna y por fila (solo en la franja central, para no hacer caso
// al fondo de arriba/abajo o de los lados). El borde exterior de la carta es el salto fuerte más externo;
// el borde interior del marco es el salto más fuerte un poco más adentro.
function autoDetect() {
  const src = st.img;
  const W = 420, H = Math.round(W * src.height / src.width), k = src.width / W;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const L = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) L[p] = 0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2];
  const colProf = (y0, y1, x0 = 1, x1 = W - 1) => { const p = new Float32Array(W); for (let y = y0; y < y1; y++) for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) p[x] += Math.abs(L[y * W + x + 1] - L[y * W + x - 1]); return p; };
  const rowProf = (x0, x1, y0 = 1, y1 = H - 1) => { const p = new Float32Array(H); for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) for (let x = x0; x < x1; x++) p[y] += Math.abs(L[(y + 1) * W + x] - L[(y - 1) * W + x]); return p; };
  const peak = (p, a, b, outerFirst, frac = 0.5) => {
    a = Math.max(1, Math.round(a)); b = Math.min(p.length - 2, Math.round(b));
    let max = 0; for (let i = a; i <= b; i++) max = Math.max(max, p[i]);
    if (!max) return null;
    const idx = []; for (let i = a; i <= b; i++) idx.push(i);
    if (!outerFirst) idx.reverse();
    return idx.find(i => p[i] >= max * frac && p[i] >= p[i - 1] && p[i] >= p[i + 1]) ?? null;
  };

  // Borde exterior: de cada lado se toman los 6 saltos más fuertes y se elige la combinación con forma de
  // carta (63×88 mm), para no confundirla con la funda, el toploader o la carpeta.
  // Borde exterior: se mide el color del fondo en el contorno de la foto y la carta es lo que se diferencia
  // de él (funciona con la carta sobre una mesa o un fondo liso). Solo se acepta si sale un rectángulo con
  // forma de carta; si no, se colocan las líneas en un rectángulo de carta centrado para ajustarlas a mano.
  const border = [];
  for (let x = 0; x < W; x += 2) for (const y of [0, 1, 2, H - 3, H - 2, H - 1]) border.push(y * W + x);
  for (let y = 0; y < H; y += 2) for (const x of [0, 1, 2, W - 3, W - 2, W - 1]) border.push(y * W + x);
  const med = ch => { const v = border.map(i => d[i * 4 + ch]).sort((x, y) => x - y); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  const spread = Math.sqrt(border.reduce((acc, i) => acc + (d[i * 4] - bg[0]) ** 2 + (d[i * 4 + 1] - bg[1]) ** 2 + (d[i * 4 + 2] - bg[2]) ** 2, 0) / border.length);
  const thr = Math.max(40, spread * 2.5);
  const rows = new Float32Array(H), cols = new Float32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = (y * W + x) * 4;
    if (Math.hypot(d[q] - bg[0], d[q + 1] - bg[1], d[q + 2] - bg[2]) > thr) { rows[y]++; cols[x]++; }
  }
  const span = (prof, n, other) => { let a0 = 0, b0 = n - 1; while (a0 < n && prof[a0] < other * 0.3) a0++; while (b0 > a0 && prof[b0] < other * 0.3) b0--; return [a0, b0 + 1]; };
  const [sx0, sx1] = span(cols, W, H), [sy0, sy1] = span(rows, H, W);
  const bw = sx1 - sx0, bh = sy1 - sy0;
  const sure = spread < 45 && bw > W * 0.25 && bh > H * 0.25 && Math.abs(bw / bh - 63 / 88) / (63 / 88) < 0.08;
  let ol, or, ot, ob;
  if (sure) { ol = sx0; or = sx1; ot = sy0; ob = sy1; }
  else {
    let h = H * 0.8, w = h * 63 / 88;
    if (w > W * 0.85) { w = W * 0.85; h = w * 88 / 63; }
    ol = (W - w) / 2; or = ol + w; ot = (H - h) / 2; ob = ot + h;
  }
  st.sure = !!sure;

  // Borde interior (dentro de la carta, en la franja central de la propia carta)
  const cw = or - ol, ch = ob - ot;
  const [a, b] = st.mode === 'thin' ? [0.008, 0.06] : [0.02, 0.13];
  const cp2 = colProf(Math.round(ot + ch * 0.3), Math.round(ot + ch * 0.7), Math.round(ol), Math.round(or));
  const rp2 = rowProf(Math.round(ol + cw * 0.3), Math.round(ol + cw * 0.7), Math.round(ot), Math.round(ob));
  // El primer salto claro yendo desde el borde de la carta hacia dentro (no el más fuerte: ese suele ser
  // el recuadro de la ilustración).
  let il = peak(cp2, ol + cw * a, ol + cw * b, true, 0.45), ir = peak(cp2, or - cw * b, or - cw * a, false, 0.45);
  let it = peak(rp2, ot + ch * a, ot + ch * b, true, 0.45), ib = peak(rp2, ob - ch * b, ob - ch * a, false, 0.45);
  const def = st.mode === 'thin' ? 0.03 : 0.06;
  if (il == null) il = ol + cw * def; if (ir == null) ir = or - cw * def;
  if (it == null) it = ot + ch * def; if (ib == null) ib = ob - ch * def;

  st.o = { l: ol * k, r: or * k, t: ot * k, b: ob * k };
  st.i = { l: il * k, r: ir * k, t: it * k, b: ib * k };
  if (st.sure) refine(k);
  st.sel = null;
}

// Segunda pasada en la foto original: cada línea se recoloca en el salto de luz más fuerte a ±1,5 píxeles
// de la detección (en la imagen reducida 1 píxel son varios de la foto, y eso movía el resultado 2-4 puntos).
function refine(k) {
  const src = st.img, W = src.width, H = src.height;
  const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const lum = (x, y) => { const q = (y * W + x) * 4; return 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2]; };
  const o = st.o, R = Math.ceil(k * 1.5);
  const fix = (pos, vert, from, to) => {
    let best = pos, bv = -1;
    for (let v = Math.max(2, Math.round(pos - R)); v <= Math.min((vert ? W : H) - 3, Math.round(pos + R)); v++) {
      let sum = 0;
      for (let u = Math.round(from); u < to; u += 2) sum += vert ? Math.abs(lum(v + 1, u) - lum(v - 1, u)) : Math.abs(lum(u, v + 1) - lum(u, v - 1));
      if (sum > bv) { bv = sum; best = v; }
    }
    return best;
  };
  const ch = o.b - o.t, cw = o.r - o.l;
  const ys = [o.t + ch * 0.3, o.t + ch * 0.7], xs = [o.l + cw * 0.3, o.l + cw * 0.7];
  for (const g of ['o', 'i']) {
    st[g].l = fix(st[g].l, true, ...ys); st[g].r = fix(st[g].r, true, ...ys);
    st[g].t = fix(st[g].t, false, ...xs); st[g].b = fix(st[g].b, false, ...xs);
  }
}

// ---------- editor ----------
const LINES = [['o', 'l'], ['o', 'r'], ['o', 't'], ['o', 'b'], ['i', 'l'], ['i', 'r'], ['i', 't'], ['i', 'b']];
const vertical = side => side === 'l' || side === 'r';
const LINE_NAME = { 'o.l': 'exterior izquierda', 'o.r': 'exterior derecha', 'o.t': 'exterior arriba', 'o.b': 'exterior abajo', 'i.l': 'interior izquierda', 'i.r': 'interior derecha', 'i.t': 'interior arriba', 'i.b': 'interior abajo' };

function renderEditor() {
  const el = $('#cent');
  el.innerHTML = `${header()}
    <div class="cent-body">
      <div class="cent-top">${sideSeg()}
        <div class="seg small" id="cent-mode"><button data-m="normal" class="${st.mode === 'normal' ? 'on' : ''}">Borde normal</button><button data-m="thin" class="${st.mode === 'thin' ? 'on' : ''}">Borde fino / full art</button></div>
      </div>
      <div class="cent-read" id="cent-read"></div>
      ${st.sure ? '' : '<div class="note warn" style="margin:0 0 10px">No he encontrado los bordes con seguridad: coloca las líneas tú. Las amarillas en el borde exterior de la carta y las azules en el borde interior del marco (usa la lupa).</div>'}
      <div class="cent-stage" id="cent-stage"><canvas id="cent-canvas"></canvas><canvas id="cent-loupe" class="cent-loupe hidden" width="180" height="180"></canvas></div>
      <div class="cent-nudge" id="cent-nudge"></div>
      <div class="cent-grades" id="cent-grades"></div>
      <div class="cent-actions">
        <button class="btn secondary" id="cent-redetect" type="button">Intentar detectar</button>
        <button class="btn secondary" id="cent-new" type="button">${st.onClose ? 'Volver a la cámara' : 'Otra foto'}</button>
      </div>
      <div id="cent-save-box"></div>
      <p class="note">Amarillo: borde exterior de la carta. Azul: borde interior del marco. Arrastra cada línea (sale una lupa) o tócala y ajústala con − / +. Las notas son orientativas: solo miden el centrado.</p>
    </div>`;
  el.querySelector('#cent-close').onclick = close;
  el.querySelector('#cent-side').onclick = e => { const b = e.target.closest('[data-s]'); if (b) { st.side = b.dataset.s; renderEditor(); } };
  el.querySelector('#cent-mode').onclick = e => { const b = e.target.closest('[data-m]'); if (b) { st.mode = b.dataset.m; autoDetect(); renderEditor(); } };
  el.querySelector('#cent-redetect').onclick = () => { autoDetect(); renderEditor(); };
  el.querySelector('#cent-new').onclick = () => { if (st.onClose) close(); else { st.img = null; renderStart(); } };   // desde el escáner: vuelve a la cámara
  setupCanvas();
  update();
}

let view = null;   // escala y desplazamiento de la imagen dentro del lienzo
function setupCanvas() {
  const stage = $('#cent-stage'), cv = $('#cent-canvas');
  const dpr = window.devicePixelRatio || 1;
  const maxW = stage.clientWidth, maxH = Math.min(window.innerHeight * 0.56, 620);
  const s = Math.min(maxW / st.img.width, maxH / st.img.height);
  const w = Math.round(st.img.width * s), h = Math.round(st.img.height * s);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  view = { s, dpr, w, h };
  draw();

  const toImg = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / view.s, y: (e.clientY - r.top) / view.s, cx: e.clientX - r.left, cy: e.clientY - r.top }; };
  const nearest = p => {
    let best = null, bd = 26 / view.s;
    for (const [g, side] of LINES) {
      const v = st[g][side], dist = Math.abs((vertical(side) ? p.x : p.y) - v);
      if (dist < bd) { bd = dist; best = [g, side]; }
    }
    return best;
  };
  cv.onpointerdown = e => {
    const p = toImg(e), n = nearest(p);
    if (!n) { st.sel = null; draw(); renderNudge(); return; }
    st.sel = n; st.drag = true;
    cv.setPointerCapture(e.pointerId);
    move(p);
  };
  cv.onpointermove = e => { if (st.drag) move(toImg(e)); };
  cv.onpointerup = cv.onpointercancel = () => { st.drag = false; $('#cent-loupe').classList.add('hidden'); draw(); update(); };
  const move = p => {
    const [g, side] = st.sel;
    setLine(g, side, vertical(side) ? p.x : p.y);
    draw(); update(false); loupe(p);
  };
  renderNudge();
}

// Mantiene el orden: exterior izquierda < interior izquierda < interior derecha < exterior derecha (igual en vertical).
function setLine(g, side, v) {
  const W = st.img.width, H = st.img.height, o = st.o, i = st.i, m = 2;
  if (side === 'l') v = g === 'o' ? Math.min(v, i.l - m) : Math.max(o.l + m, Math.min(v, i.r - m));
  if (side === 'r') v = g === 'o' ? Math.max(v, i.r + m) : Math.min(o.r - m, Math.max(v, i.l + m));
  if (side === 't') v = g === 'o' ? Math.min(v, i.t - m) : Math.max(o.t + m, Math.min(v, i.b - m));
  if (side === 'b') v = g === 'o' ? Math.max(v, i.b + m) : Math.min(o.b - m, Math.max(v, i.t + m));
  st[g][side] = Math.max(0, Math.min(vertical(side) ? W : H, v));
}

function draw() {
  const cv = $('#cent-canvas'); if (!cv) return;
  const g = cv.getContext('2d'), { s, dpr } = view;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, view.w, view.h);
  g.drawImage(st.img, 0, 0, view.w, view.h);
  // oscurece lo que queda fuera de la carta
  const o = st.o, i = st.i;
  g.fillStyle = 'rgba(0,0,0,.45)';
  g.fillRect(0, 0, view.w, o.t * s); g.fillRect(0, o.b * s, view.w, view.h - o.b * s);
  g.fillRect(0, o.t * s, o.l * s, (o.b - o.t) * s); g.fillRect(o.r * s, o.t * s, view.w - o.r * s, (o.b - o.t) * s);
  for (const [gr, side] of LINES) {
    const v = st[gr][side] * s, on = st.sel && st.sel[0] === gr && st.sel[1] === side;
    g.strokeStyle = gr === 'o' ? '#ffcb05' : '#38bdf8';
    g.lineWidth = on ? 3 : 1.5;
    g.setLineDash(on ? [] : [6, 4]);
    g.beginPath();
    if (vertical(side)) { g.moveTo(v, 0); g.lineTo(v, view.h); } else { g.moveTo(0, v); g.lineTo(view.w, v); }
    g.stroke();
  }
  g.setLineDash([]);
}

function loupe(p) {
  const lp = $('#cent-loupe'), g = lp.getContext('2d'), Z = 5, R = 90;
  lp.classList.remove('hidden');
  lp.style.left = Math.max(0, Math.min(view.w - 180, p.cx - 90)) + 'px';
  lp.style.top = Math.max(0, p.cy - 220) + 'px';
  g.clearRect(0, 0, 180, 180);
  g.save(); g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.clip();
  const sw = 180 / Z;
  g.imageSmoothingEnabled = false;
  g.drawImage(st.img, p.x - sw / 2, p.y - sw / 2, sw, sw, 0, 0, 180, 180);
  // líneas dentro de la lupa
  for (const [gr, side] of LINES) {
    const v = st[gr][side], on = st.sel && st.sel[0] === gr && st.sel[1] === side;
    g.strokeStyle = gr === 'o' ? '#ffcb05' : '#38bdf8'; g.lineWidth = on ? 2 : 1;
    g.beginPath();
    if (vertical(side)) { const x = (v - (p.x - sw / 2)) * Z; g.moveTo(x, 0); g.lineTo(x, 180); } else { const y = (v - (p.y - sw / 2)) * Z; g.moveTo(0, y); g.lineTo(180, y); }
    g.stroke();
  }
  g.restore();
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.stroke();
}

function renderNudge() {
  const box = $('#cent-nudge'); if (!box) return;
  if (!st.sel) { box.innerHTML = '<span class="muted">Toca o arrastra una línea para ajustarla.</span>'; return; }
  const [g, side] = st.sel;
  box.innerHTML = `<span>Línea <b>${LINE_NAME[g + '.' + side]}</b></span>
    <button class="btn secondary" data-n="-1" type="button">−</button><button class="btn secondary" data-n="1" type="button">+</button>`;
  box.onclick = e => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    const unit = Math.max(1, st.img.width / 1200);   // ~1 píxel de la foto original
    setLine(g, side, st[g][side] + Number(b.dataset.n) * unit);
    draw(); update();
  };
}

function update(full = true) {
  const c = centeringOf(st.o, st.i);
  st.results[st.side] = c;
  $('#cent-read').innerHTML = `<div><span class="muted">Izq. / Der.</span><b>${fmt(c.lr[0])} / ${fmt(c.lr[1])}</b></div><div><span class="muted">Arriba / Abajo</span><b>${fmt(c.tb[0])} / ${fmt(c.tb[1])}</b></div>`;
  if (!full) return;
  renderNudge();
  $('#cent-grades').innerHTML = gradesHTML();
  renderSaveBox();
}

function gradesHTML() {
  const sides = ['front', 'back'].filter(s => st.results[s]);
  const head = sides.map(s => `<th>${s === 'front' ? 'Delante' : 'Detrás'}</th>`).join('') + (sides.length === 2 ? '<th>Total</th>' : '');
  const rows = Object.keys(GRADES).map(co => {
    const gs = sides.map(s => gradeFor(co, s, st.results[s].worst));
    return `<tr><td>${co}</td>${gs.map(g => `<td>${g}</td>`).join('')}${sides.length === 2 ? `<td><b>${Math.min(...gs)}</b></td>` : ''}</tr>`;
  }).join('');
  return `<div class="box-title">Nota máxima por centrado <small>orientativa</small></div><table class="lang-prices cent-table"><tr><th>Empresa</th>${head}</tr>${rows}</table>`;
}
function summaryHTML() {
  return `<div class="panel" style="margin-top:14px">${gradesHTML()}</div><div id="cent-save-box"></div>`;
}

function renderSaveBox() {
  const box = $('#cent-save-box'); if (!box) return;
  if (!st.items.length) { box.innerHTML = `<p class="note">${st.onClose ? 'Para guardar el centrado en una carta de tu colección, ábrela desde «Mis cartas» y pulsa «Centrado».' : 'Si añades esta carta a tu colección, podrás guardar aquí su centrado.'}</p>`; return; }
  box.innerHTML = `<div class="cent-save">
    ${st.items.length > 1 ? `<select id="cent-item">${st.items.map(it => `<option value="${esc(it.id)}">${esc(it.label)}</option>`).join('')}</select>` : ''}
    <button class="btn" id="cent-save" type="button">Guardar en mi carta</button></div>`;
  bindSave();
}
function bindSave() {
  const b = $('#cent-save'); if (!b) return;
  b.onclick = () => {
    const id = $('#cent-item')?.value || st.items[0].id;
    const out = {};
    for (const s of ['front', 'back']) if (st.results[s]) out[s] = { lr: st.results[s].lr.map(v => Math.round(v * 10) / 10), tb: st.results[s].tb.map(v => Math.round(v * 10) / 10), at: Date.now() };
    st.onSave(id, out);
    st.toast?.('Centrado guardado en tu carta');
  };
}
