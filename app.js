const AMENITY_LABEL = {
  chan: 'чан', sauna: 'сауна', pool: 'басейн', jacuzzi: 'джакузі', bbq: 'мангал',
  fireplace: 'камін', terrace: 'тераса', garden: 'сад', kitchen: 'кухня', wifi: 'wi-fi',
  parking: 'паркінг', projector: 'проєктор', billiards: 'більярд', playground: 'дитячий майданчик',
  lake_view: 'біля води', forest: 'ліс', heating: 'опалення', ac: 'кондиціонер',
  pets_allowed: 'з тваринами', wheelchair: 'безбар\'єрний',
  shelter: 'укриття', backup_power: 'генератор', no_neighbours: 'без сусідів',
  ski: 'лижі поруч', mountain_view: 'вид на гори',
}
// the amenities people actually choose a cottage by; the rest sit behind "ще…"
const AMENITY_TOP = ['chan', 'sauna', 'pool', 'fireplace', 'no_neighbours', 'forest',
  'lake_view', 'mountain_view', 'pets_allowed', 'backup_power']
const TYPE_LABEL = {
  cottage: 'котедж', 'a-frame': 'A-frame', sadyba: 'садиба', house: 'будинок',
  glamping: 'глемпінг', complex: 'комплекс', apartment: 'апартаменти',
}

const $ = (s) => document.querySelector(s)
const grid = $('#grid')
const money = (n) => n?.toLocaleString('uk-UA') ?? '—'
const DAY = 86400000

// Photos are ~600 MB, far too much to keep in git. Locally they are served from
// ./images/; the published build points IMAGES_BASE at object storage. See config.js.
const imgUrl = (id, file) => `${window.IMAGES_BASE ?? ''}images/${id}/${file}`
// Cards get a 400px cover (~23 KB) instead of the 1200px gallery file (~139 KB). The
// thumbs tier only exists in the published build, so locally fall back to the original.
const thumbUrl = (id, file) =>
  window.IMAGES_BASE ? `${window.IMAGES_BASE}thumbs/${id}/${file}` : imgUrl(id, file)

let lots = []
const picked = new Set()
const quick = new Set()

// Favourites live in localStorage — no account, no server, survives a reload.
const FAV_KEY = 'lviv-cottages:favs'
const readFavs = () => {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY)) || []) } catch { return new Set() }
}
let favs = readFavs()
const saveFavs = () => { try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])) } catch {} }

// ---------- derived facts about a lot ----------

const isLive = (l) => l.status !== 'duplicate' && l.status !== 'rejected'
// the price before the most recent change, if it changed
const prevPrice = (l) => l.price?.history?.at(-1)?.amount ?? null
const dropPct = (l) => {
  const was = prevPrice(l), now = l.price?.amount
  return was && now && now < was ? Math.round((was - now) / was * 100) : 0
}
// "new" means added to this board within the last six weeks — not first published on
// the source site, which we cannot know
const isNew = (l) => l.added_at && Date.now() - Date.parse(l.added_at) < 42 * DAY
// a lot whose price or capacity looks wrong must LOOK wrong — otherwise a stale
// "800 ₴ for 14 guests" quietly wins the price sort and reads as the best deal
const CHECK = { 'перевірити-ціну': 'ціна?', 'перевірити-місткість': 'місткість?', 'перевірити-локацію': 'локація?' }
const checks = (l) => (l.tags ?? []).filter((t) => CHECK[t]).map((t) => CHECK[t])

// Recommended: rating shrunk towards a prior by review count, so one 5★ review does
// not outrank forty 4.9★ ones; unrated places sit just under the prior. Listings with
// a data warning, no price or few photos are nudged down; distance breaks near-ties.
const PRIOR = 4.6, WEIGHT = 6
function recScore(l) {
  const r = l.rating
  let s = r?.count ? (PRIOR * WEIGHT + r.score * r.count) / (WEIGHT + r.count) : PRIOR - 0.2
  if (checks(l).length) s -= 0.6
  if (!l.price?.amount) s -= 0.3
  if ((l.images?.length ?? 0) < 4) s -= 0.15
  return s - Math.min(l.location?.distance_km ?? 150, 150) / 1500
}

// ---------- quick picks: the questions people actually arrive with ----------

