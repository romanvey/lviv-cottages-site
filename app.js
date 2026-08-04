const AMENITY_LABEL = {
  chan: 'чан', sauna: 'сауна', pool: 'басейн', jacuzzi: 'джакузі', bbq: 'мангал',
  fireplace: 'камін', terrace: 'тераса', garden: 'сад', kitchen: 'кухня', wifi: 'wi-fi',
  parking: 'паркінг', projector: 'проєктор', billiards: 'більярд', playground: 'дитячий майданчик',
  lake_view: 'біля води', forest: 'ліс', heating: 'опалення', ac: 'кондиціонер',
  pets_allowed: 'з тваринами', wheelchair: 'безбар\'єрний',
  shelter: 'укриття', backup_power: 'генератор', no_neighbours: 'без сусідів',
  ski: 'лижі поруч', mountain_view: 'вид на гори',
}
const TYPE_LABEL = {
  cottage: 'котедж', 'a-frame': 'A-frame', sadyba: 'садиба', house: 'будинок',
  glamping: 'глемпінг', complex: 'комплекс', apartment: 'апартаменти',
}

const $ = (s) => document.querySelector(s)
const grid = $('#grid')
const money = (n) => n?.toLocaleString('uk-UA') ?? '—'

// Photos are ~600 MB, far too much to keep in git. Locally they are served from
// ./images/; the published build points IMAGES_BASE at object storage. See config.js.
const imgUrl = (id, file) => `${window.IMAGES_BASE ?? ''}images/${id}/${file}`
// Cards get a 400px cover (~23 KB) instead of the 1200px gallery file (~139 KB); with
// 60 cards on screen that is ~1 MB per page view rather than ~8 MB. The thumbs tier only
// exists in the published build — locally there is no thumbs/, so fall back to the
// original, which is what the local board has always shown.
const thumbUrl = (id, file) =>
  window.IMAGES_BASE ? `${window.IMAGES_BASE}thumbs/${id}/${file}` : imgUrl(id, file)

let lots = []
const picked = new Set()

fetch('data/cottages.json')
  .then((r) => r.json())
  .then((data) => {
    lots = data
    buildFilters()
    render()
  })
  .catch(() => { $('#count').textContent = 'не вдалось прочитати data/cottages.json — запусти через http-сервер' })

