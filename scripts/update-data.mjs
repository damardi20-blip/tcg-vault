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

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
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
// `src` = id en TCGdex (si choca con una occidental, p. ej. neo1), `ct` = expansión de CardTrader de la que salen
// imágenes, nombres en inglés y precios (las antiguas no tienen ni imágenes ni precios en TCGdex/Cardmarket),
// `logo` = colección occidental equivalente de la que se toma el logo.
const JAPANESE = [
  { id: 'M6a', code: 'M6a' },
  { id: 'jp-base1', src: 'PMCG1', code: 'BS-JP', es: 'Base Set (japonés)', ct: 1970, logo: 'base1' },
  { id: 'jp-base2', src: 'PMCG2', code: 'JU-JP', es: 'Jungle (japonés)', ct: 1972, logo: 'base2' },
  { id: 'jp-base3', src: 'PMCG3', code: 'FO-JP', es: 'Fossil (japonés)', ct: 1973, logo: 'base3' },
  { id: 'jp-base4', src: 'PMCG4', code: 'TR-JP', es: 'Team Rocket (japonés)', ct: 1974, logo: 'base5' },
  { id: 'jp-gym1', src: 'PMCG5', code: 'G1-JP', es: "Leaders' Stadium (japonés)", ct: 1975, logo: 'gym1' },
  { id: 'jp-gym2', src: 'PMCG6', code: 'G2-JP', es: 'Challenge from the Darkness (japonés)', ct: 1976, logo: 'gym2' },
  { id: 'jp-neo1', src: 'neo1', code: 'N1-JP', es: 'Gold, Silver, to a New World (japonés)', ct: 1977, logo: 'neo1' },
  { id: 'jp-neo2', src: 'neo2', code: 'N2-JP', es: 'Crossing the Ruins (japonés)', ct: 1979, logo: 'neo2' },
  { id: 'jp-neo3', src: 'neo3', code: 'N3-JP', es: 'Awakening Legends (japonés)', ct: 1981, logo: 'neo3' },
  { id: 'jp-neo4', src: 'neo4', code: 'N4-JP', es: 'Darkness, and to Light (japonés)', ct: 1983, logo: 'neo4' },
  { id: 'jp-vs1', src: 'VS1', code: 'VS-JP', es: 'Pokémon VS (japonés)', ct: 1984 },
  { id: 'jp-web1', src: 'web1', code: 'WEB-JP', es: 'Pokémon Web (japonés)', ct: 1985 },
  { id: 'jp-e1', src: 'E1', code: 'E1-JP', es: 'Base Expansion Pack (japonés)', ct: 1986, logo: 'ecard1' },
];
// Nombres que se prefieren a los de TCGdex.
const NAME_ES = { base1: 'Base Set' };

const TCGDEX = 'https://api.tcgdex.net/v2';
// Archivos públicos de Cardmarket por juego: 6 = Pokémon, 18 = One Piece.
const CM_PRICES_G = g => `https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_${g}.json`;
const CM_CATALOG_G = g => `https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_${g}.json`;
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

async function buildSetCards(setId, langs, detailLang, srcId = setId) {
  const lists = {};
  for (const l of langs) lists[l] = await getJSON(`${TCGDEX}/${l}/sets/${encodeURIComponent(srcId)}`);
  const base = lists[detailLang] || Object.values(lists).find(Boolean);
  if (!base) return null;
  const cards = new Map();
  for (const l of langs) {
    for (const c of lists[l]?.cards || []) {
      const card = cards.get(c.id) || { id: c.id, num: c.localId, name: {} };
      if (srcId !== setId) card.ownId = `${setId}-${c.localId}`;   // id propio para no chocar con la occidental
      card.name[l] = c.name;
      cards.set(c.id, card);
    }
  }
  const imgLangs = langs.filter(l => (lists[l]?.cards || []).some(c => c.image));
  // Cartas sueltas sin imagen en ningún idioma (p. ej. las Mew B/G/R): se marcan para buscarlas en CardTrader.
  // TCGdex a veces anuncia una imagen que no existe (404), así que se comprueba de verdad.
  const imgOf = new Map();
  for (const l of langs) for (const c of lists[l]?.cards || []) if (c.image && !imgOf.has(c.id)) imgOf.set(c.id, c.image);
  if (imgLangs.length) {
    const ok = await pool([...cards.keys()], 10, id => (imgOf.has(id)
      ? fetch(`${imgOf.get(id)}/low.webp`, { method: 'HEAD' }).then(r => r.status !== 404).catch(() => true)
      : false));
    [...cards.values()].forEach((c, i) => { if (!ok[i]) c.noimg = 1; });
  }
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
  const list = [...cards.values()].sort((a, b) => order(a) - order(b) || a.num.localeCompare(b.num));
  for (const c of list) if (c.ownId) { c.id = c.ownId; delete c.ownId; }
  return { info: base, imgLangs, cards: list };
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
  for (const j of JAPANESE) out.push({ ...j, serie: 'ja', serieName: 'Japonés', count: 0, langs: ['ja'], detailLang: 'ja', japanese: true });
  return out;
}

