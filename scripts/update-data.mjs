// Descarga el catálogo de cartas y los precios del día y los guarda en la carpeta de datos.
//
// Lo ejecuta GitHub Actions una vez al día (.github/workflows/publicar.yml),
// pero también puedes lanzarlo a mano con:  node scripts/update-data.mjs
//
// Fuentes (todas gratuitas):
//  - TCGdex: colecciones, cartas, nombres en ES/EN/IT, imágenes e ids de Cardmarket/CardTrader.
//  - Cardmarket: archivo público con los precios de TODAS las cartas Pokémon (una sola descarga al día).
//  - CardTrader (opcional, token en CARDTRADER_TOKEN): precio más barato por idioma.
//
// Estructura de salida (DATA_DIR, por defecto ./data):
//   index.json            lista de colecciones
//   search.json           índice ligero de todas las cartas (para buscar y para el escáner)
//   sets/<id>.json        cartas de una colección (cambia poco; se reutiliza entre días)
//   prices/<id>.json      precios del día de esa colección
//   history/<id>.json     un precio por día (para las gráficas)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const HISTORY_DAYS = 730;
const RECENT_DAYS = 120;           // las colecciones recientes se revisan cada día (TCGdex añade cartas/ids)
const FORCE = process.env.FORCE_REBUILD === '1';
const ONLY = (process.env.ONLY_SETS || '').split(',').filter(Boolean);
const LANGS = ['es', 'en', 'it'];

// Series principales (de la más nueva a la más antigua) y colecciones que NO se incluyen
// (promos, energías, muestras y productos especiales pequeños).
const SERIES = ['me', 'sv', 'swsh', 'sm', 'xy', 'bw', 'col', 'hgss', 'pl', 'dp', 'ex', 'ecard', 'lc', 'neo', 'gym', 'base'];
const EXCLUDE = new Set([
  'basep', 'wp', 'sp', 'bog', 'ex5.5', 'dpp', 'ru1', 'hgssp', 'bwp', 'xyp', 'xya', 'smp',
  'swshp', 'fut2020', 'svp', 'sve', 'mfb', 'mee', 'mep',
]);
// Colecciones japonesas (numeración distinta a la occidental).
const JAPANESE = [{ id: 'M6a', code: 'M6a' }];

const TCGDEX = 'https://api.tcgdex.net/v2';
const CM_PRICES = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
const CT = 'https://api.cardtrader.com/api/v2';
const CT_TOKEN = process.env.CARDTRADER_TOKEN || '';