function buildFilters() {
  const used = new Set(lots.flatMap((l) => l.amenities ?? []))
  $('#amenities').innerHTML = [...used]
    .sort((a, b) => (AMENITY_LABEL[a] ?? a).localeCompare(AMENITY_LABEL[b] ?? b, 'uk'))
    .map((a) => `<button class="chip" data-a="${a}" aria-pressed="false">${AMENITY_LABEL[a] ?? a}</button>`)
    .join('')

  const types = [...new Set(lots.map((l) => l.type))].filter(Boolean)
  $('#type').insertAdjacentHTML('beforeend',
    types.map((t) => `<option value="${t}">${TYPE_LABEL[t] ?? t}</option>`).join(''))
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

  return lots.filter((l) => {
    if ((l.location?.distance_km ?? Infinity) > dist) return false
    if (status === 'live') { if (l.status === 'duplicate' || l.status === 'rejected') return false }
    else if (status && l.status !== status) return false

    if (type && l.type !== type) return false
    if (guests && (l.capacity?.guests ?? 0) < guests) return false

    const price = l.price?.amount ?? 0
    if (price < pmin || price > pmax) return false

    for (const a of picked) if (!l.amenities?.includes(a)) return false

    if (q) {
      const hay = [l.name, l.description, l.notes, l.location?.settlement, l.location?.area, ...(l.tags ?? [])]
        .join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

const SORTS = {
  'price-asc': (a, b) => (a.price?.amount ?? 1e9) - (b.price?.amount ?? 1e9),
  'price-desc': (a, b) => (b.price?.amount ?? 0) - (a.price?.amount ?? 0),
  'guests-desc': (a, b) => (b.capacity?.guests ?? 0) - (a.capacity?.guests ?? 0),
  'dist-asc': (a, b) => (a.location?.distance_km ?? 1e9) - (b.location?.distance_km ?? 1e9),
  'rating-desc': (a, b) => (b.rating?.score ?? -1) - (a.rating?.score ?? -1),
  'ppg-asc': (a, b) => ppg(a) - ppg(b),
  name: (a, b) => a.name.localeCompare(b.name, 'uk'),
}
const ppg = (l) => (l.price?.amount ?? 1e9) / (l.capacity?.guests || 1)

// 600+ cards at once is a lot of DOM and a lot of image requests; page them in
const PAGE = 60
let shown = PAGE

function render(reset = true) {
  if (reset) shown = PAGE
  const list = visible().sort(SORTS[$('#sort').value])

  // denominator follows the status filter, else "усі" can show 597 із 596
  const total = $('#status').value === ''
    ? lots.length
    : lots.filter((l) => l.status !== 'duplicate' && l.status !== 'rejected').length
  const prices = list.map((l) => l.price?.amount).filter(Boolean)
  const median = prices.length ? prices.sort((a, b) => a - b)[prices.length >> 1] : null
  $('#count').textContent =
    `${list.length} із ${total}` + (median ? ` · медіана ${money(median)} ₴/ніч` : '')

  shown = Math.min(shown, Math.max(PAGE, list.length))   // never page past the end
  const page = list.slice(0, shown)
  $('#empty').hidden = list.length > 0
  $('#more').hidden = list.length <= shown
  $('#more').textContent = `показати ще ${Math.max(0, Math.min(PAGE, list.length - shown))}`
  grid.innerHTML = page.map(card).join('')
  grid.querySelectorAll('.card').forEach((el) => el.addEventListener('click', () => open(el.dataset.id)))
}

// a lot whose price or capacity looks wrong must LOOK wrong — otherwise a stale
// "800 ₴ for 14 guests" quietly wins the price sort and reads as the best deal
const CHECK = { 'перевірити-ціну': 'ціна?', 'перевірити-місткість': 'місткість?', 'перевірити-локацію': 'локація?' }
const checks = (l) => (l.tags ?? []).filter((t) => CHECK[t]).map((t) => CHECK[t])

function card(l) {
  const cover = l.images?.[0]
  const dist = l.location?.distance_km
  const warn = checks(l)
  return `
  <article class="card" data-id="${l.id}">
    <div class="cover">
      ${cover ? `<img loading="lazy" src="${thumbUrl(l.id, cover.file)}" alt="">` : '<div class="no-photo">без фото</div>'}
      ${l.status === 'candidate' ? '<span class="flag">не перевірено</span>' : ''}
      <span class="price${warn.includes('ціна?') ? ' suspect' : ''}">${money(l.price?.amount)} ₴<small>/ніч</small></span>
      ${l.images?.length > 1 ? `<span class="shots">${l.images.length} фото</span>` : ''}
    </div>
    <div class="body">
      <h2>${esc(l.name)}</h2>
      <div class="where">${esc(l.location?.settlement ?? '')}${dist != null ? ` · ${dist} км` : ''}</div>
      <div class="facts">
        <span>${TYPE_LABEL[l.type] ?? l.type}</span>
        <span>до ${l.capacity?.guests ?? '?'} гостей</span>
        ${l.capacity?.bedrooms ? `<span>${l.capacity.bedrooms} спальні</span>` : ''}
        ${l.rating ? `<span>★ ${l.rating.score}</span>` : ''}
      </div>
      <div class="tags">
        ${warn.map((w) => `<span class="tag warn" title="дані в оголошенні виглядають неповними">⚠ ${w}</span>`).join('')}
        ${(l.amenities ?? []).slice(0, 5).map((a) => `<span class="tag">${AMENITY_LABEL[a] ?? a}</span>`).join('')}
      </div>
    </div>
  </article>`
}

// ---------- detail ----------

function open(id) {
  const l = lots.find((x) => x.id === id)
  const c = l.contacts ?? {}
  const link = (href, text) => href ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : ''

  const rows = [
    ['ціна', `${money(l.price?.amount)} ₴/ніч` +
      (l.price?.weekend_amount ? ` · вихідні ${money(l.price.weekend_amount)} ₴` : '') +
      (l.price?.min_nights > 1 ? ` · мін. ${l.price.min_nights} ночі` : '') +
      (l.price?.deposit ? ` · застава ${money(l.price.deposit)} ₴` : '')],
    ['місткість', `${l.capacity?.guests} гостей` +
      (l.capacity?.bedrooms ? `, ${l.capacity.bedrooms} спальні` : '') +
      (l.capacity?.beds ? `, ${l.capacity.beds} ліжок` : '') +
      (l.capacity?.bathrooms ? `, ${l.capacity.bathrooms} санвузли` : '')],
    ['де', [l.location?.settlement, l.location?.area, l.location?.distance_km != null ? `${l.location.distance_km} км від Львова` : '']
      .filter(Boolean).join(' · ') + ' ' + link(l.location?.maps_url, '→ карта')],
    ['зручності', (l.amenities ?? []).map((a) => AMENITY_LABEL[a] ?? a).join(', ') || '—'],
    ['додатково', l.price?.extras],
    ['рейтинг', l.rating ? `★ ${l.rating.score} (${l.rating.count} відгуків, ${l.rating.platform})` : ''],
    ['контакти', [
      c.phone ? `<a href="tel:${c.phone}">${c.phone}</a>` : '',
      link(c.instagram, 'instagram'), link(c.facebook, 'facebook'),
      link(c.website, 'сайт'), c.telegram ? `telegram ${c.telegram}` : '',
    ].filter(Boolean).join(' · ')],
    ['джерело', link(l.source?.url, l.source?.platform ?? 'посилання') +
      (l.source?.scraped_at ? ` <small>(${l.source.scraped_at})</small>` : '')],
    ['перевірено', l.verified_at ?? '—'],
  ].filter(([, v]) => v)

  $('#modal').innerHTML = `
    <button class="close" onclick="document.getElementById('modal').close()">×</button>
    <div class="m-gallery">
      ${(l.images ?? []).map((i) => `<img loading="lazy" src="${imgUrl(l.id, i.file)}" alt="${esc(i.caption ?? '')}" title="${esc(i.caption ?? '')}" onclick="window.open(this.src)">`).join('')}
    </div>
    <div class="m-body">
      <h2>${esc(l.name)}</h2>
      <div class="where">${TYPE_LABEL[l.type] ?? l.type} · ${esc(l.location?.settlement ?? '')}</div>
      ${l.description ? `<p>${esc(l.description)}</p>` : ''}
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      ${l.notes ? `<div class="note">${esc(l.notes)}</div>` : ''}
    </div>`
  $('#modal').showModal()
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// ---------- wiring ----------

document.querySelectorAll('#q, #pmin, #pmax, #guests, #dist, #type, #status, #sort')
  .forEach((el) => el.addEventListener('input', () => render()))

$('#more').addEventListener('click', () => { shown += PAGE; render(false) })

$('#amenities').addEventListener('click', (e) => {
  const b = e.target.closest('.chip')
  if (!b) return
  const a = b.dataset.a
  picked.has(a) ? picked.delete(a) : picked.add(a)
  b.setAttribute('aria-pressed', picked.has(a))
  render()
})

$('#reset').addEventListener('click', () => {
  document.querySelectorAll('#q, #pmin, #pmax, #guests').forEach((el) => (el.value = ''))
  $('#dist').value = '100'
  $('#type').value = ''
  $('#status').value = 'live'
  picked.clear()
  document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'))
  render()
})