// ---------- precios de Cardmarket ----------
async function cardmarketPrices(game = 6) {
  console.log(`· Descargando precios de Cardmarket (${game === 18 ? 'One Piece' : 'Pokémon'})…`);
  const data = await getJSON(CM_PRICES_G(game));
  const map = new Map();
  for (const p of data.priceGuides || []) {
    const n = [r2(p.low), r2(p.trend), r2(p.avg1), r2(p.avg7), r2(p.avg30), r2(p.avg)];
    const r = [r2(p['low-holo'] ?? p['low-foil']), r2(p['trend-holo'] ?? p['trend-foil']), r2(p['avg1-holo'] ?? p['avg1-foil']), r2(p['avg7-holo'] ?? p['avg7-foil']), r2(p['avg30-holo'] ?? p['avg30-foil']), r2(p['avg-holo'] ?? p['avg-foil'])];
    const row = r.some(v => v != null) ? [...n, ...r] : n;
    while (row.length && row[row.length - 1] == null) row.pop();
    if (row.length) map.set(p.idProduct, row);
  }
  console.log(`  ${map.size} productos con precio (${data.createdAt || ''})`);
  // Catálogo de productos (nombre y expansión de cada uno): sirve para corregir cartas a las que
  // TCGdex les pone el producto de otra versión (p. ej. Raikou ex 033, 121 y 136 con el mismo).
  const cat = await getJSON(CM_CATALOG_G(game)).catch(e => { console.warn('  ! ' + e.message); return null; });
  const products = new Map(), siblings = new Map();
  for (const p of cat?.products || []) {
    products.set(p.idProduct, p);
    const k = `${p.idExpansion}|${p.name}`;
    (siblings.get(k) || siblings.set(k, []).get(k)).push(p.idProduct);
  }
  for (const v of siblings.values()) v.sort((a, b) => a - b);
  return { map, created: data.createdAt || null, products, siblings };
}

// Si varias cartas de una colección comparten producto de Cardmarket y Cardmarket tiene exactamente
// ese número de productos con el mismo nombre en esa expansión, se reparten en orden de número.
function fixSharedCm(cards, cm) {
  if (!cm.products?.size) return 0;
  const groups = new Map();
  for (const c of cards) if (c.cm) (groups.get(c.cm) || groups.set(c.cm, []).get(c.cm)).push(c);
  let fixed = 0;
  for (const [id, group] of groups) {
    if (group.length < 2) continue;
    const p = cm.products.get(id);
    const sib = p && cm.siblings.get(`${p.idExpansion}|${p.name}`);
    if (!sib || sib.length !== group.length) continue;
    group.forEach((c, i) => {
      if (c.cm === sib[i]) return;
      for (const v of c.v || []) if (v.cm === c.cm) v.cm = sib[i];
      c.cm = sib[i];
      fixed++;
    });
  }
  return fixed;
}

// ---------- CardTrader ----------
const CT_LANG = { jp: 'ja', ja: 'ja', en: 'en', es: 'es', it: 'it' };
// Estados de CardTrader: 0 Mint/Near Mint, 1 Slightly Played, 2 Moderately Played, 3 Played, 4 Poor.
const CT_COND = [/^(mint|near mint)$/i, /slightly/i, /moderately/i, /^played$/i, /poor/i];
let ctExpansions = null;
const CT_PARENT = { sma: 'sm115', rc: 'bw11' };   // subcolecciones → colección madre
// Colecciones cuyo nombre en CardTrader es distinto: código de su expansión allí.
const CT_CODE = { exu: 'suf', 'swsh10.5': 'pkmgo', ex7: 'trr', ex4: 'exma' };
const ctCache = new Map();   // expansion_id → { bps, market } (varias colecciones comparten expansión)
const ctFetch = p => getJSON(CT + p, { Authorization: `Bearer ${CT_TOKEN}` });
const ctSleep = ms => new Promise(r => setTimeout(r, ms));

async function ctExpansion(id) {
  if (!ctCache.has(id)) {
    const bps = await ctFetch(`/blueprints/export?expansion_id=${id}`).catch(e => { console.warn('  ! ' + e.message); return []; });
    await ctSleep(150);
    const market = await ctFetch(`/marketplace/products?expansion_id=${id}`).catch(e => { console.warn('  ! ' + e.message); return {}; });
    await ctSleep(150);
    ctCache.set(id, { bps: bps || [], market: market || {} });
  }
  return ctCache.get(id);
}