const QUICK = [
  ['near', 'до 25 км', (l) => (l.location?.distance_km ?? 1e9) <= 25],
  ['chan', 'з чаном', (l) => l.amenities?.includes('chan')],
  ['group', 'компанія 10+', (l) => (l.capacity?.guests ?? 0) >= 10],
  ['ny', 'є ціна на Новий рік', (l) => !!l.price?.new_year_amount],
  ['top', 'рейтинг 4.8+', (l) => l.rating?.score >= 4.8 && l.rating.count >= 5],
  ['drop', 'подешевшало', (l) => dropPct(l) > 0],
  ['new', 'нові', isNew],
]
const QUICK_FN = Object.fromEntries(QUICK.map(([k, , f]) => [k, f]))

fetch('data/cottages.json')
  .then((r) => r.json())
  .then((data) => {
    lots = data
    buildFilters()
    readHash()
    render()
  })
  .catch(() => { $('#stats').textContent = 'не вдалось прочитати data/cottages.json — запусти через http-сервер' })

function buildFilters() {
  const live = lots.filter(isLive)
  const freq = {}
  for (const l of live) for (const a of l.amenities ?? []) freq[a] = (freq[a] ?? 0) + 1
  const used = Object.keys(freq)
  const top = AMENITY_TOP.filter((a) => freq[a])
  const rest = used.filter((a) => !top.includes(a))
    .sort((a, b) => (AMENITY_LABEL[a] ?? a).localeCompare(AMENITY_LABEL[b] ?? b, 'uk'))
  $('#amenities').innerHTML = [...top, ...rest]
    .map((a) => `<button class="chip${top.includes(a) ? '' : ' extra'}" data-a="${a}" aria-pressed="false">${
      AMENITY_LABEL[a] ?? a} <small>${freq[a]}</small></button>`)
    .join('')

  $('#quick').innerHTML = QUICK
    .filter(([, , f]) => live.some(f))   // never offer a pick that can only return nothing
    .map(([k, label]) => `<button class="pill" data-q="${k}" aria-pressed="false">${label}</button>`)
    .join('')

  const types = [...new Set(live.map((l) => l.type))].filter(Boolean)
  $('#type').insertAdjacentHTML('beforeend',
    types.map((t) => `<option value="${t}">${TYPE_LABEL[t] ?? t}</option>`).join(''))

  const near = live.filter((l) => (l.location?.distance_km ?? 1e9) <= 100).length
  const updated = live.map((l) => l.price?.updated_at).filter(Boolean).sort().at(-1)
  const when = updated ? new Date(updated).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  $('#stats').textContent = `${live.length} місць · ${near} у межах 100 км` + (when ? ` · ціни оновлено ${when}` : '')
  // say plainly which prices did NOT come from this refresh, rather than let one date
  // in the header vouch for all of them
  const stale = updated ? live.filter((l) => l.price?.amount && (l.price.updated_at ?? '') < updated).length : 0
  $('#fresh').textContent = when ? `Ціни оновлено ${when}` + (stale
    ? ` — крім ${stale} місць із власних сайтів, де ціну не видно без дзвінка; дата перевірки є на сторінці кожного місця.`
    : '.') : ''
}

// ---------- filtering ----------

