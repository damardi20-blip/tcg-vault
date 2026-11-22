// DLRS Vault — colección de cartas Pokémon con precios actualizados.
// Todo funciona en el propio navegador. Los datos de cartas y precios están en /data
// (los actualiza GitHub Actions cada día) y tus cartas se guardan en el móvil
// y, si activas la sincronización, en Firebase.
//
// Cada colección se descarga solo cuando hace falta (al abrirla o si tienes cartas de ella).

import { initScanner } from './scanner.js';

const K = {
  items: 'tcgvault.items',
  wish: 'tcgvault.wish',
  settings: 'tcgvault.settings',
  code: 'tcgvault.code',
  ui: 'tcgvault.ui',
};

const LANG_LABEL = { es: 'Español', en: 'Inglés', it: 'Italiano', ja: 'Japonés' };
const LANG_SHORT = { es: 'ES', en: 'EN', it: 'IT', ja: 'JA' };
const CONDITIONS = [
  { k: 'MT', label: 'Mint', f: 1 },
  { k: 'NM', label: 'Near Mint', f: 1 },
  { k: 'EX', label: 'Excellent', f: 0.85 },
  { k: 'GD', label: 'Good', f: 0.7 },
  { k: 'LP', label: 'Light Played', f: 0.6 },
  { k: 'PL', label: 'Played', f: 0.45 },
  { k: 'PO', label: 'Poor', f: 0.3 },
];
const GRADERS = ['PSA', 'BGS', 'CGC', 'SGC', 'ACE', 'Otra'];
const TYPE_LABEL = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse holo', firstEdition: '1ª edición', wPromo: 'Promo' };
const SUBTYPE_LABEL = { unlimited: 'Ilimitada', shadowless: 'Shadowless', '1999-2000-copyright': '© 1999-2000' };
const FOIL_LABEL = { pokeball: 'Poké Ball', masterball: 'Master Ball', cosmos: 'Cosmos', energy: 'Energía' };
const STAMP_LABEL = { '1st-edition': '1ª edición', '30th-anniversary': 'sello 30 aniv.', 'pokemon-center': 'Pokémon Center', 'gamestop': 'GameStop', 'eb-games': 'EB Games' };
const RARITY_ES = {
  'Common': 'Común', 'Uncommon': 'Poco común', 'Rare': 'Rara', 'Rare Holo': 'Rara Holo', 'Holo Rare': 'Rara Holo',
  'Double rare': 'Rara Doble', 'Illustration rare': 'Rara Ilustración', 'Special illustration rare': 'Rara Ilustración Especial',
  'Ultra Rare': 'Ultra Rara', 'Hyper rare': 'Hiper Rara', 'Secret Rare': 'Rara Secreta', 'Shiny rare': 'Rara Shiny',
  'Shiny Ultra Rare': 'Ultra Rara Shiny', 'ACE SPEC Rare': 'Rara AS TÁCTICO', 'Amazing Rare': 'Rara Asombrosa',
  'Radiant Rare': 'Rara Radiante', 'Holo Rare V': 'Rara Holo V', 'Holo Rare VMAX': 'Rara Holo VMAX', 'Holo Rare VSTAR': 'Rara Holo ASTRO',
  'Rare PRIME': 'Rara PRIME', 'LEGEND': 'LEYENDA', 'Rare Holo LV.X': 'Rara Holo NV.X', 'Classic Collection': 'Colección Clásica',
  'Pikachu Rare': 'Rara Pikachu', 'RGB Rare': 'Rara RGB', 'Futuristic Rare': 'Rara Futurista', 'Mega Hyper Rare': 'Mega Hiper Rara',
  'Black White Rare': 'Rara Blanca y Negra', 'Full Art Trainer': 'Entrenador Arte Completo', 'Crown': 'Corona', 'One Star': '1 Estrella',
  'Two Star': '2 Estrellas', 'Three Star': '3 Estrellas', 'None': '', 'Promo': 'Promo',
  'Shiny rare V': 'Rara Shiny V', 'Shiny rare VMAX': 'Rara Shiny VMAX', 'Mega Attack Rare': 'Rara Ataque Mega',
};
const SERIES_COLORS = { cm: '#ffcb05', es: '#ff6b6b', en: '#60a5fa', it: '#34d399', ja: '#c084fc' };
const IMG_BASE = 'https://assets.tcgdex.net';

// ---------- estado ----------
const S = {
  index: { sets: [] },
  sets: new Map(),        // id → datos de la colección (nombre, código, idiomas…)
  setOrder: new Map(),    // id → posición (más nueva primero)
  data: new Map(),        // id → { cards, prices, history } (solo las colecciones descargadas)
  loading: new Map(),
  cards: new Map(),       // id → carta completa (de colecciones descargadas)
  cardPos: new Map(),     // id → posición dentro de su colección
  lite: null,             // índice ligero de TODAS las cartas (para buscar y escanear)
  items: load(K.items, []),
  wish: load(K.wish, {}),
  settings: Object.assign({ priceSource: 'auto', condAdjust: false, lang: 'es' }, load(K.settings, {})),
  ui: Object.assign({ view: 'home', range: 30, layout: 'list', catSet: null, catLang: null, sort: 'set' }, load(K.ui, {})),
};

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
// La selección de «añadir varias» es temporal: no se guarda.
const saveUI = () => { const { multi, multiVisible, ...ui } = S.ui; save(K.ui, ui); };