// Expansiones de CardTrader candidatas para una colección: mismo nombre, mismo código, o las de la colección
// "madre" (las Galerías de Entrenador, Shiny Vault… van dentro de la expansión principal en CardTrader).
function ctExpansionsFor(setMeta, parentMeta) {
  if (setMeta.game === 'op') return [{ id: setMeta.ct }];   // One Piece: su expansión de CardTrader
  if (setMeta.ct) return ctExpansions.filter(e => e.id === setMeta.ct);
  const metas = [setMeta, parentMeta].filter(Boolean);
  const names = new Set(metas.flatMap(m => [m.name.en, m.name.ja]).filter(Boolean).map(normName));
  const codes = new Set(metas.map(m => normName(m.code)).filter(Boolean));
  return ctExpansions.filter(e => {
    const jp = /japan|\bjp\b/i.test(`${e.name} ${e.code}`);
    if (!!setMeta.japanese !== jp) return false;
    const n = normName(e.name);
    return e.code === CT_CODE[setMeta.id] || names.has(n) || names.has(n.replace(/ jp$/, '')) || codes.has(normName(e.code));
  });
}

// Precio más barato en NM/Mint por idioma de cada carta. Las cartas se emparejan con los "blueprints" de
// CardTrader por el id de producto de Cardmarket (lo traen los dos) y, si no hay, por número y nombre.
// Nombre en inglés de cada especie por nº de Pokédex, sacado del catálogo occidental (el nombre más repetido).
let speciesCache = null;
async function speciesNames() {
  if (speciesCache) return speciesCache;
  const count = new Map();
  for (const f of await readdir(path.join(DATA, 'sets'))) {
    if (f.startsWith('jp-') || f === 'M6a.json') continue;
    const set = await readJSON(path.join(DATA, 'sets', f));
    for (const c of set?.cards || []) {
      if (c.cat !== 'Pokemon' || c.dex?.length !== 1 || !c.name?.en) continue;
      const m = count.get(c.dex[0]) || count.set(c.dex[0], new Map()).get(c.dex[0]);
      m.set(c.name.en, (m.get(c.name.en) || 0) + 1);
    }
  }
  speciesCache = new Map([...count].map(([d, m]) => [d, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
  return speciesCache;
}

// Suma los anuncios de una carta: precio más barato NM y anuncios (n/nc, r/rc), y por estado (c/cc).
function addListings(e, products, setMeta) {
  for (const p of products) {
    const pr = p.properties_hash || {};
    if (p.graded || pr.graded || pr.signed || pr.altered || pr.first_edition) continue;
    const cond = CT_COND.findIndex(re => re.test(pr.condition || 'Near Mint'));
    if (cond < 0) continue;
    const lang = CT_LANG[String(pr.pokemon_language || pr.onepiece_language || (setMeta.japanese ? 'ja' : '')).toLowerCase()];
    if (!lang) continue;
    const cents = p.price?.cents ?? p.price_cents;
    if (!cents || (p.price?.currency ?? p.price_currency ?? 'EUR') !== 'EUR') continue;
    const kind = pr.pokemon_reverse || pr.reverse ? 'r' : 'n';
    const l = e[lang] || (e[lang] = {});
    const price = cents / 100;
    if (cond === 0) {
      if (!l[kind] || price < l[kind]) l[kind] = price;
      l[kind + 'c'] = (l[kind + 'c'] || 0) + (p.quantity || 1);
    }
    if (kind === 'n') {
      const c = l.c || (l.c = [null, null, null, null, null]), cc = l.cc || (l.cc = [0, 0, 0, 0, 0]);
      if (c[cond] == null || price < c[cond]) c[cond] = price;
      cc[cond] += p.quantity || 1;
    }
  }
}

// El listado de toda la colección que da CardTrader se deja algunos anuncios (p. ej. el Lugia de la
// Colección Clásica a 180 € en español solo salía al pedir la carta sola). Las cartas con pocos anuncios
// en algún idioma y precio de más de 10 € se vuelven a pedir una a una (como mucho CT_RECHECK al día).
const CT_RECHECK = 2500;
let ctRechecked = 0;
async function recheckFew(out, setMeta) {
  for (const e of Object.values(out)) {
    if (ctRechecked >= CT_RECHECK) return;
    const few = ['es', 'en', 'it', 'ja'].some(l => e[l]?.n > 10 && (e[l].nc || 0) <= 2);
    if (!few) continue;
    ctRechecked++;
    const res = await ctFetch(`/marketplace/products?blueprint_id=${e.bp}`).catch(() => null);
    await ctSleep(120);
    const products = res?.[e.bp] || res?.[String(e.bp)];
    if (!products?.length) continue;
    for (const k of Object.keys(e)) if (k !== 'bp') delete e[k];
    addListings(e, products, setMeta);
  }
}

async function cardTraderForSet(setMeta, cards, parentMeta) {
  if (!ctExpansions) ctExpansions = ((await ctFetch('/expansions')) || []).filter(e => e.game_id === 5);
  const exps = ctExpansionsFor(setMeta, parentMeta);
  if (!exps.length) return null;
  const byCm = new Map(), byCt = new Map();
  // Un producto de Cardmarket que comparten varias cartas no sirve para saber cuál es cuál:
  // esas cartas se emparejan por número y nombre.
  const cmCount = new Map();
  for (const c of cards) if (c.cm) cmCount.set(c.cm, (cmCount.get(c.cm) || 0) + 1);
  const shared = new Set(cards.filter(c => c.cm && cmCount.get(c.cm) > 1).map(c => c.id));
  for (const c of cards) {
    if (shared.has(c.id)) continue;
    if (c.cm) byCm.set(c.cm, c.id);
    for (const v of c.v || []) { if (v.cm) byCm.set(v.cm, c.id); if (v.ct) byCt.set(v.ct, c.id); }
  }
  // Si no casan por id de Cardmarket: por número y nombre (en las japonesas, solo por número,
  // porque CardTrader las tiene con el nombre en inglés y otros ids de Cardmarket).
  const numKey = n => String(n ?? '').split('/')[0].replace(/^0+(?=\w)/, '').toUpperCase();
  // Primera palabra del nombre: «Pikachu Star» (TCGdex) y «Pikachu ☆ Gold Star» (CardTrader) casan por «pikachu».
  const fallbackKey = (num, name) => (setMeta.japanese ? numKey(num) : `${numKey(num)}|${normName(name).split(' ')[0]}`);
  const out = {};
  let imgAdded = 0, changed = 0;
  for (const exp of exps) {
    const { bps, market } = await ctExpansion(exp.id);
    const bpCard = new Map();
    const matched = new Set();
    for (const bp of bps) {
      let id = byCt.get(bp.id);
      for (const cm of bp.card_market_ids || []) if (!id) id = byCm.get(cm);
      if (id) { bpCard.set(bp.id, id); matched.add(id); }
    }
    // Japonesas antiguas: CardTrader no tiene número de carta y el orden no siempre coincide.
    // Pokémon: por nombre de especie (nº de Pokédex de TCGdex → nombre en inglés del catálogo occidental).
    // Energías: por tipo. Entrenadores: en orden.
    if (setMeta.ct && setMeta.japanese) {
      const species = await speciesNames();
      const singles = bps.filter(b => b.category_id === 73).sort((a, b) => a.id - b.id);
      const free = new Set(cards.map(c => c.id));
      const take = (bp, card) => {
        free.delete(card.id); bpCard.set(bp.id, card.id);
        if (card.name.en !== bp.name) { card.name.en = bp.name; changed++; }
      };
      const words = x => ` ${normName(x)} `;
      const ENERGY = [['grass', '草'], ['fire', '炎'], ['water', '水'], ['light', '雷'], ['psychic', '超'], ['fighting', '闘'], ['dark', '悪'], ['metal', '鋼'], ['colorless', '無色']];
      const energyOf = (txt, jp) => ENERGY.find(([en, ja]) => (jp ? txt.includes(ja) : normName(txt).includes(en)))?.[0];
      const pending = [];
      const isEnergyBp = bp => /(^| )energy$/.test(normName(bp.name).replace(/ (holo|rare|jp)$/g, ''));   // "Fire Energy", no "Energy Removal"
      for (const bp of singles) {
        const nm = words(bp.name);
        if (isEnergyBp(bp)) {
          const dbl = / double /.test(nm);
          const type = energyOf(bp.name, false);
          const card = cards.find(c => free.has(c.id) && c.cat === 'Energy' && /ダブル/.test(c.name.ja || '') === dbl && energyOf(c.name.ja || '', true) === type);
          if (card) { take(bp, card); continue; }
        }
        const card = cards.find(c => free.has(c.id) && c.cat === 'Pokemon' && (c.dex || []).some(d => species.has(d) && nm.includes(words(species.get(d)))));
        if (card) take(bp, card); else pending.push(bp);
      }
      // Lo que queda, en orden: energías especiales con energías, y el resto (entrenadores) con el resto.
      for (const energy of [true, false]) {
        const rest = cards.filter(c => free.has(c.id) && (c.cat === 'Energy') === energy);
        pending.filter(bp => isEnergyBp(bp) === energy).forEach((bp, i) => { if (rest[i]) take(bp, rest[i]); });
      }
      const left = cards.filter(c => free.has(c.id));
      pending.filter(bp => !bpCard.has(bp.id)).forEach((bp, i) => { if (left[i]) take(bp, left[i]); });
      if (free.size) console.warn(`  ! CardTrader ${setMeta.id}: ${free.size} cartas sin pareja`);
    }
    const rest = new Map(cards.filter(c => !matched.has(c.id)).map(c => [fallbackKey(c.num, c.name.en || c.name.ja), c.id]));
    if (rest.size) for (const bp of bps) {
      if (bpCard.has(bp.id) || !bp.fixed_properties?.collector_number) continue;
      const id = rest.get(fallbackKey(bp.fixed_properties.collector_number, bp.name));
      if (id) {
        bpCard.set(bp.id, id);
        // Si la carta tenía un producto de Cardmarket compartido (de otra versión), se usa el que da CardTrader.
        const card = cards.find(c => c.id === id), cmId = bp.card_market_ids?.[0];
        if (card && (shared.has(id) || !card.cm) && cmId && cmId !== card.cm) {   // compartido o sin producto
          for (const v of card.v || []) if (v.cm === card.cm || (!card.cm && !v.cm && v.t !== 'reverse')) v.cm = cmId;
          card.cm = cmId; changed++;
        }
      }
    }
    // Imagen de CardTrader para las cartas que no tienen en ningún otro sitio.
    const need = new Set(cards.filter(c => (setMeta.ct && setMeta.japanese) || (!c.im && (c.noimg || !setMeta.imgLangs?.length))).map(c => c.id));
    if (need.size) for (const bp of bps) {
      const id = bpCard.get(bp.id);
      if (!need.has(id) || !bp.image?.url) continue;
      const card = cards.find(c => c.id === id);
      const url = `https://www.cardtrader.com${bp.image.url}`;
      if (card.im?.[1] === url) { need.delete(id); continue; }
      card.im = [`https://www.cardtrader.com${bp.image.show?.url || bp.image.url}`, `https://www.cardtrader.com${bp.image.url}`];
      need.delete(id);
      imgAdded++;
    }
    for (const [bpId, products] of Object.entries(market)) {
      const cardId = bpCard.get(Number(bpId));
      if (!cardId) continue;
      const e = out[cardId] || (out[cardId] = { bp: Number(bpId) });
      addListings(e, products, setMeta);
    }
  }
  await recheckFew(out, setMeta);
  // El desglose por estado solo se guarda si hay algo más que NM (así los archivos no crecen de más).
  for (const e of Object.values(out)) for (const l of Object.values(e)) {
    if (typeof l !== 'object' || !l.cc) continue;
    if (!l.cc.slice(1).some(Boolean)) { delete l.c; delete l.cc; }
  }
  return Object.keys(out).length || imgAdded || changed ? { prices: Object.keys(out).length ? out : null, imgAdded, changed } : null;
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
  const missing = index.filter(m => !m.logo && m.game !== 'op');   // One Piece no tiene logos en estas fuentes
  if (!missing.length) return;
  for (const m of missing) {
    for (const l of ['en', 'es', 'fr', 'de', 'it', 'pt']) {
      if (m.japanese) break;
      const x = await getJSON(`${TCGDEX}/${l}/sets/${encodeURIComponent(m.id)}`, {}, 1).catch(() => null);
      if (x?.logo && (await fetch(`${x.logo}.webp`, { method: 'HEAD' }).catch(() => null))?.ok) { m.logo = x.logo; break; }
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
  if (!m.japanese || m.imgLangs?.length || m.ct) return 0;   // las antiguas (con `ct`) salen de CardTrader
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

// ---------- huellas visuales para el escáner ----------
// Para cada carta: la ilustración reducida a 8×6 píxeles en color, normalizada (así da igual la luz de la foto).
// El escáner compara la foto con todas para encontrar la carta aunque no consiga leer el texto.
// Se guardan en data/sigs.bin en el mismo orden que search.json (144 bytes por carta).
const SIG_W = 8, SIG_H = 6, SIG_LEN = SIG_W * SIG_H * 3;
const IMG_BASE = 'https://assets.tcgdex.net';
function cardImageUrl(meta, card) {
  if (card.im) return card.im[0];
  if (!meta.imgLangs?.length || card.noimg) return null;
  const l = meta.imgLangs.includes('en') ? 'en' : meta.imgLangs[0];
  return `${IMG_BASE}/${l}/${meta.serie}/${meta.id}/${encodeURIComponent(card.num)}/low.webp`;
}
async function loadSharp() {
  try { return (await import(process.env.SHARP_PATH || 'sharp')).default; } catch { return null; }
}
async function sigOf(sharp, url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return null;
  const img = sharp(Buffer.from(await res.arrayBuffer()));
  const { width: w, height: h } = await img.metadata();
  if (!w || !h) return null;
  const raw = await img.extract({ left: Math.round(w * 0.09), top: Math.round(h * 0.11), width: Math.round(w * 0.82), height: Math.round(h * 0.40) })
    .removeAlpha().resize(SIG_W, SIG_H, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer();
  const n = SIG_W * SIG_H, out = Buffer.alloc(SIG_LEN);
  for (let ch = 0; ch < 3; ch++) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += raw[i * 3 + ch];
    mean /= n;
    let sd = 0;
    for (let i = 0; i < n; i++) sd += (raw[i * 3 + ch] - mean) ** 2;
    sd = Math.sqrt(sd / n) || 1;
    for (let i = 0; i < n; i++) out.writeInt8(Math.max(-127, Math.min(127, Math.round(((raw[i * 3 + ch] - mean) / sd) * 40))), ch * n + i);
  }
  return out;
}
async function buildSignatures(index, search) {
  const sharp = await loadSharp();
  if (!sharp) { console.log('· Sin la librería sharp: no se calculan las huellas del escáner.'); return; }
  const cacheFile = path.join(DATA, 'sigcache.json');
  const cache = await readJSON(cacheFile, {});
  const metas = new Map(index.map(m => [m.id, m]));
  const cardsBySet = new Map();
  const todo = [];
  for (const row of search) {
    const [id, setId] = row;
    if (!cardsBySet.has(setId)) {
      const c = await readJSON(path.join(DATA, 'sets', `${setId}.json`));
      cardsBySet.set(setId, new Map((c?.cards || []).map(x => [x.id, x])));
    }
    const card = cardsBySet.get(setId).get(id);
    const url = card && cardImageUrl(metas.get(setId), card);
    if (url && cache[id]?.[0] !== url) todo.push([id, url]);
  }
  let done = 0, fail = 0;
  await pool(todo, 16, async ([id, url]) => {
    const sig = await sigOf(sharp, url).catch(() => null);
    if (sig) { cache[id] = [url, sig.toString('base64')]; done++; } else fail++;
    if ((done + fail) % 2000 === 0) console.log(`  huellas: ${done + fail}/${todo.length}`);
  });
  await writeJSON(cacheFile, cache);
  const bin = Buffer.alloc(search.length * SIG_LEN);
  let have = 0;
  search.forEach((row, i) => { const c = cache[row[0]]; if (c) { Buffer.from(c[1], 'base64').copy(bin, i * SIG_LEN); have++; } });
  await writeFile(path.join(DATA, 'sigs.bin'), bin);
  console.log(`· Huellas del escáner: ${have}/${search.length} cartas (${done} nuevas, ${fail} sin imagen).`);
}

// ---------- One Piece (CardTrader + Cardmarket) ----------
// Colecciones en inglés: sobres OP, Extra Boosters EB, Premium Boosters PRB/PEB y barajas ST (sin promos).
// Cartas, rarezas e imágenes de CardTrader; precio de Cardmarket (archivo 18) y de CardTrader en inglés.
// El año de cada colección sale de cuándo Cardmarket añadió sus cartas (CardTrader no da fechas).
const OP_SETS = /^(op\d{2}|eb-?\d{2}|prb\d{2}|peb\d{2}|st-?\d{2})$/i;
async function onePieceSets() {
  if (!CT_TOKEN) return [];
  const all = (await ctFetch('/expansions').catch(() => [])) || [];
  if (!ctExpansions) ctExpansions = all.filter(e => e.game_id === 5);
  return all.filter(e => e.game_id === 15 && OP_SETS.test(e.code)).map(e => {
    const m = /^\s*([A-Za-z]+)-?\s?(\d+)\s*:?\s*(.*)$/.exec(e.name) || [];
    const fromCode = /^([a-z]+)-?(\d+)$/i.exec(e.code);
    const prefix = (m[1] || fromCode?.[1] || e.code).toUpperCase(), n = String(m[2] || fromCode?.[2] || '').padStart(2, '0');
    const title = (m[3] || '').trim();
    return { id: `op-${e.code.toLowerCase().replace(/[^a-z0-9]/g, '')}`, game: 'op', ct: e.id, code: `${prefix}-${n}`,
      title: title || e.name, serie: 'op', langs: ['en'], count: 0 };
  });
}
async function buildOnePieceSet(s, cmop) {
  const { bps } = await ctExpansion(s.ct);
  const singles = bps.filter(b => b.category_id === 192 || b.fixed_properties?.collector_number);
  if (!singles.length) return null;
  const used = new Set(), dates = [];
  const cards = singles.map(b => {
    const num = String(b.fixed_properties?.collector_number || b.id);
    let id = `${s.id}-${num}`.replace(/\s+/g, '');
    if (used.has(id)) id += `-${b.id}`;
    used.add(id);
    // De los productos de Cardmarket de la carta, el más antiguo es el de esta colección (los otros son reimpresiones).
    const cms = (b.card_market_ids || []).filter(x => cmop.products?.has(x)).sort((x, y) => (cmop.products.get(x).dateAdded || '').localeCompare(cmop.products.get(y).dateAdded || ''));
    const cm = cms[0] || b.card_market_ids?.[0] || null;
    const da = cm && cmop.products?.get(cm)?.dateAdded;
    if (da && !da.startsWith('0000')) dates.push(da.slice(0, 10));
    const img = b.image?.url ? `https://www.cardtrader.com${b.image.url}` : null;
    return {
      id, num, name: { en: b.name, es: b.name }, rarity: b.fixed_properties?.onepiece_rarity || null, cat: null,
      ...(b.version ? { ver: b.version } : {}), cm,
      v: [{ k: 'normal', t: 'normal', ct: b.id, ...(cm ? { cm } : {}) }],
      ...(img ? { im: [`https://www.cardtrader.com${b.image.show?.url || b.image.url}`, img] } : {}),
    };
  });
  const key = n => n.replace(/(\d+)/g, d => d.padStart(5, '0'));
  cards.sort((a, b) => key(a.num).localeCompare(key(b.num)));
  dates.sort();
  const release = dates[Math.floor(dates.length * 0.1)] || null;   // casi la primera fecha (sin hacer caso a algún error)
  const meta = {
    id: s.id, game: 'op', code: s.code, name: { en: s.title, es: s.title }, langs: ['en'], imgLangs: [],
    serie: 'op', serieName: release ? release.slice(0, 4) : 'One Piece', total: cards.length, official: null,
    release, logo: null, symbol: null, japanese: false, ct: s.ct,
  };
  return { set: meta, cards };
}

// ---------- main ----------
async function main() {
  for (const d of ['sets', 'prices', 'history']) await mkdir(path.join(DATA, d), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const oldIndex = await readJSON(path.join(DATA, 'index.json'), { sets: [] });
  const oldMeta = new Map(oldIndex.sets.map(s => [s.id, s]));

  let todo = [...await listSets(), ...await onePieceSets().catch(e => { console.warn('  ! One Piece: ' + e.message); return []; })];
  if (ONLY.length) todo = todo.filter(s => ONLY.includes(s.id));
  console.log(`· ${todo.length} colecciones`);

  const cm = await cardmarketPrices(6);
  const cmop = todo.some(s => s.game === 'op') ? await cardmarketPrices(18) : { map: new Map() };
  const index = [];
  const search = [];
  let ctOk = false;

  for (const s of todo) {
    const file = path.join(DATA, 'sets', `${s.id}.json`);
    let cached = await readJSON(file);
    const prev = oldMeta.get(s.id);
    const stale = FORCE || !cached || !prev || daysSince(prev.release) < RECENT_DAYS || (s.count && prev.total !== s.count);
    let meta;
    if (s.game === 'op') {
      // One Piece: se rehace cada día desde CardTrader (es rápido y así entran las cartas nuevas).
      const built = await buildOnePieceSet(s, cmop).catch(e => { console.warn(`  ! ${s.id}: ${e.message}`); return null; });
      if (!built) { if (!cached) continue; } else { cached = built; await writeJSON(file, cached); }
      meta = cached.set;
    } else if (stale) {
      process.stdout.write(`· ${s.id}: descargando cartas… `);
      const built = await buildSetCards(s.id, s.langs, s.detailLang, s.src || s.id);
      if (!built) { console.log('no disponible'); continue; }
      const info = built.info;
      // Si TCGdex falló con alguna carta (503…), se conserva lo que teníamos de ella.
      if (cached) {
        const prevCards = new Map(cached.cards.map(c => [c.id, c]));
        built.cards = built.cards.map(c => (!c.v && prevCards.has(c.id) ? { ...prevCards.get(c.id), name: c.name } : c));
      }
      const names = {};
      for (const l of s.langs) {
        const x = l === s.detailLang ? info : await getJSON(`${TCGDEX}/${l}/sets/${encodeURIComponent(s.src || s.id)}`).catch(() => null);
        if (x?.name) names[l] = x.name;
      }
      if (!names.es && !s.japanese) names.es = names.en;
      if (s.es) names.es = s.es;
      meta = {
        id: s.id, code: s.code || info.abbreviation?.official || s.id.toUpperCase(),
        name: names, langs: s.langs, imgLangs: built.imgLangs,
        serie: s.serie, serieName: s.serieName,
        total: info.cardCount?.total || built.cards.length, official: info.cardCount?.official || null,
        release: info.releaseDate || null, logo: info.logo || null, symbol: info.symbol || null,
        japanese: !!s.japanese, ...(s.ct ? { ct: s.ct } : {}), ...(s.logo ? { logoFrom: s.logo } : {}),
      };
      cached = { set: meta, cards: built.cards };
      await writeJSON(file, cached);
      console.log(`${built.cards.length} cartas`);
    } else {
      meta = cached.set;
    }
    index.push(meta);
    // Colecciones sin imágenes en TCGdex: se buscan en otras webs (antes de CardTrader, que es el último recurso).
    if (!meta.imgLangs?.length && !cached.cards.every(x => x.im)) {
      const n = meta.japanese ? await fillImagesJapanese(meta, cached.cards) : await fillImages(meta, cached.cards);
      if (n) { await writeJSON(file, cached); console.log(`· ${s.id}: ${n} imágenes de ${meta.japanese ? 'Limitless / pokemon-card.com' : 'pokemontcg.io'}`); }
    }

    const cmg = s.game === 'op' ? cmop : cm;   // precios de Cardmarket del juego de esta colección
    const fixedCm = s.game === 'op' ? 0 : fixSharedCm(cached.cards, cm);
    if (fixedCm) { await writeJSON(file, cached); console.log(`· ${s.id}: ${fixedCm} cartas con su producto de Cardmarket corregido`); }

    // Precios del día de esta colección
    const prices = { updated: today, cm: {}, ct: null };
    const products = new Set();
    for (const c of cached.cards) {
      if (c.cm) products.add(c.cm);
      for (const v of c.v || []) if (v.cm) products.add(v.cm);
    }
    if (CT_TOKEN) {
      try {
        const pid = CT_PARENT[s.id] || s.id.replace(/(tg|sv|gg|cc|-c)$/, '');
        const parent = pid !== s.id ? (await readJSON(path.join(DATA, 'sets', `${pid}.json`)))?.set : null;
        const ct = await cardTraderForSet(meta, cached.cards, parent);
        if (ct?.prices) { prices.ct = ct.prices; ctOk = true; }
        if (ct?.imgAdded || ct?.changed) { await writeJSON(file, cached); if (ct.imgAdded) console.log(`· ${s.id}: ${ct.imgAdded} imágenes de CardTrader`); }
      } catch (e) { console.warn(`  ! CardTrader ${s.id}: ${e.message}`); }
    }
    // Precio de Cardmarket de cada producto (después de CardTrader, que puede haber corregido alguno)
    for (const c of cached.cards) { if (c.cm) products.add(c.cm); for (const v of c.v || []) if (v.cm) products.add(v.cm); }
    for (const id of products) if (cmg.map.has(id)) prices.cm[id] = cmg.map.get(id);
    await writeJSON(path.join(DATA, 'prices', `${s.id}.json`), prices);

    // Índice de búsqueda (después de CardTrader, que pone el nombre en inglés a las japonesas antiguas)
    for (const c of cached.cards) {
      const row = [c.id, s.id, c.num, c.name.en || c.name.ja || c.name.es || ''];
      const es = c.name.es && c.name.es !== row[3] ? c.name.es : 0;
      const it = c.name.it && c.name.it !== row[3] ? c.name.it : 0;
      if (es || it) row.push(es);
      if (it) row.push(it);
      search.push(row);
    }
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

  for (const m of index) if (NAME_ES[m.id] && m.name.es !== NAME_ES[m.id]) {
    m.name.es = NAME_ES[m.id];
    const file = path.join(DATA, 'sets', `${m.id}.json`);
    const c = await readJSON(file);
    if (c) { c.set.name.es = NAME_ES[m.id]; await writeJSON(file, c); }
  }
  // Logos de TCGdex que dan 404 (p. ej. Undaunted): se descartan para buscar otro.
  await pool(index.filter(m => m.logo?.startsWith('https://assets.tcgdex.net/')), 10, async m => {
    const r = await fetch(`${m.logo}.webp`, { method: 'HEAD' }).catch(() => null);
    if (r?.status === 404) m.logo = null;
  });
  // Japonesas antiguas: el logo de su equivalente occidental.
  for (const m of index) if (!m.logo && m.logoFrom) m.logo = index.find(x => x.id === m.logoFrom)?.logo || null;
  const noLogo = index.filter(m => !m.logo);
  await fillLogos(index);
  for (const m of noLogo) if (m.logo) {   // se guarda en el archivo de la colección para no buscarlo cada día
    const file = path.join(DATA, 'sets', `${m.id}.json`);
    const c = await readJSON(file);
    if (c) { c.set.logo = m.logo; await writeJSON(file, c); }
  }
  await writeJSON(path.join(DATA, 'index.json'), { updated: today, cmCreated: cm.created, ct: ctOk || (!CT_TOKEN ? false : oldIndex.ct), sets: index });
  await writeJSON(path.join(DATA, 'search.json'), search);
  await buildSignatures(index, search);
  if (!CT_TOKEN) console.log('· Sin CARDTRADER_TOKEN: se omiten los precios por idioma de CardTrader.');
  else console.log(`· CardTrader: ${ctRechecked} cartas con pocos anuncios revisadas una a una.`);
  console.log(`✓ ${index.length} colecciones, ${search.length} cartas.`);
}

main().catch(e => { console.error(e); process.exit(1); });