// ---------- utilidades ----------
async function getJSON(url, headers = {}, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
async function readJSON(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
const writeJSON = (file, data) => writeFile(file, JSON.stringify(data));
const r2 = v => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
const daysSince = d => (d ? (Date.now() - new Date(d).getTime()) / 864e5 : 1e9);
const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- catálogo (TCGdex) ----------
function variantKey(v) {
  let k = v.type || 'normal';
  if (v.subtype) k += '/' + v.subtype;
  if (v.foil) k += '~' + v.foil;
  if (v.stamp?.length) k += ':' + v.stamp.join('+');
  return k;
}

async function buildSetCards(setId, langs, detailLang) {
  const lists = {};
  for (const l of langs) lists[l] = await getJSON(`${TCGDEX}/${l}/sets/${encodeURIComponent(setId)}`);
  const base = lists[detailLang] || Object.values(lists).find(Boolean);
  if (!base) return null;
  const cards = new Map();
  for (const l of langs) {
    for (const c of lists[l]?.cards || []) {
      const card = cards.get(c.id) || { id: c.id, num: c.localId, name: {} };
      card.name[l] = c.name;
      cards.set(c.id, card);
    }
  }
  const imgLangs = langs.filter(l => (lists[l]?.cards || []).some(c => c.image));
  const details = await pool([...cards.keys()], 10, id =>
    getJSON(`${TCGDEX}/${detailLang}/cards/${encodeURIComponent(id)}`).catch(e => { console.warn('  ! ' + e.message); return null; }));
  for (const d of details) {
    if (!d) continue;
    const card = cards.get(d.id);
    card.rarity = d.rarity && d.rarity !== 'None' ? d.rarity : null;
    card.cat = d.category || null;
    if (d.hp) card.hp = d.hp;
    if (d.types) card.types = d.types;
    if (d.illustrator) card.illus = d.illustrator;
    if (d.dexId) card.dex = d.dexId;
    card.cm = d.pricing?.cardmarket?.idProduct || null;
    const vd = d.variants_detailed || [];
    card.v = vd.length
      ? vd.map(v => {
          const o = { k: variantKey(v), t: v.type || 'normal' };
          if (v.thirdParty?.cardmarket) o.cm = v.thirdParty.cardmarket;
          if (v.thirdParty?.cardtrader) o.ct = v.thirdParty.cardtrader;
          return o;
        })
      : Object.entries(d.variants || {}).filter(([, on]) => on).map(([t]) => ({ k: t, t }));
    // Quita variantes repetidas (misma clave)
    const seen = new Set();
    card.v = card.v.filter(v => (seen.has(v.k) ? false : seen.add(v.k)));
    if (!card.cm) card.cm = card.v.find(v => v.cm)?.cm || null;
  }
  const order = c => (/^\d+$/.test(c.num) ? parseInt(c.num, 10) : /^\D+\d+$/.test(c.num) ? 50000 + parseInt(c.num.replace(/\D/g, ''), 10) + c.num.charCodeAt(0) * 1000 : 900000 + c.num.charCodeAt(0));
  return { info: base, imgLangs, cards: [...cards.values()].sort((a, b) => order(a) - order(b) || a.num.localeCompare(b.num)) };
}

async function listSets() {
  const out = [];
  for (const s of SERIES) {
    const serie = await getJSON(`${TCGDEX}/en/series/${s}`);
    const esSerie = await getJSON(`${TCGDEX}/es/series/${s}`).catch(() => null);
    for (const set of serie.sets) {
      if (EXCLUDE.has(set.id)) continue;
      out.push({ id: set.id, serie: s, serieName: esSerie?.name || serie.name, count: set.cardCount?.total || 0, langs: LANGS, detailLang: 'en' });
    }
  }
  for (const j of JAPANESE) out.push({ id: j.id, code: j.code, serie: 'ja', serieName: 'Japonés', count: 0, langs: ['ja'], detailLang: 'ja', japanese: true });
  return out;
}

// ---------- precios de Cardmarket ----------
async function cardmarketPrices() {
  console.log('· Descargando precios de Cardmarket…');
  const data = await getJSON(CM_PRICES);
  const map = new Map();
  for (const p of data.priceGuides || []) {
    const n = [r2(p.low), r2(p.trend), r2(p.avg1), r2(p.avg7), r2(p.avg30), r2(p.avg)];
    const r = [r2(p['low-holo']), r2(p['trend-holo']), r2(p['avg1-holo']), r2(p['avg7-holo']), r2(p['avg30-holo']), r2(p['avg-holo'])];
    const row = r.some(v => v != null) ? [...n, ...r] : n;
    while (row.length && row[row.length - 1] == null) row.pop();
    if (row.length) map.set(p.idProduct, row);
  }
  console.log(`  ${map.size} productos con precio (${data.createdAt || ''})`);
  return { map, created: data.createdAt || null };
}

// ---------- CardTrader ----------
const CT_LANG = { jp: 'ja', ja: 'ja', en: 'en', es: 'es', it: 'it' };
let ctExpansions = null;
const ctFetch = p => getJSON(CT + p, { Authorization: `Bearer ${CT_TOKEN}` });

async function cardTraderForSet(setMeta, cards) {
  if (!ctExpansions) {
    const all = await ctFetch('/expansions');
    ctExpansions = all.filter(e => e.game_id === 5);
    if (!ctExpansions.length) ctExpansions = all;
  }
  const names = [setMeta.name.en, setMeta.name.ja, setMeta.code].filter(Boolean).map(normName);
  let exps = ctExpansions.filter(e => names.includes(normName(e.name)) || (setMeta.code && normName(e.code) === normName(setMeta.code)));
  if (setMeta.japanese) exps = exps.filter(e => /japan|jp/i.test(`${e.name} ${e.code}`));
  else exps = exps.filter(e => !/japan|jp\b/i.test(`${e.name}`));
  if (!exps.length) return null;
  const byBp = new Map();
  for (const c of cards) for (const v of c.v || []) if (v.ct) byBp.set(v.ct, c.id);
  const out = {};
  for (const exp of exps) {
    const needNumbers = cards.some(c => !(c.v || []).some(v => v.ct));
    if (needNumbers) {
      const bps = await ctFetch(`/blueprints/export?expansion_id=${exp.id}`).catch(() => []);
      const byNum = new Map(cards.map(c => [String(c.num).replace(/^0+/, '').toUpperCase(), c.id]));
      for (const bp of bps || []) {
        if (byBp.has(bp.id)) continue;
        const raw = bp.fixed_properties?.collector_number ?? '';
        const id = byNum.get(String(raw).split('/')[0].replace(/^0+/, '').toUpperCase());
        if (id) byBp.set(bp.id, id);
      }
    }
    const market = await ctFetch(`/marketplace/products?expansion_id=${exp.id}`).catch(() => ({}));
    for (const [bpId, products] of Object.entries(market || {})) {
      const cardId = byBp.get(Number(bpId));
      if (!cardId) continue;
      const e = out[cardId] || (out[cardId] = { bp: Number(bpId) });
      for (const p of products) {
        const pr = p.properties_hash || {};
        if (p.graded || pr.graded) continue;
        if (pr.condition && !/mint/i.test(pr.condition)) continue;
        const lang = CT_LANG[String(pr.pokemon_language || '').toLowerCase()];
        if (!lang) continue;
        const cents = p.price?.cents ?? p.price_cents;
        if (!cents || (p.price?.currency ?? p.price_currency ?? 'EUR') !== 'EUR') continue;
        const kind = pr.pokemon_reverse || pr.reverse ? 'r' : 'n';
        const l = e[lang] || (e[lang] = {});
        const price = cents / 100;
        if (!l[kind] || price < l[kind]) l[kind] = price;
        l[kind + 'c'] = (l[kind + 'c'] || 0) + (p.quantity || 1);
      }
    }
  }
  return out;
}

// ---------- logos e imágenes que faltan en TCGdex ----------
// Se buscan en otros idiomas de TCGdex y, si no, en pokemontcg.io (misma fecha de salida y nombre parecido).
const PTCG = 'https://api.pokemontcg.io/v2';
const PTCG_FROM = { rc: 'bw11', exu: 'ex10', M6a: 'me55' };   // subcolecciones sin entrada propia
let ptcgSetsCache = null;
async function ptcgSets() {
  // pokemontcg.io falla a ratos (500/502): se reintenta más veces y, si no responde, se prueba otro día.
  if (!ptcgSetsCache) {
    const d = (await getJSON(`${PTCG}/sets?pageSize=250&select=id,name,releaseDate,images`, {}, 8).catch(e => { console.warn('  ! ' + e.message); return null; }))?.data;
    if (!d?.length) return [];
    ptcgSetsCache = d;
  }
  return ptcgSetsCache;
}
const words = s => new Set(normName(s).split(' ').filter(Boolean));
async function ptcgSetFor(m) {
  const all = await ptcgSets();
  if (PTCG_FROM[m.id]) return all.find(p => p.id === PTCG_FROM[m.id]) || null;
  if (!m.release) return null;
  const sameDay = all.filter(p => p.releaseDate.replace(/\//g, '-') === m.release);
  const mine = words(m.name.en || m.name.es || '');
  const score = p => { const w = words(p.name); let n = 0; for (const x of mine) if (w.has(x)) n++; return n / Math.max(w.size, mine.size, 1); };
  return sameDay.sort((a, b) => score(b) - score(a))[0] || null;
}

async function fillLogos(index) {
  const missing = index.filter(m => !m.logo);
  if (!missing.length) return;
  for (const m of missing) {
    for (const l of ['en', 'es', 'fr', 'de', 'it', 'pt']) {
      const x = await getJSON(`${TCGDEX}/${l}/sets/${encodeURIComponent(m.id)}`, {}, 1).catch(() => null);
      if (x?.logo) { m.logo = x.logo; break; }
    }
    if (!m.logo) m.logo = (await ptcgSetFor(m))?.images?.logo || null;
  }
  console.log(`· logos: ${missing.filter(m => m.logo).length} de ${missing.length} encontrados fuera de TCGdex en inglés`);
}

// Colecciones sin ninguna imagen en TCGdex: cada carta recibe `im: [pequeña, grande]` de pokemontcg.io.
// Se empareja por número y, si la numeración es distinta (p. ej. la Colección Clásica), por nombre.
async function fillImages(m, cards) {
  if (m.imgLangs?.length || m.japanese || cards.every(c => c.im)) return 0;
  const ps = await ptcgSetFor(m);
  if (!ps) return 0;
  const list = (await getJSON(`${PTCG}/cards?q=set.id:${ps.id}&pageSize=250&select=number,name,images`, {}, 8).catch(e => { console.warn('  ! ' + e.message); return null; }))?.data || [];
  const normNum = n => String(n).toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1');
  const byNum = new Map(list.map(c => [normNum(c.number), c]));
  // Por nombre: si hay varias con el mismo nombre en las dos listas (p. ej. las dos mitades de una LEGEND),
  // se emparejan en orden. Si no hay nombre exacto, vale uno que empiece igual ("Palkia" → "Palkia LV.X").
  const groups = new Map();
  for (const c of list) { const k = normName(c.name); (groups.get(k) || groups.set(k, []).get(k)).push(c); }
  for (const g of groups.values()) g.sort((a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0));
  const used = new Set();
  let n = 0;
  const put = (card, hit) => { used.add(hit); card.im = [hit.images.small, hit.images.large || hit.images.small]; n++; };
  const nameOf = card => normName(card.name.en || card.name.es || '');
  const numOf = card => { try { return normNum(decodeURIComponent(card.num)); } catch { return normNum(card.num); } };
  // 1.º mismo número y mismo nombre; 2.º solo por nombre con lo que quede libre.
  for (const card of cards) {
    const hit = byNum.get(numOf(card));
    if (hit?.images?.small && !used.has(hit) && normName(hit.name) === nameOf(card)) put(card, hit);
  }
  for (const card of cards) {
    if (card.im) continue;
    const key = nameOf(card);
    let hit = (groups.get(key) || []).find(c => !used.has(c));
    if (!hit) {
      const pre = list.filter(c => !used.has(c) && normName(c.name).startsWith(key + ' '));
      if (pre.length === 1) hit = pre[0];
    }
    if (hit?.images?.small) put(card, hit);
  }
  return n;
}

// Colecciones japonesas: imágenes de Limitless TCG (misma numeración que TCGdex; las energías usan una letra).
const LIMITLESS = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc';
const LIMITLESS_ENERGY = { DAR: 'D', FIG: 'F', FIR: 'R', GRA: 'G', LIG: 'L', MET: 'M', PSY: 'P', WAT: 'W' };
async function fillImagesJapanese(m, cards) {
  if (!m.japanese || m.imgLangs?.length) return 0;
  let n = 0;
  await pool(cards.filter(c => !c.im), 8, async card => {
    const code = /^\d+$/.test(card.num) ? String(parseInt(card.num, 10)) : LIMITLESS_ENERGY[card.num];
    if (!code) return;   // p. ej. las Mew B/G/R no tienen imagen allí
    const url = size => `${LIMITLESS}/${m.id}/${m.id}_${code}_R_JP_${size}.png`;
    const ok = await fetch(url('SM'), { method: 'HEAD' }).then(r => r.ok).catch(() => false);
    if (ok) { card.im = [url('SM'), url('LG')]; n++; }
  });
  if (cards.some(c => !c.im)) n += await fillImagesOfficialJP(m, cards);
  return n;
}

// Las que falten, de la web oficial japonesa (pokemon-card.com). Su lista no trae el número de carta,
// pero va en orden: se empareja por nombre y, si hay varias con el mismo nombre, en orden de número.
const PCC = 'https://www.pokemon-card.com';
async function fillImagesOfficialJP(m, cards) {
  const list = [];
  for (let page = 1, max = 1; page <= max && page <= 20; page++) {
    const d = await getJSON(`${PCC}/card-search/resultAPI.php?keyword=&se_ta=&regulation_sidebar_form=all&pg=${encodeURIComponent(m.id)}&illust=&sm_and_keyword=true&page=${page}`,
      { 'User-Agent': 'Mozilla/5.0' }).catch(e => { console.warn('  ! ' + e.message); return null; });
    if (!d?.cardList) break;
    max = d.maxPage || 1;
    list.push(...d.cardList);
  }
  const key = s => String(s || '').replace(/&amp;/g, '&').replace(/＆/g, '&').replace(/[\s　]/g, '');
  const groups = new Map();
  for (const c of list) { const k = key(c.cardNameAltText); (groups.get(k) || groups.set(k, []).get(k)).push(c); }
  const seen = new Map();
  let n = 0;
  for (const card of cards) {   // las cartas ya vienen ordenadas por número
    const k = key(card.name.ja);
    const i = seen.get(k) || 0;
    seen.set(k, i + 1);
    const hit = (groups.get(k) || [])[i];
    if (!card.im && hit?.cardThumbFile) { const u = PCC + hit.cardThumbFile; card.im = [u, u]; n++; }
  }
  return n;
}

// ---------- main ----------
async function main() {
  for (const d of ['sets', 'prices', 'history']) await mkdir(path.join(DATA, d), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const oldIndex = await readJSON(path.join(DATA, 'index.json'), { sets: [] });
  const oldMeta = new Map(oldIndex.sets.map(s => [s.id, s]));

  let todo = await listSets();
  if (ONLY.length) todo = todo.filter(s => ONLY.includes(s.id));
  console.log(`· ${todo.length} colecciones`);

  const cm = await cardmarketPrices();
  const index = [];
  const search = [];
  let ctOk = false;

  for (const s of todo) {
    const file = path.join(DATA, 'sets', `${s.id}.json`);
    let cached = await readJSON(file);
    const prev = oldMeta.get(s.id);
    const stale = FORCE || !cached || !prev || daysSince(prev.release) < RECENT_DAYS || (s.count && prev.total !== s.count);
    let meta;
    if (stale) {
      process.stdout.write(`· ${s.id}: descargando cartas… `);
      const built = await buildSetCards(s.id, s.langs, s.detailLang);
      if (!built) { console.log('no disponible'); continue; }
      const info = built.info;
      const names = {};
      for (const l of s.langs) {
        const x = l === s.detailLang ? info : await getJSON(`${TCGDEX}/${l}/sets/${encodeURIComponent(s.id)}`).catch(() => null);
        if (x?.name) names[l] = x.name;
      }
      if (!names.es && !s.japanese) names.es = names.en;
      meta = {
        id: s.id, code: s.code || info.abbreviation?.official || s.id.toUpperCase(),
        name: names, langs: s.langs, imgLangs: built.imgLangs,
        serie: s.serie, serieName: s.serieName,
        total: info.cardCount?.total || built.cards.length, official: info.cardCount?.official || null,
        release: info.releaseDate || null, logo: info.logo || null, symbol: info.symbol || null,
        japanese: !!s.japanese,
      };
      cached = { set: meta, cards: built.cards };
      await writeJSON(file, cached);
      console.log(`${built.cards.length} cartas`);
    } else {
      meta = cached.set;
    }
    index.push(meta);
    for (const c of cached.cards) {
      const row = [c.id, s.id, c.num, c.name.en || c.name.ja || c.name.es || ''];
      const es = c.name.es && c.name.es !== row[3] ? c.name.es : 0;
      const it = c.name.it && c.name.it !== row[3] ? c.name.it : 0;
      if (es || it) row.push(es);
      if (it) row.push(it);
      search.push(row);
    }

    // Precios del día de esta colección
    const prices = { updated: today, cm: {}, ct: null };
    const products = new Set();
    for (const c of cached.cards) {
      if (c.cm) products.add(c.cm);
      for (const v of c.v || []) if (v.cm) products.add(v.cm);
    }
    for (const id of products) if (cm.map.has(id)) prices.cm[id] = cm.map.get(id);
    if (CT_TOKEN) {
      try {
        const ct = await cardTraderForSet(meta, cached.cards);
        if (ct) { prices.ct = ct; ctOk = true; }
      } catch (e) { console.warn(`  ! CardTrader ${s.id}: ${e.message}`); }
    }
    await writeJSON(path.join(DATA, 'prices', `${s.id}.json`), prices);

    // Histórico: tendencia de Cardmarket por producto (+ reverse) y CardTrader por idioma
    const hfile = path.join(DATA, 'history', `${s.id}.json`);
    const hist = await readJSON(hfile, { dates: [], cm: {}, ct: {} });
    let idx = hist.dates.indexOf(today);
    if (idx === -1) { hist.dates.push(today); idx = hist.dates.length - 1; }
    const len = hist.dates.length;
    const put = (obj, key, val) => {
      const arr = obj[key] || (obj[key] = []);
      while (arr.length < len) arr.push(null);
      arr[idx] = val ?? null;
    };
    for (const [id, row] of Object.entries(prices.cm)) {
      put(hist.cm, id, row[1] ?? row[3] ?? null);
      if (row[7] != null) put(hist.cm, id + 'r', row[7]);
    }
    for (const [cardId, e] of Object.entries(prices.ct || {})) {
      const o = hist.ct[cardId] || (hist.ct[cardId] = {});
      for (const l of ['es', 'en', 'it', 'ja']) if (e[l]?.n) put(o, l, e[l].n);
    }
    const cut = Math.max(0, len - HISTORY_DAYS);
    const fix = arr => { while (arr.length < len) arr.push(null); return arr.slice(cut); };
    hist.dates = hist.dates.slice(cut);
    for (const k of Object.keys(hist.cm)) { hist.cm[k] = fix(hist.cm[k]); if (hist.cm[k].every(v => v == null)) delete hist.cm[k]; }
    for (const o of Object.values(hist.ct)) for (const l of Object.keys(o)) o[l] = fix(o[l]);
    await writeJSON(hfile, hist);
  }

  if (ONLY.length) {
    // Ejecución parcial: conserva el resto del índice anterior.
    const done = new Set(index.map(s => s.id));
    for (const s of oldIndex.sets) if (!done.has(s.id)) index.push(s);
    const oldSearch = await readJSON(path.join(DATA, 'search.json'), []);
    for (const r of oldSearch) if (!done.has(r[1])) search.push(r);
    const order = new Map((await listSets()).map((s, i) => [s.id, i]));
    index.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  }

  for (const m of index) {
    if (m.imgLangs?.length) continue;
    const file = path.join(DATA, 'sets', `${m.id}.json`);
    const c = await readJSON(file);
    if (!c || c.cards.every(x => x.im)) continue;
    const n = m.japanese ? await fillImagesJapanese(m, c.cards) : await fillImages(m, c.cards);
    if (n) { await writeJSON(file, c); console.log(`· ${m.id}: ${n} imágenes de ${m.japanese ? 'Limitless / pokemon-card.com' : 'pokemontcg.io'}`); }
  }
  const noLogo = index.filter(m => !m.logo);
  await fillLogos(index);
  for (const m of noLogo) if (m.logo) {   // se guarda en el archivo de la colección para no buscarlo cada día
    const file = path.join(DATA, 'sets', `${m.id}.json`);
    const c = await readJSON(file);
    if (c) { c.set.logo = m.logo; await writeJSON(file, c); }
  }
  await writeJSON(path.join(DATA, 'index.json'), { updated: today, cmCreated: cm.created, ct: ctOk || (!CT_TOKEN ? false : oldIndex.ct), sets: index });
  await writeJSON(path.join(DATA, 'search.json'), search);
  if (!CT_TOKEN) console.log('· Sin CARDTRADER_TOKEN: se omiten los precios por idioma de CardTrader.');
  console.log(`✓ ${index.length} colecciones, ${search.length} cartas.`);
}

main().catch(e => { console.error(e); process.exit(1); });