function visible() {
  const q = $('#q').value.trim().toLowerCase()
  const pmin = +$('#pmin').value || 0
  const pmax = +$('#pmax').value || Infinity
  const guests = +$('#guests').value || 0
  const dist = +$('#dist').value || Infinity
  const type = $('#type').value
  const status = $('#status').value
  const onlyFavs = $('#onlyfav').getAttribute('aria-pressed') === 'true'

  return lots.filter((l) => {
    if (onlyFavs && !favs.has(l.id)) return false
    if ((l.location?.distance_km ?? Infinity) > dist) return false
    if (status === 'live') { if (!isLive(l)) return false }
    else if (status && l.status !== status) return false

    if (type && l.type !== type) return false
    if (guests && (l.capacity?.guests ?? 0) < guests) return false

    // a lot with no published price can't honestly satisfy a price range —
    // hide it as soon as either bound is set, rather than pretending it costs 0
    const price = l.price?.amount || null
    if (price == null) { if (pmin || pmax !== Infinity) return false }
    else if (price < pmin || price > pmax) return false

    for (const a of picked) if (!l.amenities?.includes(a)) return false
    for (const k of quick) if (!QUICK_FN[k](l)) return false

    if (q) {
      const hay = [l.name, l.description, l.notes, l.location?.settlement, l.location?.area, ...(l.tags ?? [])]
        .join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// unpriced lots sort to the bottom of both price orders — a missing price is not a cheap one
const asc = (l) => l.price?.amount || 1e9
const desc = (l) => l.price?.amount || -1
const ppg = (l) => (l.price?.amount || 1e9) / (l.capacity?.guests || 1)
const SORTS = {
  rec: (a, b) => recScore(b) - recScore(a),
  'price-asc': (a, b) => asc(a) - asc(b),
  'price-desc': (a, b) => desc(b) - desc(a),
  'guests-desc': (a, b) => (b.capacity?.guests ?? 0) - (a.capacity?.guests ?? 0),
  'dist-asc': (a, b) => (a.location?.distance_km ?? 1e9) - (b.location?.distance_km ?? 1e9),
  'rating-desc': (a, b) => (b.rating?.score ?? -1) - (a.rating?.score ?? -1) ||
    (b.rating?.count ?? 0) - (a.rating?.count ?? 0),
  'ppg-asc': (a, b) => ppg(a) - ppg(b),
  new: (a, b) => (b.added_at ?? '').localeCompare(a.added_at ?? '') || recScore(b) - recScore(a),
}

// 600+ cards at once is a lot of DOM and a lot of image requests; page them in
const PAGE = 60
let shown = PAGE
let view = 'grid'
let current = []

function render(reset = true) {
  if (reset) shown = PAGE
  const list = current = visible().sort(SORTS[$('#sort').value] ?? SORTS.rec)

  const prices = list.map((l) => l.price?.amount).filter(Boolean).sort((a, b) => a - b)
  const median = prices.length ? prices[prices.length >> 1] : null
  const n = list.length
  const word = n % 10 === 1 && n % 100 !== 11 ? 'місце'
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'місця' : 'місць'
  $('#count').innerHTML = `<b>${n}</b> ${word}` + (median ? ` · медіана ${money(median)} ₴/ніч` : '')

  $('#empty').hidden = n > 0
  if (view === 'map') {
    $('#more').hidden = true
    drawMap(list)
  } else {
    shown = Math.min(shown, Math.max(PAGE, n))   // never page past the end
    $('#more').hidden = n <= shown
    $('#more').textContent = `показати ще ${Math.max(0, Math.min(PAGE, n - shown))}`
    grid.innerHTML = list.slice(0, shown).map(card).join('')
  }
  countActive()
  writeHash()
}

function badges(l) {
  const out = []
  if (l.status === 'verified') out.push('<span class="badge ok">✓ перевірено</span>')
  const d = dropPct(l)
  if (d) out.push(`<span class="badge drop" title="було ${money(prevPrice(l))} ₴">−${d}%</span>`)
  if (isNew(l)) out.push('<span class="badge new">нове</span>')
  return out.length ? `<div class="badges">${out.join('')}</div>` : ''
}

function card(l) {
  const cover = l.images?.[0]
  const dist = l.location?.distance_km
  const warn = checks(l)
  const fav = favs.has(l.id)
  const r = l.rating
  // a real <a> so the card can be middle-clicked, bookmarked and link-copied;
  // target=_blank keeps the board and its filters open behind the detail page
  return `
  <article class="card" data-id="${l.id}">
    <a class="hit" href="lot/${l.id}.html" target="_blank" rel="noopener" aria-label="${esc(l.name)}"></a>
    <div class="cover">
      ${cover ? `<img loading="lazy" src="${thumbUrl(l.id, cover.file)}" alt="">` : '<div class="no-photo">без фото</div>'}
      ${badges(l)}
      <button class="fav${fav ? ' on' : ''}" data-fav="${l.id}" aria-pressed="${fav}"
              title="${fav ? 'Прибрати з обраного' : 'В обране'}">${fav ? '★' : '☆'}</button>
      <span class="price${warn.includes('ціна?') ? ' suspect' : ''}">${
        l.price?.amount ? `${l.type === 'complex' ? '<small>від</small> ' : ''}${money(l.price.amount)} ₴<small>/ніч</small>`
          : '<small>ціну уточнити</small>'}</span>
      ${l.images?.length > 1 ? `<span class="shots">${l.images.length} фото</span>` : ''}
    </div>
    <div class="body">
      <div class="titlerow">
        <h2>${esc(l.name)}</h2>
        ${r?.count ? `<span class="rating" title="${r.count} відгуків на ${esc(r.platform)}">★ ${r.score.toFixed(1)} <small>(${r.count})</small></span>` : ''}
      </div>
      <div class="where">${esc(l.location?.settlement ?? '')}${dist != null ? ` · ${dist} км` : ''}</div>
      <div class="facts">
        <span>${TYPE_LABEL[l.type] ?? l.type}</span>
        ${l.capacity?.guests ? `<span>до ${l.capacity.guests} гостей</span>` : ''}
        ${l.capacity?.bedrooms ? `<span>${l.capacity.bedrooms} сп.</span>` : ''}
      </div>
      ${l.tags?.includes('новий-рік-зайнято') ? '<div class="ny">Новий рік — <b>вже зайнято</b></div>'
        : l.price?.new_year_amount ? `<div class="ny">Новий рік — <b>${money(l.price.new_year_amount)} ₴</b></div>` : ''}
      <div class="tags">
        ${warn.map((w) => `<span class="tag warn" title="дані в оголошенні виглядають неповними">⚠ ${w}</span>`).join('')}
        ${(l.amenities ?? []).filter((a) => AMENITY_TOP.includes(a)).slice(0, 4)
          .map((a) => `<span class="tag">${AMENITY_LABEL[a] ?? a}</span>`).join('')}
      </div>
    </div>
  </article>`
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// ---------- map ----------
// Leaflet is ~150 KB; most visits never open the map, so it loads on first use.

let map, layer, leaflet
function loadLeaflet() {
  return leaflet ??= new Promise((ok, fail) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
    css.crossOrigin = ''
    document.head.append(css)
    const js = document.createElement('script')
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    js.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='
    js.crossOrigin = ''
    js.onload = ok
    js.onerror = () => { leaflet = null; fail(new Error('leaflet')) }
    document.head.append(js)
  })
}

const short = (n) => !n ? '?' : n >= 10000 ? Math.round(n / 1000) + 'k' : (n / 1000).toFixed(1).replace('.0', '') + 'k'

async function drawMap(list) {
  try { await loadLeaflet() } catch {
    $('#map').innerHTML = '<p class="maperr">Не вдалось завантажити мапу. Перевір з\'єднання.</p>'
    return
  }
  if (view !== 'map') return
  if (!map) {
    // no tile fade: it runs on requestAnimationFrame, and a tile that loads while the tab is
    // throttled can be left stuck at opacity 0
    map = L.map('map', { fadeAnimation: false }).setView([49.84, 24.03], 9)
    // OpenStreetMap's own tiles: no key, attribution required. (CARTO's basemaps
    // started demanding an API key.) Dark mode inverts them in CSS — see .map.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    L.marker([49.8397, 24.0297], {
      icon: L.divIcon({ className: 'pin-city', html: '<span>Львів</span>', iconSize: null }),
      interactive: false, keyboard: false,
    }).addTo(map)
    layer = L.layerGroup().addTo(map)
  }
  map.invalidateSize()
  layer.clearLayers()
  const pts = []
  // draw best last, so on overlap the recommended pin sits on top
  for (const l of [...list].reverse()) {
    const { lat, lng } = l.location ?? {}
    if (!lat || !lng) continue
    pts.push([lat, lng])
    const fav = favs.has(l.id)
    L.marker([lat, lng], {
      icon: L.divIcon({ className: 'pin' + (fav ? ' fav' : ''), html: `<span>${short(l.price?.amount)}</span>`, iconSize: null }),
      title: l.name,
    }).bindPopup(popup(l), { maxWidth: 260, minWidth: 220 }).addTo(layer)
  }
  if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 12 })
}