// ---------- utilidades ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const eur = n => (n == null || isNaN(n) ? '—' : EUR.format(n));
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + EUR.format(Math.abs(n));
const pct = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' %';
const todayStr = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmtDate = d => (d ? new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const year = d => (d ? d.slice(0, 4) : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(url);
  return res.json();
}

// ---------- datos ----------
// Id de colección a partir del id de carta ("sv08.5-010" → "sv08.5"); elige el id más largo que encaje.
function setIdOf(cardId) {
  let best = null;
  for (const id of S.sets.keys()) if (cardId.startsWith(id + '-') && (!best || id.length > best.length)) best = id;
  return best;
}

function ensureSets(ids) {
  return Promise.all([...new Set(ids)].filter(id => id && S.sets.has(id)).map(ensureSet));
}
function ensureSet(id) {
  if (S.data.has(id)) return Promise.resolve(S.data.get(id));
  if (S.loading.has(id)) return S.loading.get(id);
  const p = Promise.all([
    fetchJSON(`data/sets/${encodeURIComponent(id)}.json`),
    fetchJSON(`data/prices/${encodeURIComponent(id)}.json`).catch(() => ({ cm: {} })),
    fetchJSON(`data/history/${encodeURIComponent(id)}.json`).catch(() => ({ dates: [], cm: {}, ct: {} })),
  ]).then(([set, prices, history]) => {
    set.cards.forEach((c, i) => { c.set = id; S.cards.set(c.id, c); S.cardPos.set(c.id, i); });
    const d = { cards: set.cards, prices, history, dateIdx: new Map(history.dates.map((x, i) => [x, i])) };
    S.data.set(id, d);
    S.loading.delete(id);
    return d;
  }).catch(e => { S.loading.delete(id); console.warn(e); throw e; });
  S.loading.set(id, p);
  return p;
}

async function ensureLite() {
  if (S.lite) return S.lite;
  const rows = await fetchJSON('data/search.json');
  S.lite = rows.map(([id, set, num, en, es, it]) => {
    const name = {};
    const meta = S.sets.get(set);
    if (meta?.japanese && /[^\x00-\x7F]/.test(en)) name.ja = en; else name.en = en;   // las japonesas antiguas traen el nombre en inglés
    if (es) name.es = es;
    if (it) name.it = it;
    return { id, set, num, name, lite: true };
  });
  parsedQ = { q: null };
  codesCache = null;
  return S.lite;
}

// ---------- cartas ----------
const setOf = card => S.sets.get(card.set);
const cardCode = card => `${setOf(card)?.code || card.set} ${card.num}`;
function cardName(card, lang = S.settings.lang) {
  const n = card.name || {};
  return n[lang] || n.es || n.en || n.it || n.ja || card.id;
}
function setName(set, lang = S.settings.lang) {
  const n = set?.name || {};
  return n[lang] || n.es || n.en || n.it || n.ja || set?.code || '';
}
// URL de la imagen: en el idioma pedido si existe, si no en inglés.
function cardImg(card, lang = S.settings.lang, quality = 'low') {
  if (card.im) return card.im[quality === 'low' ? 0 : 1];   // imagen de otra fuente (pokemontcg.io)
  const set = setOf(card);
  if (!set || !set.imgLangs?.length) return null;
  const l = set.imgLangs.includes(lang) ? lang : set.imgLangs.includes('en') ? 'en' : set.imgLangs[0];
  return `${IMG_BASE}/${l}/${set.serie}/${set.id}/${encodeURIComponent(card.num)}/${quality}.webp`;
}
function cardImgFallback(card, lang, quality) {
  const set = setOf(card);
  if (!set?.imgLangs?.includes('en') || lang === 'en') return null;
  return `${IMG_BASE}/en/${set.serie}/${set.id}/${encodeURIComponent(card.num)}/${quality}.webp`;
}
function rarityLabel(card) {
  const r = card.rarity;
  return r ? (RARITY_ES[r] ?? r) : '';
}
function defaultLang(card) {
  const langs = setOf(card)?.langs || ['es'];
  return langs.includes(S.settings.lang) ? S.settings.lang : langs[0];
}
function variantLabel(key) {
  if (!key) return '';
  const m = String(key).match(/^([^/~:]+)(?:\/([^~:]+))?(?:~([^:]+))?(?::(.+))?$/) || [];
  const [, type, sub, foil, stamp] = m;
  const parts = [TYPE_LABEL[type] || type];
  if (sub) parts.push(SUBTYPE_LABEL[sub] || sub);
  if (foil) parts.push(FOIL_LABEL[foil] || foil);
  if (stamp) parts.push(stamp.split('+').map(x => STAMP_LABEL[x] || x.replace(/-/g, ' ')).join(', '));
  return parts.join(' · ');
}
function cardVariants(card) {
  const v = (card.v || []).map(x => x.k);
  return v.length ? v : ['normal', 'holo', 'reverse'];
}
function defaultVariant(card) {
  const v = card.v || [];
  return (v.find(x => x.cm && x.cm === card.cm && x.t !== 'reverse') || v.find(x => x.t !== 'reverse') || v[0])?.k || 'normal';
}

function thumbHTML(card, lang, quality = 'low') {
  const src = cardImg(card, lang, quality);
  const fb = cardImgFallback(card, lang, quality);
  const ph = `<div class="ph"><b>${esc(cardName(card, lang))}</b><span>${esc(cardCode(card))}</span></div>`;
  const onerr = fb ? `if(this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb=''}else{this.remove()}` : 'this.remove()';
  return `<div class="thumb">${ph}${src ? `<img src="${esc(src)}" ${fb ? `data-fb="${esc(fb)}"` : ''} alt="${esc(cardName(card, lang))}" loading="lazy" onerror="${onerr}">` : ''}</div>`;
}

// ---------- precios ----------
// Fila de Cardmarket: [desde, tendencia, media1, media7, media30, media, (lo mismo para reverse)]
function cmInfo(card, variantKey) {
  const d = S.data.get(card.set);
  if (!d) return null;
  const v = (card.v || []).find(x => x.k === variantKey) || (card.v || []).find(x => x.k === defaultVariant(card));
  const product = v?.cm || card.cm;
  if (!product) return null;
  // Las reverse "normales" comparten producto con la carta normal: su precio está en la parte "reverse".
  const reverse = v?.t === 'reverse' && (!v.cm || v.cm === card.cm);
  const row = d.prices.cm?.[product];
  if (!row) return { product, reverse, row: null };
  const o = reverse ? row.slice(6, 12) : row.slice(0, 6);
  return { product, reverse, row: o.length ? { low: o[0], trend: o[1], avg1: o[2], avg7: o[3], avg30: o[4], avg: o[5] } : null };
}
function cmPrice(card, variantKey) {
  const r = cmInfo(card, variantKey)?.row;
  return r ? (r.trend ?? r.avg7 ?? r.avg30 ?? r.avg1 ?? r.avg ?? null) : null;
}
function ctPrice(card, lang, variantKey) {
  const d = S.data.get(card.set);
  const reverse = String(variantKey || '').startsWith('reverse');
  return d?.prices.ct?.[card.id]?.[lang]?.[reverse ? 'r' : 'n'] ?? null;
}
// Estados de CardTrader (0 NM, 1 SP, 2 MP, 3 PL, 4 PO) y su equivalente en los estados de la app.
const CT_COND_SHORT = ['NM', 'SP', 'MP', 'PL', 'PO'];
const COND_TO_CT = { MT: 0, NM: 0, EX: 1, GD: 2, LP: 2, PL: 3, PO: 4 };
// Precio de CardTrader para el estado concreto de una carta (solo versión normal, no reverse).
function ctCondPrice(card, lang, variantKey, cond) {
  if (String(variantKey || '').startsWith('reverse')) return null;
  const i = COND_TO_CT[cond];
  if (!i) return null;   // NM/Mint: ya es el precio normal
  const e = S.data.get(card.set)?.prices.ct?.[card.id]?.[lang];
  const p = e?.c?.[i] ?? null;
  return p != null && isDubious(p, e.cc?.[i], priceRef(card, variantKey)) ? null : p;
}
// Precio de referencia de una carta: la mediana de la tendencia de Cardmarket y de los precios NM de
// CardTrader en los otros idiomas que tengan al menos 3 anuncios.
function priceRef(card, variantKey, exceptLang) {
  const refs = [];
  const cm = cmPrice(card, variantKey);
  if (cm) refs.push(cm);
  const all = S.data.get(card.set)?.prices.ct?.[card.id] || {};
  const k = String(variantKey || '').startsWith('reverse') ? 'r' : 'n';
  for (const l of ['es', 'en', 'it', 'ja']) if (l !== exceptLang && all[l]?.[k] && all[l][k + 'c'] >= 3) refs.push(all[l][k]);
  if (!refs.length) return null;
  refs.sort((a, b) => a - b);
  return refs[Math.floor((refs.length - 1) / 2)];
}
// Un precio con muy pocos anuncios (≤ 3) y más del triple de la referencia no es fiable
// (p. ej. un único Lugia en español a 5.000 €): se enseña, pero no se usa para valorar.
const isDubious = (price, count, ref) => price != null && ref != null && (count ?? 0) <= 3 && price > ref * 3 && price - ref > 5;
function ctPriceOk(card, lang, variantKey) {
  const p = ctPrice(card, lang, variantKey);
  if (p == null) return null;
  const e = S.data.get(card.set)?.prices.ct?.[card.id]?.[lang];
  const k = String(variantKey || '').startsWith('reverse') ? 'rc' : 'nc';
  return isDubious(p, e?.[k], priceRef(card, variantKey, lang)) ? null : p;
}
function marketPrice(card, lang, variantKey = defaultVariant(card)) {
  const cm = cmPrice(card, variantKey);
  const ct = ctPriceOk(card, lang, variantKey);
  if (S.settings.priceSource === 'cm') return cm != null ? { value: cm, src: 'Cardmarket' } : ct != null ? { value: ct, src: 'CardTrader ' + LANG_SHORT[lang] } : { value: null, src: '' };
  return ct != null ? { value: ct, src: 'CardTrader ' + LANG_SHORT[lang] } : cm != null ? { value: cm, src: 'Cardmarket' } : { value: null, src: '' };
}
const condFactor = item => (S.settings.condAdjust && !item.graded ? CONDITIONS.find(c => c.k === item.cond)?.f ?? 1 : 1);
function itemUnit(item) {
  if (item.manual != null && item.manual !== '') return { value: Number(item.manual), src: 'Valor manual' };
  const card = S.cards.get(item.cardId);
  if (!card) return { value: null, src: '' };
  // Si en CardTrader hay anuncios de su mismo estado, se usa ese precio directamente.
  const byCond = !item.graded && S.settings.priceSource !== 'cm' ? ctCondPrice(card, item.lang, item.variant, item.cond) : null;
  if (byCond != null) return { value: byCond, src: `CardTrader ${LANG_SHORT[item.lang]} · ${CT_COND_SHORT[COND_TO_CT[item.cond]]}` };
  const m = marketPrice(card, item.lang, item.variant);
  const f = condFactor(item);
  if (m.value != null && f !== 1) return { value: Math.round(m.value * f * 100) / 100, src: m.src + ` ×${f} (${item.cond})` };
  return m;
}
const itemTotal = item => (itemUnit(item).value || 0) * (item.qty || 1);
function gainOf(it) {
  if (it.buy == null || it.buy === '') return 0;
  return itemTotal(it) - Number(it.buy) * (it.qty || 1);
}

function collectionStats() {
  let value = 0, cost = 0, costValue = 0, count = 0;
  for (const it of S.items) {
    const v = itemTotal(it);
    value += v;
    count += it.qty || 1;
    if (it.buy != null && it.buy !== '') { cost += Number(it.buy) * (it.qty || 1); costValue += v; }
  }
  const unique = new Set(S.items.map(i => i.cardId)).size;
  return { value, cost, gain: costValue - cost, gainPct: cost ? ((costValue - cost) / cost) * 100 : null, count, unique };
}

// Mientras no haya histórico propio (se guarda un precio al día), la gráfica se completa con una curva
// aproximada a partir de las medias de Cardmarket: media 30 días ≈ hace 15 días, media 7 ≈ hace 4 días,
// media 1 día ≈ ayer y tendencia = hoy.
const ESTIMATE_UNTIL = 15;   // con menos días reales que esto, se añade la parte aproximada
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function cmEstimate(row, end) {
  if (!row || !end) return null;
  const anchors = [[-15, row.avg30], [-4, row.avg7], [-1, row.avg1], [0, row.trend ?? row.avg1 ?? row.avg7]].filter(([, v]) => v != null);
  if (anchors.length < 2) return null;
  const out = new Map();
  for (let k = 0; k < anchors.length - 1; k++) {
    const [d0, v0] = anchors[k], [d1, v1] = anchors[k + 1];
    for (let d = d0; d < d1; d++) out.set(addDays(end, d), Math.round((v0 + ((v1 - v0) * (d - d0)) / (d1 - d0)) * 100) / 100);
  }
  out.set(addDays(end, anchors[anchors.length - 1][0]), anchors[anchors.length - 1][1]);
  return out;
}

// Valor de la colección en cada día (con los precios guardados cada día de cada colección).
function valueSeries() {
  const all = new Set();
  for (const it of S.items) for (const d of S.data.get(setIdOf(it.cardId))?.history.dates || []) all.add(d);
  const realDays = all.size;
  const estimated = realDays < ESTIMATE_UNTIL && S.items.length > 0;
  const end = [...all].sort().pop() || S.index.updated;
  if (estimated) for (let k = -15; k <= 0; k++) all.add(addDays(end, k));
  const dates = [...all].sort();
  const n = dates.length;
  const out = new Array(n).fill(0);
  for (const it of S.items) {
    const card = S.cards.get(it.cardId);
    const d = card && S.data.get(card.set);
    // Se muestra el valor de lo que tienes hoy a lo largo del tiempo (desde la fecha de compra, si la pusiste).
    const from = it.buyDate || '0000';
    const nowUnit = itemUnit(it).value || 0;
    const info = card ? cmInfo(card, it.variant) : null;
    const cmHist = info && d?.history.cm?.[info.product + (info.reverse ? 'r' : '')];
    const ctHist = d?.history.ct?.[it.cardId]?.[it.lang];
    const f = condFactor(it);
    const est = estimated && info ? cmEstimate(info.row, end) : null;
    for (let i = 0; i < n; i++) {
      if (dates[i] < from) continue;
      let u;
      if (it.manual != null && it.manual !== '') u = Number(it.manual);
      else {
        const j = d?.dateIdx.get(dates[i]);
        const cm = j != null ? cmHist?.[j] : null;
        const ct = j != null ? ctHist?.[j] : null;
        u = S.settings.priceSource === 'cm' ? cm ?? ct : ct ?? cm;
        if (u == null && j == null && est?.has(dates[i])) u = est.get(dates[i]);
        u = u != null ? u * f : nowUnit;
      }
      out[i] += u * (it.qty || 1);
    }
  }
  if (n) out[n - 1] = collectionStats().value;
  return { dates, values: out.map(v => Math.round(v * 100) / 100), estimated };
}

// ---------- gráfica SVG ----------
function renderChart(el, labels, series, { height = 150, emptyMsg } = {}) {
  if (!el) return;
  const w = el.clientWidth || 340;
  const h = height;
  const all = series.flatMap(s => s.values.filter(v => v != null));
  const points = Math.max(...series.map(s => s.values.filter(v => v != null).length), 0);
  if (!all.length || points < 2) {
    const one = all.length ? `<svg viewBox="0 0 ${w} ${h}"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="${series[0]?.color || '#888'}" stroke-opacity=".35" stroke-dasharray="4 5"/><circle cx="${w - 6}" cy="${h / 2}" r="5" fill="${series[0]?.color || '#888'}"/></svg>` : '';
    el.innerHTML = one + `<div class="empty">${esc(emptyMsg || 'El histórico se irá llenando con un punto cada día.')}</div>`;
    return;
  }
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min = min * 0.9; max = max * 1.1 || 1; }
  const dataMin = min, dataMax = max;
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;
  const n = labels.length;
  // Eje Y: precio mínimo, medio y máximo a la izquierda, con líneas guía suaves.
  const axisFmt = v => (v >= 100 ? Math.round(v).toLocaleString('es-ES') : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + ' €';
  const ticks = [dataMax, (dataMax + dataMin) / 2, dataMin];
  const left = Math.min(70, Math.max(...ticks.map(t => axisFmt(t).length)) * 6.2 + 8);
  const x = i => (n === 1 ? (w + left) / 2 : (i / (n - 1)) * (w - left - 4) + left);
  const y = v => h - 18 - ((v - min) / (max - min)) * (h - 30);
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  let svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${series[0].color}" stop-opacity=".35"/><stop offset="1" stop-color="${series[0].color}" stop-opacity="0"/></linearGradient></defs>`;
  // Las etiquetas van como texto normal encima del SVG: dentro del SVG se estirarían y se verían borrosas.
  let axis = '';
  for (const t of ticks) {
    svg += `<line x1="${left}" x2="${w}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="#8a93a8" stroke-opacity=".18" stroke-dasharray="3 4"/>`;
    axis += `<span class="axis-y" style="right:${(((w - left + 6) / w) * 100).toFixed(2)}%;top:${(y(t) / h * 100).toFixed(2)}%">${esc(axisFmt(t))}</span>`;
  }
  series.forEach((s, si) => {
    let d = '', area = '', started = false, firstX = 0, lastX = 0;
    s.values.forEach((v, i) => {
      if (v == null) { started = false; return; }
      d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      if (!area) firstX = x(i);
      area += `${area ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      lastX = x(i);
      started = true;
    });
    if (si === 0 && area) svg += `<path d="${area}L${lastX},${h - 18}L${firstX},${h - 18}Z" fill="url(#${gid})" stroke="none"/>`;
    svg += `<path d="${d}" stroke="${s.color}" stroke-width="${si === 0 ? 2.4 : 1.8}" fill="none" vector-effect="non-scaling-stroke"/>`;
  });
  axis += `<span class="axis-x" style="left:${((left / w) * 100).toFixed(2)}%">${esc(fmtDate(labels[0]))}</span><span class="axis-x end">${esc(fmtDate(labels[n - 1]))}</span>`;
  svg += `<line class="cursor" x1="0" x2="0" y1="0" y2="${h - 18}" stroke="#fff" stroke-opacity=".3" visibility="hidden"/></svg>${axis}<div class="chart-tip hidden"></div>`;
  el.innerHTML = svg;
  const tip = el.querySelector('.chart-tip');
  const cur = el.querySelector('.cursor');
  const move = e => {
    const r = el.getBoundingClientRect();
    const px = Math.min(Math.max(e.clientX - r.left, 0), r.width);
    const i = n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round((((px / r.width) * w - left) / (w - left - 4)) * (n - 1))));
    const cx = (x(i) / w) * r.width;
    cur.setAttribute('x1', x(i)); cur.setAttribute('x2', x(i)); cur.setAttribute('visibility', 'visible');
    tip.innerHTML = `<div class="muted">${esc(fmtDate(labels[i]))}</div>` + series.map(s => `<div><i style="background:${s.color}"></i>${esc(s.name ? s.name + ': ' : '')}<b>${eur(s.values[i])}</b></div>`).join('');
    tip.classList.remove('hidden');
    tip.style.left = Math.min(Math.max(cx, 60), r.width - 60) + 'px';
  };
  const leave = () => { tip.classList.add('hidden'); cur.setAttribute('visibility', 'hidden'); };
  el.onpointermove = move;
  el.onpointerdown = move;
  el.onpointerleave = leave;
  el.onpointerup = e => { if (e.pointerType !== 'mouse') setTimeout(leave, 1500); };
}

// ---------- búsqueda ----------
let codesCache = null;
const knownCodes = () => codesCache || (codesCache = new Set(S.index.sets.map(s => norm(s.code)).filter(c => c.length >= 2)));
// Acepta nombre ("charizard"), número ("4", "044", "044/128") y código de colección ("PRE", "PRE 010", "30C044").
// Un código ("PRE", "MEW", "EX") se usa como filtro de colección si va con un número
// o si ninguna carta se llama así; si no, se busca como nombre ("mew ex").
let parsedQ = { q: null };
function parseQuery(q) {
  if (parsedQ.q === q) return parsedQ;
  const tokens = norm(q).split(/\s+/).map(t => t.replace(/[()#]/g, '')).filter(Boolean);
  const hasNum = tokens.some(t => /^\d/.test(t));
  const pool = S.lite || [...S.cards.values()];
  const strict = new Set(tokens.filter(t => knownCodes().has(t) &&
    (hasNum || !pool.some(c => Object.values(c.name || {}).some(nm => norm(nm).includes(t))))));
  parsedQ = { q, tokens, strict };
  return parsedQ;
}
function matchesQuery(card, q) {
  const { tokens, strict } = parseQuery(q);
  if (!tokens.length) return true;
  const set = setOf(card);
  const code = norm(set?.code);
  const n = parseInt(card.num, 10);
  const numNorm = norm(card.num);
  let hay = null;
  for (const t of tokens) {
    if (strict.has(t)) { if (t !== code) return false; continue; }
    if (code && t.startsWith(code) && t.length > code.length && /\d/.test(t.slice(code.length))) {
      const rest = t.slice(code.length).replace(/^[-_]/, '');
      if (numNorm !== rest && n !== parseInt(rest, 10)) return false;
      continue;
    }
    if (/^\d+\/\d+$/.test(t)) {
      const [a, b] = t.split('/').map(Number);
      if (n !== a) return false;
      if (set && b !== set.official && b !== set.total) return false;
      continue;
    }
    if (/^\d+$/.test(t)) { if (n !== parseInt(t, 10)) return false; continue; }
    if (t === numNorm) continue;
    if (hay == null) hay = norm([...Object.values(card.name || {}), ...Object.values(set?.name || {}), card.illus].join(' '));
    if (!hay.includes(t)) return false;
  }
  return true;
}

// ---------- navegación ----------
function showView(view) {
  if (S.ui.multi && view !== 'catalog') { S.ui.multi = null; renderMultiBar(); }
  S.ui.view = view; saveUI();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tabbar [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  window.scrollTo({ top: 0 });
  render();
}
function render() {
  const v = S.ui.view;
  if (v === 'home') renderHome();
  else if (v === 'catalog') renderCatalog();
  else if (v === 'wish') renderWish();
  else if (v === 'settings') renderSettings();
}

// ---------- vista: colección ----------
function ownedBySet() {
  const m = new Map();
  for (const it of S.items) {
    const sid = setIdOf(it.cardId);
    if (!sid) continue;
    if (!m.has(sid)) m.set(sid, new Set());
    m.get(sid).add(it.cardId);
  }
  return m;
}

function renderHome() {
  const st = collectionStats();
  $('#value-total').textContent = eur(st.value);

  const vs = valueSeries();
  let from = 0;
  if (S.ui.range) {
    const limit = new Date(Date.now() - S.ui.range * 864e5).toISOString().slice(0, 10);
    from = Math.max(0, vs.dates.findIndex(d => d >= limit));
  }
  const vals = vs.values.slice(from);
  const labels = vs.dates.slice(from);
  const delta = $('#value-delta');
  if (vals.length >= 2 && S.items.length) {
    const first = vals.find(v => v > 0) ?? vals[0];
    const diff = st.value - first;
    const rangeTxt = { 7: '7 días', 30: '1 mes', 90: '3 meses', 365: '1 año', 0: 'desde el inicio' }[S.ui.range] || '';
    delta.className = 'value-delta ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : 'muted');
    delta.textContent = `${signed(diff)} (${pct(first ? (diff / first) * 100 : 0)}) · ${rangeTxt}`;
  } else {
    delta.className = 'value-delta muted';
    delta.textContent = S.items.length ? `Precios del ${fmtDate(S.index.updated)}` : 'Añade cartas para ver su valor';
  }
  document.querySelectorAll('#home-range button').forEach(b => b.classList.toggle('on', Number(b.dataset.range) === S.ui.range));
  renderChart($('#home-chart'), labels, [{ name: '', color: '#8b6cff', values: vals }], {
    emptyMsg: S.items.length ? 'La gráfica se irá completando con un punto cada día.' : 'Aquí verás cómo evoluciona el valor de tu colección.',
  });
  if (vs.estimated && vals.length >= 2) delta.textContent += ' · aprox.';

  const gainCls = st.gain > 0 ? 'up' : st.gain < 0 ? 'down' : '';
  $('#value-stats').innerHTML = `
    <div class="stat"><b>${st.count}</b><span>Cartas</span></div>
    <div class="stat"><b>${st.unique}</b><span>Distintas</span></div>
    <div class="stat"><b>${st.cost ? eur(st.cost) : '—'}</b><span>Invertido</span></div>
    <div class="stat"><b class="${gainCls}">${st.cost ? signed(st.gain) : '—'}</b><span>${st.gainPct != null ? 'Ganancia ' + pct(st.gainPct) : 'Ganancia'}</span></div>`;

  // Progreso de las colecciones de las que tienes cartas
  const owned = ownedBySet();
  const prog = [...owned.entries()].map(([sid, have]) => {
    const set = S.sets.get(sid);
    const d = S.data.get(sid);
    const total = d?.cards.length || set.total;
    const missingCost = d ? d.cards.filter(c => !have.has(c.id)).reduce((a, c) => a + (marketPrice(c, defaultLang(c)).value || 0), 0) : null;
    return { set, have: have.size, total, missingCost, p: total ? (have.size / total) * 100 : 0 };
  }).sort((a, b) => b.p - a.p);
  $('#home-progress').innerHTML = prog.length ? `<div class="section-head"><h2>Progreso</h2></div>` + prog.map(({ set, have, total, missingCost, p }) => `
    <button class="progress-item" data-set="${esc(set.id)}">
      <div class="progress-top"><b>${esc(setName(set))} <span class="lang-tag">${esc(set.code)}</span></b><span>${have}/${total}</span></div>
      <div class="bar"><i style="width:${p.toFixed(1)}%"></i></div>
      <div class="progress-foot">${p.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % · ${have >= total ? '¡Completa!' : `te faltan ${total - have}${missingCost != null ? ` · ~${eur(missingCost)} para completarla` : ''}`}</div>
    </button>`).join('') : '';

  // Más valiosas
  const top = [...S.items].sort((a, b) => (itemUnit(b).value || 0) - (itemUnit(a).value || 0)).slice(0, 10);
  $('#home-top').innerHTML = top.length >= 3 ? `<div class="section-head"><h2>Tus más valiosas</h2></div><div class="hscroll">${top.map(it => {
    const c = S.cards.get(it.cardId); if (!c) return '';
    return `<button class="tile" data-item="${esc(it.id)}">${thumbHTML(c, it.lang)}<div class="meta"><div class="nm">${esc(cardName(c, it.lang))}</div><div class="row2"><span>${esc(cardCode(c))}</span><b>${eur(itemUnit(it).value)}</b></div></div></button>`;
  }).join('')}</div>` : '';

  // Filtro de colecciones: solo las que tienes
  const sel = $('#items-filter-set');
  const cur = sel.value;
  const opts = [...owned.keys()].sort((a, b) => (S.setOrder.get(a) ?? 0) - (S.setOrder.get(b) ?? 0));
  sel.innerHTML = '<option value="">Colecciones</option>' + opts.map(id => `<option value="${esc(id)}">${esc(S.sets.get(id).code)} · ${esc(setName(S.sets.get(id)))}</option>`).join('');
  if (opts.includes(cur)) sel.value = cur;

  renderItems();
}

function renderItems() {
  const q = $('#items-search').value;
  const fSet = $('#items-filter-set').value;
  const fLang = $('#items-filter-lang').value;
  const sort = $('#items-sort').value;
  const list = S.items.filter(it => {
    const c = S.cards.get(it.cardId);
    if (!c) return false;
    if (fSet && c.set !== fSet) return false;
    if (fLang && it.lang !== fLang) return false;
    return matchesQuery(c, q);
  });
  const pos = it => { const c = S.cards.get(it.cardId); return (S.setOrder.get(c.set) ?? 0) * 100000 + (S.cardPos.get(c.id) ?? 0); };
  const by = {
    set: (a, b) => pos(a) - pos(b) || a.lang.localeCompare(b.lang),
    'value-desc': (a, b) => itemTotal(b) - itemTotal(a),
    'value-asc': (a, b) => itemTotal(a) - itemTotal(b),
    'gain-desc': (a, b) => gainOf(b) - gainOf(a),
    name: (a, b) => cardName(S.cards.get(a.cardId), a.lang).localeCompare(cardName(S.cards.get(b.cardId), b.lang), 'es'),
    recent: (a, b) => (b.added || 0) - (a.added || 0),
  }[sort];
  list.sort(by);
  const totalQty = list.reduce((a, it) => a + (it.qty || 1), 0);
  $('#items-count').textContent = S.items.length ? `${plural(totalQty, 'carta', 'cartas')} · ${eur(list.reduce((a, it) => a + itemTotal(it), 0))}` : '';

  $('#items-layout').innerHTML = S.ui.layout === 'grid'
    ? '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'
    : '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>';

  const el = $('#items-list');
  if (!S.items.length) {
    el.innerHTML = `<div class="empty-state"><b>Tu colección está vacía</b>Añade cartas desde el catálogo o escanéalas con la cámara.<br><button class="btn" data-goto="catalog">Ir al catálogo</button></div>`;
    return;
  }
  if (!list.length) { el.innerHTML = `<div class="empty-state">No hay cartas que coincidan con la búsqueda.</div>`; return; }

  if (S.ui.layout === 'grid') {
    el.innerHTML = `<div class="grid">${list.map(it => {
      const c = S.cards.get(it.cardId);
      return `<button class="tile" data-item="${esc(it.id)}">${thumbHTML(c, it.lang)}${(it.qty || 1) > 1 ? `<span class="badge">×${it.qty}</span>` : ''}<div class="meta"><div class="nm">${esc(cardName(c, it.lang))}</div><div class="row2"><span>${esc(cardCode(c))} · ${LANG_SHORT[it.lang]}</span><b>${eur(itemTotal(it))}</b></div></div></button>`;
    }).join('')}</div>`;
    return;
  }

  let html = '<div class="list">', lastSet = null;
  for (const it of list) {
    const c = S.cards.get(it.cardId);
    if (sort === 'set' && c.set !== lastSet) {
      lastSet = c.set;
      html += `<div class="group-title">${esc(setName(setOf(c)))}</div>`;
    }
    const unit = itemUnit(it);
    const g = gainOf(it);
    const hasBuy = it.buy != null && it.buy !== '';
    html += `<button class="row-item" data-item="${esc(it.id)}">
      ${thumbHTML(c, it.lang)}
      <div class="info"><div class="nm">${esc(cardName(c, it.lang))}${(it.qty || 1) > 1 ? ` <span class="muted">×${it.qty}</span>` : ''}</div>
        <div class="sub"><span>${esc(cardCode(c))}</span><span class="lang-tag">${LANG_SHORT[it.lang]}</span><span>${it.graded ? esc(`${it.graded.co} ${it.graded.grade}`) : esc(it.cond)}</span>${it.variant ? `<span>· ${esc(variantLabel(it.variant))}</span>` : ''}</div></div>
      <div class="val"><b>${eur(itemTotal(it))}</b>${hasBuy ? `<span class="${g > 0 ? 'up' : g < 0 ? 'down' : 'muted'}">${signed(g)}</span>` : (it.qty || 1) > 1 ? `<span class="muted">${eur(unit.value)} c/u</span>` : ''}</div>
    </button>`;
  }
  el.innerHTML = html + '</div>';
}

// Los logos de TCGdex vienen sin extensión; los de otras fuentes ya son la dirección completa.
const setLogo = set => !set.logo ? null : set.logo.startsWith('https://assets.tcgdex.net/') ? `${set.logo}.webp` : set.logo;

// ---------- vista: catálogo ----------
function ownedQtyMap() {
  const m = new Map();
  for (const it of S.items) m.set(it.cardId, (m.get(it.cardId) || 0) + (it.qty || 1));
  return m;
}

function renderCatalog() {
  const inSet = S.ui.catSet && S.sets.has(S.ui.catSet);
  $('#catalog-browse').classList.toggle('hidden', inSet);
  $('#catalog-set').classList.toggle('hidden', !inSet);
  $('#catalog-search').placeholder = inSet ? 'Buscar en esta colección (nombre o número)' : 'Buscar en todas las colecciones (nombre, nº, código)';
  if (inSet) return renderCatalogSet();

  $('#catalog-title').textContent = 'Colecciones';
  const q = $('#catalog-search').value.trim();
  if (q) return renderGlobalSearch(q);

  const owned = ownedBySet();
  $('#catalog-count').textContent = `${S.index.sets.length} colecciones`;
  let html = '', lastSerie = null;
  for (const set of S.index.sets) {
    if (set.serieName !== lastSerie) {
      lastSerie = set.serieName;
      const sets = S.index.sets.filter(s => s.serieName === lastSerie);
      const years = sets.map(s => year(s.release)).filter(Boolean).sort();
      html += `<div class="era-title">${esc(lastSerie)} <span class="muted">${years.length ? esc(years[0] === years[years.length - 1] ? years[0] : `${years[0]}–${years[years.length - 1]}`) : ''}</span></div>`;
    }
    const have = owned.get(set.id)?.size || 0;
    const logo = setLogo(set);
    html += `<button class="set-row" data-open-set="${esc(set.id)}">
      <div class="set-logo">${logo ? `<img src="${esc(logo)}" alt="" loading="lazy" onerror="this.remove()">` : `<span>${esc(set.code)}</span>`}</div>
      <div class="info"><div class="nm">${esc(setName(set))}</div>
        <div class="sub"><span class="lang-tag">${esc(set.code)}</span><span>${esc(fmtDate(set.release))}</span><span>· ${set.total} cartas</span></div>
        ${have ? `<div class="bar thin"><i style="width:${((have / set.total) * 100).toFixed(1)}%"></i></div>` : ''}</div>
      <div class="val">${have ? `<b>${have}/${set.total}</b>` : ''}<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></div>
    </button>`;
  }
  $('#catalog-browse').innerHTML = html;
}

let searchToken = 0;
async function renderGlobalSearch(q) {
  const my = ++searchToken;
  const box = $('#catalog-browse');
  if (!S.lite) box.innerHTML = '<div class="empty-state">Cargando índice de cartas…</div>';
  let lite;
  try { lite = await ensureLite(); } catch { box.innerHTML = '<div class="empty-state">No se pudo cargar el índice de cartas.</div>'; return; }
  if (my !== searchToken) return;
  const owned = ownedQtyMap();
  const found = [];
  for (const c of lite) if (matchesQuery(c, q)) { found.push(c); if (found.length >= 150) break; }
  found.sort((a, b) => (S.setOrder.get(a.set) ?? 0) - (S.setOrder.get(b.set) ?? 0));
  $('#catalog-count').textContent = found.length >= 150 ? 'más de 150 cartas' : plural(found.length, 'carta', 'cartas');
  box.innerHTML = found.length ? `<div class="grid">${found.map(c => {
    const set = setOf(c);
    const lang = set.japanese ? 'ja' : S.settings.lang;
    const qty = owned.get(c.id);
    return `<button class="tile" data-card="${esc(c.id)}" data-lang="${lang}">${thumbHTML(c, lang)}${qty ? `<span class="badge">×${qty}</span>` : ''}
      <div class="meta"><div class="nm">${esc(cardName(c, lang))}</div><div class="row2"><span>${esc(cardCode(c))}</span><span>${esc(year(set.release))}</span></div></div></button>`;
  }).join('')}</div>` : '<div class="empty-state">No hay cartas que coincidan. Prueba con el nombre en inglés o con el número.</div>';
}

async function renderCatalogSet() {
  const set = S.sets.get(S.ui.catSet);
  $('#catalog-title').textContent = setName(set);
  if (!S.data.has(set.id)) {
    $('#catalog-set-head').innerHTML = '';
    $('#catalog-grid').innerHTML = '<div class="empty-state" style="grid-column:1/-1">Cargando colección…</div>';
    try { await ensureSet(set.id); } catch { $('#catalog-grid').innerHTML = '<div class="empty-state" style="grid-column:1/-1">No se pudo cargar la colección.</div>'; return; }
    if (S.ui.catSet !== set.id || S.ui.view !== 'catalog') return;
  }
  const d = S.data.get(set.id);
  if (!set.langs.includes(S.ui.catLang)) S.ui.catLang = set.langs.includes(S.settings.lang) ? S.settings.lang : set.langs[0];
  const lang = S.ui.catLang;
  const owned = ownedQtyMap();
  let cards = d.cards;
  const have = cards.filter(c => owned.has(c.id)).length;
  const value = cards.reduce((a, c) => a + (marketPrice(c, lang).value || 0), 0);
  const logo = setLogo(set);
  $('#catalog-set-head').innerHTML = `
    ${logo ? `<img class="set-head-logo" src="${esc(logo)}" alt="" onerror="this.remove()">` : ''}
    <div class="set-info">${esc(set.serieName)} · ${esc(fmtDate(set.release))} · ${set.total} cartas${set.official && set.official < set.total ? ` (${set.official} + ${set.total - set.official} secretas)` : ''}</div>
    <div class="set-info">Tienes <b>${have}/${cards.length}</b> · valor del set completo ~${eur(value)}</div>
    ${have ? `<div class="bar"><i style="width:${((have / cards.length) * 100).toFixed(1)}%"></i></div>` : ''}
    <button class="btn secondary multi-btn" id="multi-toggle" type="button">${S.ui.multi ? 'Cancelar selección' : '＋ Añadir varias cartas'}</button>`;
  $('#catalog-lang').innerHTML = set.langs.map(l => `<button data-lang="${l}" class="${l === lang ? 'on' : ''}">${LANG_SHORT[l]}</button>`).join('');

  const q = $('#catalog-search').value;
  const f = $('#catalog-filter').value;
  cards = cards.filter(c => matchesQuery(c, q) &&
    (!f || (f === 'have' && owned.has(c.id)) || (f === 'missing' && !owned.has(c.id)) || (f === 'wish' && S.wish[c.id])));
  const sort = $('#catalog-sort').value;
  if (sort !== 'num') {
    const pr = c => marketPrice(c, lang).value ?? -1;
    cards = [...cards].sort((a, b) => (sort === 'price-desc' ? pr(b) - pr(a) : pr(a) - pr(b)));
  }
  $('#catalog-count').textContent = plural(cards.length, 'carta', 'cartas');
  $('#catalog-grid').innerHTML = cards.map(c => {
    const qty = owned.get(c.id);
    const sel = S.ui.multi?.has(c.id);
    return `<button class="tile ${qty ? '' : 'missing'}${sel ? ' selected' : ''}" data-card="${esc(c.id)}" data-lang="${lang}">
      ${thumbHTML(c, lang)}${sel ? '<span class="sel-check">✓</span>' : ''}${qty ? `<span class="badge">×${qty}</span>` : ''}${S.wish[c.id] ? `<span class="badge wish">${HEART}</span>` : ''}
      <div class="meta"><div class="nm">${esc(cardName(c, lang))}</div><div class="row2"><span>${esc(c.num)}</span><b>${eur(marketPrice(c, lang).value)}</b></div></div>
    </button>`;
  }).join('') || `<div class="empty-state" style="grid-column:1/-1">No hay cartas que coincidan.</div>`;
  $('#multi-toggle').onclick = () => { if (S.ui.multi) endMulti(); else { S.ui.multi = new Set(); renderCatalog(); renderMultiBar(); } };
  S.ui.multiVisible = cards.map(c => c.id);   // para «seleccionar todas las que se ven»
  saveUI();
}

// ---------- añadir varias cartas a la vez (dentro de una colección) ----------
// Se tocan las cartas para marcarlas y abajo se elige idioma y estado; se añade 1 copia de cada una.
function renderMultiBar() {
  let bar = document.getElementById('multi-bar');
  document.body.classList.toggle('multi', !!S.ui.multi);   // deja sitio abajo para la barra
  if (!S.ui.multi) { bar?.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'multi-bar'; document.body.appendChild(bar); }
  const set = S.sets.get(S.ui.catSet);
  const lang = S.ui.multiLang && set.langs.includes(S.ui.multiLang) ? S.ui.multiLang : S.ui.catLang;
  const cond = S.ui.multiCond || 'NM';
  const n = S.ui.multi.size;
  const total = [...S.ui.multi].reduce((a, id) => a + (marketPrice(S.cards.get(id), lang).value || 0), 0);
  bar.innerHTML = `
    <div class="mb-top"><b>${n ? plural(n, 'carta seleccionada', 'cartas seleccionadas') : 'Toca las cartas que quieras añadir'}</b>${n ? `<span class="muted"> · ~${eur(total)}</span>` : ''}
      <button class="link-btn" id="mb-all" type="button">Todas las que se ven</button></div>
    <div class="mb-row">
      <select id="mb-lang" aria-label="Idioma">${set.langs.map(l => `<option value="${l}" ${l === lang ? 'selected' : ''}>${LANG_LABEL[l]}</option>`).join('')}</select>
      <select id="mb-cond" aria-label="Estado">${CONDITIONS.map(c => `<option value="${c.k}" ${c.k === cond ? 'selected' : ''}>${c.k} · ${c.label}</option>`).join('')}</select>
    </div>
    <div class="mb-row"><button class="btn secondary" id="mb-cancel" type="button">Cancelar</button><button class="btn" id="mb-add" type="button" ${n ? '' : 'disabled'}>Añadir ${n || ''}</button></div>`;
  bar.querySelector('#mb-lang').onchange = e => { S.ui.multiLang = e.target.value; renderMultiBar(); };
  bar.querySelector('#mb-cond').onchange = e => { S.ui.multiCond = e.target.value; };
  bar.querySelector('#mb-cancel').onclick = endMulti;
  bar.querySelector('#mb-all').onclick = () => { for (const id of S.ui.multiVisible || []) S.ui.multi.add(id); renderCatalog(); renderMultiBar(); };
  bar.querySelector('#mb-add').onclick = () => {
    const ids = [...S.ui.multi];
    const cond = bar.querySelector('#mb-cond').value, lang = bar.querySelector('#mb-lang').value;   // lo elegido ahora
    for (const id of ids) {
      const card = S.cards.get(id);
      if (!card) continue;
      upsertItem({ id: uid(), cardId: id, setId: card.set, lang, variant: defaultVariant(card), cond, qty: 1, graded: null,
        buy: null, buyDate: null, manual: null, notes: '', added: Date.now() });
      if (S.wish[id]) { delete S.wish[id]; save(K.wish, S.wish); Sync.deleteWish(id); }
    }
    toast(`${plural(ids.length, 'carta añadida', 'cartas añadidas')} (${LANG_SHORT[lang]}, ${cond}) · ~${eur(total)}`);
    endMulti();
    render();
  };
}
function endMulti() {
  S.ui.multi = null;
  renderMultiBar();
  if (S.ui.view === 'catalog') renderCatalog();
}

function openSetInCatalog(id) {
  S.ui.catSet = id;
  $('#catalog-search').value = '';
  $('#catalog-filter').value = '';
  $('#catalog-sort').value = 'num';
  saveUI();
  if (S.ui.view !== 'catalog') showView('catalog'); else { renderCatalog(); window.scrollTo({ top: 0 }); }
}

// ---------- vista: deseos ----------
function renderWish() {
  const ids = Object.keys(S.wish).filter(id => S.cards.has(id))
    .sort((a, b) => ((S.setOrder.get(S.cards.get(a).set) ?? 0) - (S.setOrder.get(S.cards.get(b).set) ?? 0)) || ((S.cardPos.get(a) || 0) - (S.cardPos.get(b) || 0)));
  $('#wish-count').textContent = ids.length ? plural(ids.length, 'carta', 'cartas') : '';
  const total = ids.reduce((a, id) => { const c = S.cards.get(id); return a + (marketPrice(c, S.wish[id].lang || defaultLang(c)).value || 0); }, 0);
  $('#wish-summary').classList.toggle('hidden', !ids.length);
  $('#wish-summary').innerHTML = `<div class="kv"><dt>Coste estimado de tu lista</dt><dd>${eur(total)}</dd></div>`;
  $('#wish-grid').innerHTML = ids.length ? ids.map(id => {
    const c = S.cards.get(id); const lang = S.wish[id].lang || defaultLang(c);
    return `<button class="tile" data-card="${esc(id)}" data-lang="${lang}">${thumbHTML(c, lang)}<div class="meta"><div class="nm">${esc(cardName(c, lang))}</div><div class="row2"><span>${esc(cardCode(c))}</span><b>${eur(marketPrice(c, lang).value)}</b></div></div></button>`;
  }).join('') : `<div class="empty-state" style="grid-column:1/-1"><b>Sin deseos todavía</b>Pulsa el corazón en la ficha de una carta para guardarla aquí.</div>`;
}

// ---------- vista: ajustes ----------
function renderSettings() {
  const fb = Sync.configured();
  const ctOn = !!S.index.ct;
  const nCards = S.index.sets.reduce((a, s) => a + (s.total || 0), 0);
  $('#settings-body').innerHTML = `
  <div class="settings-group"><h3>Sincronización</h3><div class="settings-card">
    ${!fb ? `<div class="settings-row"><div class="txt">Solo en este dispositivo<small>Tus cartas se guardan en este móvil. Para tenerlas en varios dispositivos hay que configurar Firebase (ver LEEME.md).</small></div></div>`
      : Sync.code ? `<div class="settings-row"><div class="txt">Código de tu colección<small>Escríbelo en otro dispositivo para ver la misma colección. Trátalo como una contraseña.</small></div><div class="code-big">${esc(Sync.code)}</div></div>
        <div class="settings-row"><div class="txt">Dejar de sincronizar<small>Las cartas se quedan en este dispositivo.</small></div><button class="btn danger" data-act="leave">Salir</button></div>`
      : `<div class="settings-row"><div class="txt">Crear código de colección<small>Sube tus cartas y te da un código para usarlas en otros dispositivos.</small></div><button class="btn" data-act="create">Crear</button></div>
        <div class="settings-row"><div class="txt">Ya tengo un código<small>Carga una colección existente en este dispositivo.</small></div><button class="btn secondary" data-act="join">Unirme</button></div>`}
  </div></div>

  <div class="settings-group"><h3>Precios</h3><div class="settings-card">
    <div class="settings-row"><div class="txt">Precio para valorar<small>${ctOn ? 'CardTrader da el precio por idioma; Cardmarket es el precio general.' : 'CardTrader por idioma si hay precio; si no, Cardmarket. CardTrader aún no está conectado.'}</small></div>
      <select id="set-source"><option value="auto">CardTrader (idioma)</option><option value="cm">Cardmarket</option></select></div>
    <div class="settings-row switch"><div class="txt">Ajustar por estado<small>Resta valor a las cartas que no están en NM (EX ×0,85, GD ×0,7, LP ×0,6, PL ×0,45, PO ×0,3).</small></div><input type="checkbox" id="set-cond" ${S.settings.condAdjust ? 'checked' : ''}></div>
    <div class="settings-row"><div class="txt">Última actualización<small>Cardmarket: ${esc(fmtDate(S.index.updated))}<br>CardTrader: ${ctOn ? esc(fmtDate(S.index.updated)) : 'no configurado'}</small></div></div>
  </div></div>

  <div class="settings-group"><h3>Cartas</h3><div class="settings-card">
    <div class="settings-row"><div class="txt">Idioma preferido<small>Para nombres, imágenes y al añadir cartas. Las colecciones antiguas solo tienen datos en inglés.</small></div>
      <select id="set-lang">${['es', 'en', 'it'].map(l => `<option value="${l}" ${S.settings.lang === l ? 'selected' : ''}>${LANG_LABEL[l]}</option>`).join('')}</select></div>
  </div></div>

  <div class="settings-group"><h3>Copia de seguridad</h3><div class="settings-card">
    <div class="settings-row"><div class="txt">Exportar colección<small>Descarga un archivo con todas tus cartas.</small></div><div style="display:flex;gap:6px"><button class="btn secondary" data-act="export-json">JSON</button><button class="btn secondary" data-act="export-csv">CSV</button></div></div>
    <div class="settings-row"><div class="txt">Importar copia<small>Añade las cartas de un archivo JSON exportado antes.</small></div><button class="btn secondary" data-act="import">Importar</button></div>
    <div class="settings-row"><div class="txt">Borrar mi colección<small>Elimina todas tus cartas y deseos.</small></div><button class="btn danger" data-act="wipe">Borrar</button></div>
  </div></div>

  <div class="settings-group"><h3>Acerca de</h3><div class="settings-card">
    <div class="settings-row"><div class="txt">DLRS Vault<small>${nCards.toLocaleString('es-ES')} cartas en ${S.index.sets.length} colecciones, de Base Set (1999) a hoy. Datos de cartas e imágenes: TCGdex. Precios: guía de precios pública de Cardmarket${ctOn ? ' y CardTrader' : ''}. App personal sin ánimo de lucro.</small></div></div>
  </div></div>
  <input type="file" id="import-file" accept="application/json,.json" hidden>`;
  $('#set-source').value = S.settings.priceSource;
}
function saveSettings() { save(K.settings, S.settings); }

// ---------- hoja inferior (pila de pantallas) ----------
const sheetStack = [];
function openSheet(renderFn, { replace = false } = {}) {
  if (replace) sheetStack.pop();
  sheetStack.push(renderFn);
  drawSheet();
}
function drawSheet() {
  const top = sheetStack[sheetStack.length - 1];
  const sheet = $('#sheet');
  if (!top) { sheet.classList.add('hidden'); document.body.style.overflow = ''; return; }
  sheet.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $('#sheet-back').classList.toggle('hidden', sheetStack.length < 2);
  const content = $('#sheet-content');
  content.scrollTop = 0;
  top(content);
}
function backSheet() { sheetStack.pop(); drawSheet(); }
function closeSheet() { sheetStack.length = 0; drawSheet(); render(); }

// ---------- ficha de carta ----------
async function openCard(cardId, lang, opts = {}) {
  const sid = setIdOf(cardId);
  if (!sid) return;
  if (!S.data.has(sid)) {
    toast('Cargando…');
    try { await ensureSet(sid); } catch { toast('No se pudo cargar la carta'); return; }
  }
  const card = S.cards.get(cardId);
  if (!card) return;
  const st = { lang: lang && setOf(card).langs.includes(lang) ? lang : defaultLang(card), variant: defaultVariant(card) };
  openSheet(el => drawCard(el, card, st), opts);
}

// Carta a pantalla completa (se cierra tocando en cualquier sitio). Se puede ampliar con dos dedos.
function openZoom(card, lang) {
  const src = cardImg(card, lang, 'high');
  if (!src) return;
  const fb = cardImgFallback(card, lang, 'high');
  const z = document.createElement('div');
  z.className = 'zoom';
  z.innerHTML = `<img src="${esc(src)}" alt="${esc(cardName(card, lang))}" ${fb ? `onerror="if('${esc(fb)}'!==this.src)this.src='${esc(fb)}'"` : ''}><button class="icon-btn zoom-close" type="button" aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  const close = () => { z.classList.remove('on'); setTimeout(() => z.remove(), 200); };
  z.onclick = close;
  document.body.appendChild(z);
  requestAnimationFrame(() => z.classList.add('on'));
}

function drawCard(el, card, st) {
  const set = setOf(card);
  const d = S.data.get(card.set);
  const { lang } = st;
  const mp = marketPrice(card, lang, st.variant);
  const mine = S.items.filter(i => i.cardId === card.id);
  const info = cmInfo(card, st.variant);
  const n = info?.row || {};
  const ctAll = d.prices.ct?.[card.id];
  const variants = cardVariants(card);
  const hasRev = ctAll && Object.values(ctAll).some(x => x?.r);

  let anyCond = false, anyBad = false;
  const ctRows = (set.japanese ? ['ja'] : ['es', 'en', 'it', 'ja']).map(l => {
    const c = ctAll?.[l];
    const ref = priceRef(card, st.variant, l);
    const bad = isDubious(c?.n, c?.nc, ref);
    if (bad) anyBad = true;
    let row = `<tr class="${l === lang ? 'mine' : ''}"><td>${LANG_LABEL[l]}</td><td>${bad ? `<span class="dubious">${eur(c?.n)}</span>*` : eur(c?.n)}</td><td>${c?.nc ?? '—'}</td>${hasRev ? `<td>${eur(c?.r)}</td>` : ''}</tr>`;
    // Si hay anuncios en otros estados, debajo: el más barato de cada estado y cuántos hay.
    if (c?.c) {
      anyCond = true;
      const chips = c.c.map((p, i) => (p == null ? '' : `<span class="cond-chip${i === 0 ? ' nm' : ''}"><b>${CT_COND_SHORT[i]}</b> ${eur(p)} <small>×${c.cc[i]}</small></span>`)).join('');
      row += `<tr class="cond-row${l === lang ? ' mine' : ''}"><td colspan="${hasRev ? 4 : 3}">${chips}</td></tr>`;
    }
    return row;
  }).join('');

  el.innerHTML = `
  <div class="detail-top">
    <div class="detail-img">${thumbHTML(card, lang, 'high')}</div>
    <div class="detail-head">
      ${set.langs.length > 1 ? `<div class="seg small" id="d-lang">${set.langs.map(l => `<button data-l="${l}" class="${l === lang ? 'on' : ''}">${LANG_SHORT[l]}</button>`).join('')}</div>` : `<span class="lang-tag">${LANG_SHORT[lang]}</span>`}
      <h2 style="margin-top:10px">${esc(cardName(card, lang))}</h2>
      <div class="sub"><a href="#" id="d-set" class="link">${esc(setName(set, lang))}</a><br>${esc(cardCode(card))}${rarityLabel(card) ? ' · ' + esc(rarityLabel(card)) : ''}</div>
      <div class="price-now">${eur(mp.value)}</div>
      <div class="price-src">${mp.src ? 'Precio ' + esc(mp.src) : 'Sin precio todavía'}</div>
      <div class="detail-actions">
        <button class="btn" id="d-add"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Añadir</button>
        <button class="btn secondary" id="d-wish">${S.wish[card.id] ? '♥ En deseos' : '♡ Deseos'}</button>
      </div>
    </div>
  </div>

  ${variants.length > 1 ? `<div class="field" style="margin-top:14px"><span class="lbl">Variante</span><div class="opts" id="d-variant">${variants.map(v => `<button data-v="${esc(v)}" class="${v === st.variant ? 'on' : ''}">${esc(variantLabel(v))}</button>`).join('')}</div></div>` : ''}

  ${mine.length ? `<div class="owned"><div class="box-title">Tienes ${mine.reduce((a, i) => a + (i.qty || 1), 0)}</div><div class="list" style="margin-top:0">${mine.map(it => `
    <button class="row-item" data-edit="${esc(it.id)}"><div class="info"><div class="nm">${it.qty || 1}× ${LANG_LABEL[it.lang]}</div><div class="sub">${it.graded ? esc(`${it.graded.co} ${it.graded.grade}`) : esc(it.cond)} · ${esc(variantLabel(it.variant))}${it.buy != null && it.buy !== '' ? ' · comprada a ' + eur(Number(it.buy)) : ''}</div></div><div class="val"><b>${eur(itemTotal(it))}</b><span class="muted">Editar</span></div></button>`).join('')}</div></div>` : ''}

  <div class="panel">
    <div class="box-title">Cardmarket <small>${variants.length > 1 ? esc(variantLabel(st.variant)) + ' · ' : ''}${esc(fmtDate(d.prices.updated))}</small></div>
    ${info?.row ? `<dl class="kv">
      <dt>Desde</dt><dd>${eur(n.low)}</dd>
      <dt>Tendencia de precio</dt><dd>${eur(n.trend)}</dd>
      <dt>Precio medio 30 días</dt><dd>${eur(n.avg30)}</dd>
      <dt>Precio medio 7 días</dt><dd>${eur(n.avg7)}</dd>
      <dt>Precio medio 1 día</dt><dd>${eur(n.avg1)}</dd>
    </dl>` : '<div class="note" style="margin-top:0">Cardmarket no tiene precio para esta variante.</div>'}
    <div class="note">Precio general de Cardmarket (todos los idiomas).</div>
    ${card.cm && d.cards.some(o => o.id !== card.id && o.cm === card.cm) ? `<div class="note warn">Ojo: en los datos de Cardmarket esta carta comparte producto con otra versión (${esc(d.cards.filter(o => o.id !== card.id && o.cm === card.cm).map(o => cardCode(o)).join(', '))}), así que este precio puede ser el de la otra. Mira el de CardTrader.</div>` : ''}
  </div>

  <div class="panel">
    <div class="box-title">CardTrader por idioma <small>más barato en NM</small></div>
    ${ctAll ? `<table class="lang-prices"><tr><th>Idioma</th><th>Desde (NM)</th><th>Anuncios</th>${hasRev ? '<th>Reverse</th>' : ''}</tr>${ctRows}</table>
      ${anyBad ? `<div class="note warn">* Precio dudoso: muy pocos anuncios y más del triple de lo normal para esta carta. No se usa para valorar tu colección.</div>` : ''}
      ${anyCond ? `<div class="note">Por estado, el más barato y cuántos hay: <b>NM</b> casi nueva · <b>SP</b> poco jugada · <b>MP</b> bastante jugada · <b>PL</b> jugada · <b>PO</b> muy jugada. Tus cartas se valoran con el precio de su estado.</div>` : ''}`
      : `<div class="note" style="margin-top:0">${S.index.ct ? 'No hay anuncios de esta carta en CardTrader.' : 'Todavía no está conectado CardTrader. Cuando añadamos tu token aparecerá aquí el precio en español, inglés, italiano y japonés.'}</div>`}
  </div>

  <div class="panel">
    <div class="box-title">Evolución del precio</div>
    <div class="legend" id="d-legend"></div>
    <div class="chart" id="d-chart"></div>
    <div class="note" id="d-chart-note"></div>
  </div>

  <div class="panel">
    <dl class="kv">
      ${card.illus ? `<dt>Ilustrador</dt><dd>${esc(card.illus)}</dd>` : ''}
      ${card.hp ? `<dt>PS</dt><dd>${esc(card.hp)}</dd>` : ''}
      ${card.types ? `<dt>Tipo</dt><dd>${esc(card.types.join(', '))}</dd>` : ''}
      <dt>Colección</dt><dd>${esc(set.code)} · ${esc(year(set.release))}</dd>
    </dl>
    <div class="links">
      <a href="${esc(cardmarketUrl(card))}" target="_blank" rel="noopener" id="d-cm">Buscar en Cardmarket</a>
      <a href="${esc(cardtraderUrl(card))}" target="_blank" rel="noopener">Ver en CardTrader</a>
    </div>
  </div>`;

  // Gráfica de precios de la carta
  const h = d.history;
  const cmReal = (info && h.cm?.[info.product + (info.reverse ? 'r' : '')]) || [];
  const realDays = cmReal.filter(v => v != null).length;
  const est = realDays < ESTIMATE_UNTIL && info ? cmEstimate(info.row, h.dates[h.dates.length - 1] || d.prices.updated) : null;
  const labels = [...new Set([...(est ? est.keys() : []), ...h.dates])].sort();
  const at = (arr, date) => { const j = d.dateIdx.get(date); return j != null ? arr?.[j] ?? null : null; };
  const series = [{ name: 'Cardmarket', color: SERIES_COLORS.cm, values: labels.map(dt => at(cmReal, dt) ?? est?.get(dt) ?? null) }];
  for (const l of ['es', 'en', 'it', 'ja']) { const v = h.ct?.[card.id]?.[l]; if (v?.some(x => x != null)) series.push({ name: 'CT ' + LANG_SHORT[l], color: SERIES_COLORS[l], values: labels.map(dt => at(v, dt)) }); }
  el.querySelector('#d-legend').innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  el.querySelector('#d-chart-note').textContent = est ? 'Las últimas semanas son aproximadas (medias de Cardmarket a 30, 7 y 1 día). Cada día se guarda el precio real y la curva se irá completando.' : '';
  requestAnimationFrame(() => renderChart(el.querySelector('#d-chart'), labels, series, { emptyMsg: 'Guardamos el precio cada día: en unos días verás aquí la evolución.' }));

  el.querySelectorAll('#d-lang button').forEach(b => b.onclick = () => { st.lang = b.dataset.l; drawCard(el, card, st); });
  el.querySelector('.detail-img').onclick = () => openZoom(card, lang);
  el.querySelector('#d-cm').onclick = () => {
    const q = cardmarketQuery(card);
    navigator.clipboard?.writeText(q).then(() => toast(`Copiado «${q}»: pégalo en el buscador de Cardmarket`), () => {});
  };
  el.querySelectorAll('#d-variant button').forEach(b => b.onclick = () => { st.variant = b.dataset.v; drawCard(el, card, st); });
  el.querySelector('#d-set').onclick = e => { e.preventDefault(); closeSheet(); openSetInCatalog(card.set); };
  el.querySelector('#d-add').onclick = () => openItemForm({ cardId: card.id, lang: st.lang, variant: st.variant });
  el.querySelector('#d-wish').onclick = () => {
    if (S.wish[card.id]) { delete S.wish[card.id]; Sync.deleteWish(card.id); toast('Quitada de deseos'); }
    else { S.wish[card.id] = { lang: st.lang, added: Date.now() }; Sync.putWish(card.id, S.wish[card.id]); toast('Añadida a deseos'); }
    save(K.wish, S.wish);
    drawCard(el, card, st);
  };
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openItemForm(S.items.find(i => i.id === b.dataset.edit)));
}

// Cardmarket pide iniciar sesión para cualquier enlace directo (búsqueda o carta), así que se abre su
// portada de Pokémon y se copia el nombre de la carta para pegarlo en su buscador.
function cardmarketQuery(card) {
  const name = card.name.en || card.name.es || card.name.ja;
  return String(name).replace(/\s+Lv\.?\s*\d+$/i, '').trim();
}
function cardmarketUrl(card) {
  return 'https://www.cardmarket.com/es/Pokemon';
}
function cardtraderUrl(card) {
  const bp = S.data.get(card.set)?.prices.ct?.[card.id]?.bp || (card.v || []).find(v => v.ct)?.ct;
  if (bp) return `https://www.cardtrader.com/cards/${bp}`;
  const name = card.name.en || card.name.es || card.name.ja;
  return `https://www.cardtrader.com/search?q=${encodeURIComponent(name + ' ' + card.num)}`;
}

// ---------- formulario de carta de la colección ----------
function openItemForm(base) {
  const editing = !!base.id;
  const card = S.cards.get(base.cardId);
  const set = setOf(card);
  const variants = cardVariants(card);
  const f = Object.assign({
    lang: defaultLang(card), variant: defaultVariant(card), cond: 'NM', qty: 1, graded: null,
    buy: '', buyDate: todayStr(), manual: '', notes: '',
  }, structuredClone(base));
  if (!set.langs.includes(f.lang)) f.lang = set.langs[0];
  if (!variants.includes(f.variant)) f.variant = variants[0];

  openSheet(el => {
    const draw = () => {
      const unit = itemUnit(f);
      el.innerHTML = `
      <div class="row-item" style="border:0;background:none;padding:0 0 4px">${thumbHTML(card, f.lang)}<div class="info"><div class="nm">${esc(cardName(card, f.lang))}</div><div class="sub">${esc(setName(set, f.lang))} · ${esc(cardCode(card))}</div></div></div>
      <h2 style="margin:6px 0 12px">${editing ? 'Editar carta' : 'Añadir a mi colección'}</h2>
      <div class="form">
        <div class="field"><span class="lbl">Idioma</span><div class="opts" id="f-lang">${set.langs.map(l => `<button data-v="${l}" class="${f.lang === l ? 'on' : ''}">${LANG_LABEL[l]}</button>`).join('')}</div></div>
        <div class="field"><span class="lbl">Variante</span><div class="opts" id="f-variant">${variants.map(v => `<button data-v="${esc(v)}" class="${f.variant === v ? 'on' : ''}">${esc(variantLabel(v))}</button>`).join('')}</div></div>
        <div class="field switch"><div class="txt"><b>Carta gradeada</b><div class="note" style="margin:0">PSA, BGS, CGC…</div></div><input type="checkbox" id="f-graded" ${f.graded ? 'checked' : ''}></div>
        ${f.graded ? `<div class="field-row">
            <div class="field"><label for="f-co">Empresa</label><select id="f-co">${GRADERS.map(g => `<option ${f.graded.co === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
            <div class="field"><label for="f-grade">Nota</label><input id="f-grade" type="text" inputmode="decimal" placeholder="10" value="${esc(f.graded.grade)}"></div></div>`
          : `<div class="field"><span class="lbl">Estado</span><div class="opts" id="f-cond">${CONDITIONS.map(c => `<button data-v="${c.k}" class="${f.cond === c.k ? 'on' : ''}">${c.k}<small>${c.label}</small></button>`).join('')}</div></div>`}
        <div class="field"><span class="lbl">Cantidad</span><div class="stepper"><button type="button" data-step="-1">−</button><input id="f-qty" type="number" min="1" inputmode="numeric" value="${f.qty}"><button type="button" data-step="1">+</button></div></div>
        <div class="field-row">
          <div class="field"><label for="f-buy">Precio de compra (c/u)</label><input id="f-buy" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00 €" value="${esc(f.buy)}"></div>
          <div class="field"><label for="f-date">Fecha de compra</label><input id="f-date" type="date" value="${esc(f.buyDate)}"></div>
        </div>
        <div class="field"><label for="f-manual">Valor manual (opcional)</label><input id="f-manual" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Si lo rellenas, se usa en lugar del precio de mercado" value="${esc(f.manual)}"></div>
        <div class="field"><label for="f-notes">Notas</label><textarea id="f-notes" rows="2" placeholder="Dónde la conseguiste, si está en una carpeta…">${esc(f.notes)}</textarea></div>
        <div class="estimate"><span class="muted">Valor estimado${unit.src ? ' · ' + esc(unit.src) : ''}</span><b>${eur(unit.value)}${f.qty > 1 ? ` × ${f.qty} = ${eur((unit.value || 0) * f.qty)}` : ''}</b></div>
        <div class="form-actions">
          ${editing ? '<button class="btn danger" id="f-del">Eliminar</button>' : ''}
          <button class="btn" id="f-save">${editing ? 'Guardar' : 'Añadir'}</button>
        </div>
      </div>`;

      const readInputs = () => {
        f.qty = Math.max(1, parseInt(el.querySelector('#f-qty').value, 10) || 1);
        f.buy = el.querySelector('#f-buy').value;
        f.buyDate = el.querySelector('#f-date').value;
        f.manual = el.querySelector('#f-manual').value;
        f.notes = el.querySelector('#f-notes').value;
        if (f.graded) { f.graded.co = el.querySelector('#f-co').value; f.graded.grade = el.querySelector('#f-grade').value; }
      };
      const pick = (sel, key) => el.querySelectorAll(sel + ' button').forEach(b => b.onclick = () => { readInputs(); f[key] = b.dataset.v; draw(); });
      pick('#f-lang', 'lang'); pick('#f-variant', 'variant'); pick('#f-cond', 'cond');
      el.querySelector('#f-graded').onchange = e => { readInputs(); f.graded = e.target.checked ? { co: 'PSA', grade: '' } : null; draw(); };
      el.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { readInputs(); f.qty = Math.max(1, f.qty + Number(b.dataset.step)); draw(); });
      ['#f-buy', '#f-manual', '#f-qty'].forEach(s => el.querySelector(s).onchange = () => { readInputs(); draw(); });
      el.querySelector('#f-save').onclick = () => {
        readInputs();
        const item = {
          id: f.id || uid(), cardId: card.id, setId: card.set, lang: f.lang, variant: f.variant, cond: f.graded ? 'NM' : f.cond,
          qty: f.qty, graded: f.graded ? { co: f.graded.co, grade: f.graded.grade || '?' } : null,
          buy: f.buy === '' ? null : Number(f.buy), buyDate: f.buyDate || null,
          manual: f.manual === '' ? null : Number(f.manual), notes: f.notes || '', added: f.added || Date.now(),
        };
        upsertItem(item);
        toast(editing ? 'Carta actualizada' : `${cardName(card, item.lang)} añadida · ${eur(itemTotal(item))}`);
        if (!editing && S.wish[card.id]) { delete S.wish[card.id]; save(K.wish, S.wish); Sync.deleteWish(card.id); }
        backSheet();
        render();
      };
      const del = el.querySelector('#f-del');
      if (del) del.onclick = () => {
        if (!confirm('¿Eliminar esta carta de tu colección?')) return;
        removeItem(f.id);
        toast('Carta eliminada');
        backSheet();
        render();
      };
    };
    draw();
  });
}

function upsertItem(item) {
  const i = S.items.findIndex(x => x.id === item.id);
  if (i >= 0) S.items[i] = item; else S.items.push(item);
  save(K.items, S.items);
  Sync.putItem(item);
}
function removeItem(id) {
  S.items = S.items.filter(x => x.id !== id);
  save(K.items, S.items);
  Sync.deleteItem(id);
}

// ---------- sincronización con Firebase (opcional, como la app de cocina) ----------
const Sync = {
  db: null, fs: null, code: localStorage.getItem(K.code) || null, unsub: [],
  configured() {
    const c = window.FIREBASE_CONFIG;
    return !!(c && c.apiKey && c.apiKey !== 'TU_API_KEY');
  },
  get active() { return !!(this.db && this.code); },
  async init() {
    if (!this.configured()) return;
    try {
      const [{ initializeApp }, fs] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js'),
      ]);
      this.fs = fs;
      const app = initializeApp(window.FIREBASE_CONFIG);
      this.db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
      if (this.code) this.start();
    } catch (e) { console.warn('Firebase no disponible', e); }
    updateSyncChip();
  },
  ref(...p) { return this.fs.doc(this.db, 'vaults', this.code, ...p); },
  start() {
    const { collection, onSnapshot } = this.fs;
    this.stop();
    this.unsub.push(onSnapshot(collection(this.db, 'vaults', this.code, 'items'), async snap => {
      S.items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      save(K.items, S.items);
      await ensureSets(S.items.map(i => i.setId || setIdOf(i.cardId))).catch(() => {});
      if (!sheetStack.length) render();
    }));
    this.unsub.push(onSnapshot(collection(this.db, 'vaults', this.code, 'wish'), async snap => {
      S.wish = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
      save(K.wish, S.wish);
      await ensureSets(Object.keys(S.wish).map(setIdOf)).catch(() => {});
      if (!sheetStack.length) render();
    }));
  },
  stop() { this.unsub.forEach(u => u()); this.unsub = []; },
  putItem(item) { if (this.active) { const { id, ...rest } = item; this.fs.setDoc(this.ref('items', id), rest).catch(syncError); } },
  deleteItem(id) { if (this.active) this.fs.deleteDoc(this.ref('items', id)).catch(syncError); },
  putWish(id, v) { if (this.active) this.fs.setDoc(this.ref('wish', id), v).catch(syncError); },
  deleteWish(id) { if (this.active) this.fs.deleteDoc(this.ref('wish', id)).catch(syncError); },
  async create() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = 'TCG-';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    this.code = code;
    await this.fs.setDoc(this.ref(), { createdAt: Date.now() });
    const batch = this.fs.writeBatch(this.db);
    for (const it of S.items) { const { id, ...rest } = it; batch.set(this.ref('items', id), rest); }
    for (const [id, v] of Object.entries(S.wish)) batch.set(this.ref('wish', id), v);
    await batch.commit();
    localStorage.setItem(K.code, code);
    this.start();
    updateSyncChip();
  },
  async join(code) {
    code = code.trim().toUpperCase();
    if (!code.startsWith('TCG-')) code = 'TCG-' + code;
    const snap = await this.fs.getDoc(this.fs.doc(this.db, 'vaults', code));
    if (!snap.exists()) return false;
    this.code = code;
    localStorage.setItem(K.code, code);
    this.start();
    updateSyncChip();
    return true;
  },
  leave() { this.stop(); this.code = null; localStorage.removeItem(K.code); updateSyncChip(); },
};
function syncError(e) { console.warn(e); toast('No se pudo sincronizar (se guardó en el móvil)'); }
function updateSyncChip() {
  const chip = $('#sync-chip');
  if (!Sync.configured()) { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  chip.classList.toggle('on', !!Sync.code);
  chip.textContent = Sync.code ? '● ' + Sync.code : 'Sin sincronizar';
}

// ---------- copia de seguridad ----------
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportJSON() {
  download(`tcg-vault-${todayStr()}.json`, JSON.stringify({ app: 'tcg-vault', version: 2, exported: new Date().toISOString(), items: S.items, wish: S.wish }, null, 2), 'application/json');
}
function exportCSV() {
  const head = ['Colección', 'Código', 'Número', 'Nombre', 'Idioma', 'Variante', 'Estado', 'Gradeo', 'Cantidad', 'Precio compra', 'Fecha compra', 'Valor unidad', 'Valor total', 'Fuente', 'Notas'];
  const rows = S.items.filter(it => S.cards.has(it.cardId)).map(it => {
    const c = S.cards.get(it.cardId); const u = itemUnit(it);
    return [setName(setOf(c)), setOf(c).code, c.num, cardName(c, it.lang), LANG_SHORT[it.lang], variantLabel(it.variant), it.cond, it.graded ? `${it.graded.co} ${it.graded.grade}` : '', it.qty, it.buy ?? '', it.buyDate ?? '', u.value ?? '', itemTotal(it), u.src, it.notes || ''];
  });
  const csv = [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
  download(`tcg-vault-${todayStr()}.csv`, '﻿' + csv, 'text/csv');
}
async function importJSON(file) {
  try {
    const data = JSON.parse(await file.text());
    const items = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(items)) throw new Error('formato');
    const ids = new Set(S.items.map(i => i.id));
    let n = 0;
    for (const it of items) {
      const sid = it.cardId && setIdOf(it.cardId);
      if (!sid) continue;
      upsertItem({ ...it, setId: sid, id: it.id && !ids.has(it.id) ? it.id : uid() }); n++;
    }
    for (const [id, v] of Object.entries(data.wish || {})) if (setIdOf(id)) { S.wish[id] = v; Sync.putWish(id, v); }
    save(K.wish, S.wish);
    await ensureSets([...S.items.map(i => i.setId || setIdOf(i.cardId)), ...Object.keys(S.wish).map(setIdOf)]).catch(() => {});
    toast(`${n} cartas importadas`);
    render();
  } catch { toast('El archivo no es una copia válida'); }
}

// ---------- eventos ----------
function bindEvents() {
  document.querySelectorAll('.tabbar [data-view]').forEach(b => b.onclick = () => {
    // Volver a pulsar "Catálogo" estando dentro de una colección vuelve a la lista de colecciones.
    if (b.dataset.view === 'catalog' && S.ui.view === 'catalog' && S.ui.catSet) { S.ui.catSet = null; $('#catalog-search').value = ''; saveUI(); }
    showView(b.dataset.view);
  });
  $('#sheet-close').onclick = closeSheet;
  $('#sheet-back').onclick = backSheet;
  $('#sheet .sheet-backdrop').onclick = closeSheet;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetStack.length) closeSheet(); });

  $('#home-range').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.ui.range = Number(b.dataset.range); saveUI(); renderHome(); };
  $('#items-search').oninput = renderItems;
  $('#items-sort').value = S.ui.sort || 'set';
  $('#items-sort').onchange = () => { S.ui.sort = $('#items-sort').value; saveUI(); renderItems(); };
  $('#items-filter-set').onchange = renderItems;
  $('#items-filter-lang').onchange = renderItems;
  $('#items-layout').onclick = () => { S.ui.layout = S.ui.layout === 'grid' ? 'list' : 'grid'; saveUI(); renderItems(); };

  let t = null;
  $('#catalog-search').oninput = () => { clearTimeout(t); t = setTimeout(renderCatalog, 180); };
  $('#catalog-back').onclick = () => { S.ui.multi = null; renderMultiBar(); S.ui.catSet = null; $('#catalog-search').value = ''; saveUI(); renderCatalog(); window.scrollTo({ top: 0 }); };
  $('#catalog-lang').onclick = e => { const b = e.target.closest('[data-lang]'); if (!b) return; S.ui.catLang = b.dataset.lang; renderCatalog(); };
  $('#catalog-filter').onchange = renderCatalog;
  $('#catalog-sort').onchange = renderCatalog;

  // Clics en cartas y colecciones en cualquier vista
  document.querySelector('main').addEventListener('click', e => {
    const card = e.target.closest('[data-card]');
    if (card && S.ui.multi && card.closest('#catalog-grid')) {   // modo «añadir varias»: tocar marca/desmarca
      const id = card.dataset.card;
      if (S.ui.multi.has(id)) S.ui.multi.delete(id); else S.ui.multi.add(id);
      card.classList.toggle('selected');
      const chk = card.querySelector('.sel-check');
      if (chk) chk.remove(); else card.querySelector('.thumb').insertAdjacentHTML('afterend', '<span class="sel-check">✓</span>');
      renderMultiBar();
      return;
    }
    if (card) return openCard(card.dataset.card, card.dataset.lang);
    const item = e.target.closest('[data-item]');
    if (item) { const it = S.items.find(i => i.id === item.dataset.item); if (it) openCard(it.cardId, it.lang); return; }
    const setBtn = e.target.closest('[data-open-set]');
    if (setBtn) return openSetInCatalog(setBtn.dataset.openSet);
    const prog = e.target.closest('.progress-item');
    if (prog) return openSetInCatalog(prog.dataset.set);
    const go = e.target.closest('[data-goto]');
    if (go) showView(go.dataset.goto);
  });

  // Ajustes
  $('#settings-body').addEventListener('change', e => {
    if (e.target.id === 'set-source') { S.settings.priceSource = e.target.value; saveSettings(); toast('Precio de valoración cambiado'); }
    if (e.target.id === 'set-cond') { S.settings.condAdjust = e.target.checked; saveSettings(); }
    if (e.target.id === 'set-lang') { S.settings.lang = e.target.value; saveSettings(); }
    if (e.target.id === 'import-file' && e.target.files[0]) importJSON(e.target.files[0]);
  });
  $('#settings-body').addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'export-json') exportJSON();
    if (act === 'export-csv') exportCSV();
    if (act === 'import') $('#import-file').click();
    if (act === 'wipe' && confirm('¿Seguro que quieres borrar TODA tu colección y tu lista de deseos? No se puede deshacer (exporta una copia antes si la quieres).')) {
      S.items.forEach(i => Sync.deleteItem(i.id)); Object.keys(S.wish).forEach(id => Sync.deleteWish(id));
      S.items = []; S.wish = {}; save(K.items, []); save(K.wish, {}); toast('Colección borrada'); renderSettings();
    }
    if (act === 'create') { try { await Sync.create(); toast('Código creado: ' + Sync.code); } catch (err) { console.warn(err); toast('No se pudo conectar con Firebase'); } renderSettings(); }
    if (act === 'join') {
      const code = prompt('Escribe el código de tu colección (ej. TCG-AB12CD):');
      if (!code) return;
      try { toast((await Sync.join(code)) ? 'Colección cargada' : 'No existe ese código'); } catch { toast('No se pudo conectar con Firebase'); }
      renderSettings();
    }
    if (act === 'leave' && confirm('¿Dejar de sincronizar este dispositivo?')) { Sync.leave(); renderSettings(); }
  });
  $('#sync-chip').onclick = () => showView('settings');
}

// ---------- arranque ----------
async function boot() {
  bindEvents();
  try {
    S.index = await fetchJSON('data/index.json');
  } catch (e) {
    console.error(e);
    toast('No se pudieron cargar los datos de cartas');
  }
  // De la más nueva a la más antigua (como en Cardmarket); las japonesas al final.
  S.index.sets.sort((a, b) => (a.japanese - b.japanese) || (b.release || '').localeCompare(a.release || ''));
  S.index.sets.forEach((s, i) => { S.sets.set(s.id, s); S.setOrder.set(s.id, i); });

  // Completa el id de colección de cartas guardadas con versiones anteriores
  let fixed = false;
  for (const it of S.items) if (!it.setId) { it.setId = setIdOf(it.cardId); fixed = true; }
  if (fixed) save(K.items, S.items);

  updateSyncChip();
  showView(S.ui.view || 'home');
  // Descarga solo las colecciones de las que tienes cartas o deseos
  await ensureSets([...S.items.map(i => i.setId), ...Object.keys(S.wish).map(setIdOf)]).catch(() => {});
  if (!sheetStack.length) render();
  Sync.init();

  initScanner({
    cards: () => S.lite || [],
    full: id => S.cards.get(id),
    sigsUrl: 'data/sigs.bin',
    loadCards: ensureLite,
    sets: () => S.sets,
    cardName, cardCode, thumbHTML, eur, imgUrl: cardImg,
    price: (c, lang) => (S.data.has(c.set) ? marketPrice(c, lang || defaultLang(c)).value : null),
    ensureSets,
    fallbackCards: () => (S.ui.catSet && S.data.get(S.ui.catSet)?.cards) || [],
    openSheet, openCard, closeScannerSheet: closeSheet,
    // Añadir rápido desde el escáner: 1 copia, NM, versión normal y el idioma que leyó la IA.
    quickAdd: async (cardId, lang) => {
      await ensureSets([setIdOf(cardId)]).catch(() => {});
      const card = S.cards.get(cardId);
      if (!card) return null;
      const l = setOf(card).langs.includes(lang) ? lang : defaultLang(card);
      const item = { id: uid(), cardId, setId: card.set, lang: l, variant: defaultVariant(card), cond: 'NM', qty: 1, graded: null,
        buy: null, buyDate: null, manual: null, notes: '', added: Date.now() };
      upsertItem(item);
      if (S.wish[cardId]) { delete S.wish[cardId]; save(K.wish, S.wish); Sync.deleteWish(cardId); }
      render();
      return `${cardName(card, l)} (${LANG_SHORT[l]}) · ${eur(itemTotal(item))}`;
    },
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // Cuando llega una versión nueva de la app: si se acaba de abrir, se recarga sola; si no, se avisa.
    const started = Date.now(), hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;   // la primera instalación no es una versión nueva
      if (Date.now() - started < 8000 && document.getElementById('sheet').classList.contains('hidden')) { reloaded = true; location.reload(); }
      else toast('Hay una versión nueva de la app: ciérrala y vuelve a abrirla para verla.');
    });
  }
}

boot();