function popup(l) {
  const cover = l.images?.[0]
  return `<a class="pop" href="lot/${l.id}.html" target="_blank" rel="noopener">
    ${cover ? `<img src="${thumbUrl(l.id, cover.file)}" alt="">` : ''}
    <b>${esc(l.name)}</b>
    <span>${l.price?.amount ? money(l.price.amount) + ' ₴/ніч' : 'ціну уточнити'}${
      l.rating?.count ? ` · ★ ${l.rating.score.toFixed(1)} (${l.rating.count})` : ''}</span>
    <span>${esc(l.location?.settlement ?? '')} · ${l.location?.distance_km ?? '?'} км${
      l.capacity?.guests ? ` · до ${l.capacity.guests} гостей` : ''}</span>
  </a>`
}

function setView(v) {
  view = v
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === v))
  document.body.classList.toggle('mapview', v === 'map')
  grid.hidden = v === 'map'
  $('#map').hidden = v !== 'map'
  render(false)
}

// ---------- the URL carries view, quick picks and sort, so a filtered view is shareable ----------

function writeHash() {
  const p = new URLSearchParams()
  if (view !== 'grid') p.set('view', view)
  if (quick.size) p.set('q', [...quick].join(','))
  if (picked.size) p.set('a', [...picked].join(','))
  if ($('#sort').value !== 'rec') p.set('sort', $('#sort').value)
  if ($('#dist').value !== '100') p.set('km', $('#dist').value || 'any')
  const h = p.toString()
  history.replaceState(null, '', h ? '#' + h : location.pathname + location.search)
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1))
  for (const k of (p.get('q') ?? '').split(',')) if (QUICK_FN[k]) quick.add(k)
  for (const a of (p.get('a') ?? '').split(',')) if (AMENITY_LABEL[a]) picked.add(a)
  if (p.get('sort') && SORTS[p.get('sort')]) $('#sort').value = p.get('sort')
  if (p.has('km')) $('#dist').value = p.get('km') === 'any' ? '' : p.get('km')
  document.querySelectorAll('[data-q]').forEach((b) => b.setAttribute('aria-pressed', quick.has(b.dataset.q)))
  document.querySelectorAll('[data-a]').forEach((b) => b.setAttribute('aria-pressed', picked.has(b.dataset.a)))
  if (picked.size && [...picked].some((a) => !AMENITY_TOP.includes(a))) showAllAmenities(true)
  if (p.get('view') === 'map') setView('map')
}

// ---------- wiring ----------

document.querySelectorAll('#q, #pmin, #pmax, #guests, #dist, #type, #status, #sort')
  .forEach((el) => el.addEventListener('input', () => render()))

$('#more').addEventListener('click', () => { shown += PAGE; render(false) })
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)))

// the star sits on top of the card's link — stop it navigating
grid.addEventListener('click', (e) => {
  const b = e.target.closest('.fav')
  if (!b) return
  e.preventDefault()
  e.stopPropagation()
  const id = b.dataset.fav
  favs.has(id) ? favs.delete(id) : favs.add(id)
  saveFavs()
  render(false)
})

$('#quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-q]')
  if (!b) return
  const k = b.dataset.q
  quick.has(k) ? quick.delete(k) : quick.add(k)
  b.setAttribute('aria-pressed', quick.has(k))
  render()
})

$('#onlyfav').addEventListener('click', () => {
  const on = $('#onlyfav').getAttribute('aria-pressed') !== 'true'
  $('#onlyfav').setAttribute('aria-pressed', on)
  render()
})

// another tab may have changed the favourites
addEventListener('storage', (e) => {
  if (e.key !== FAV_KEY) return
  favs = readFavs()
  render(false)
})

// The full panel starts closed everywhere — the quick picks cover the common cases —
// and its summary carries a count, so a collapsed panel never hides an active filter.
const adv = $('#adv')
adv.addEventListener('toggle', () => { $('#advbody').hidden = !adv.open })
function countActive() {
  let n = picked.size
  for (const id of ['#pmin', '#pmax', '#guests']) if ($(id).value) n++
  if ($('#dist').value !== '100') n++
  if ($('#type').value) n++
  if ($('#status').value !== 'live') n++
  if ($('#onlyfav').getAttribute('aria-pressed') === 'true') n++
  const badge = $('#advcount')
  badge.hidden = n === 0
  badge.textContent = n
}

function showAllAmenities(on) {
  $('#amenities').classList.toggle('all', on)
  $('#moreamen').setAttribute('aria-expanded', on)
  $('#moreamen').textContent = on ? 'менше' : 'ще…'
}
$('#moreamen').addEventListener('click', () =>
  showAllAmenities($('#moreamen').getAttribute('aria-expanded') !== 'true'))

$('#amenities').addEventListener('click', (e) => {
  const b = e.target.closest('.chip')
  if (!b) return
  const a = b.dataset.a
  picked.has(a) ? picked.delete(a) : picked.add(a)
  b.setAttribute('aria-pressed', picked.has(a))
  render()
})

function resetAll() {
  $('#onlyfav').setAttribute('aria-pressed', 'false')
  document.querySelectorAll('#q, #pmin, #pmax, #guests').forEach((el) => (el.value = ''))
  $('#dist').value = '100'
  $('#type').value = ''
  $('#status').value = 'live'
  picked.clear()
  quick.clear()
  document.querySelectorAll('[data-a], [data-q]').forEach((c) => c.setAttribute('aria-pressed', 'false'))
  render()
}
$('#reset').addEventListener('click', resetAll)
$('#reset2').addEventListener('click', resetAll)
