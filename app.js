// ---- Fix for iOS Safari's 100vh not matching actual visible viewport ----
function setRealVh() {
  document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
}
setRealVh();
window.addEventListener('resize', setRealVh);
window.addEventListener('orientationchange', setRealVh);

// ---- Setup ----
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CITY_CENTERS = {
  Pune: [18.5204, 73.8567],
  Mumbai: [19.0760, 72.8777],
  'Navi Mumbai': [19.0330, 73.0297],
  Thane: [19.2183, 72.9781],
  Nashik: [19.9975, 73.7898],
  Nagpur: [21.1458, 79.0882],
  Gurugram: [28.4595, 77.0266],
  Faridabad: [28.4089, 77.3178],
};

let map = L.map('map', { zoomControl: false }).setView(CITY_CENTERS.Pune, 12);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  maxZoom: 19,
}).addTo(map);

let markersLayer = L.markerClusterGroup({
  maxClusterRadius: 55,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  iconCreateFunction: function (cluster) {
    const count = cluster.getChildCount();
    const size = count < 10 ? 34 : count < 25 ? 40 : 46;
    return L.divIcon({
      html: `<div class="cluster-dot" style="width:${size}px;height:${size}px;line-height:${size}px">${count}</div>`,
      className: 'cluster-wrap',
      iconSize: L.point(size, size),
    });
  },
}).addTo(map);
let userLocationLayer = L.layerGroup().addTo(map);
let routeLayer = L.layerGroup().addTo(map);

const legend = L.control({ position: 'bottomleft' });
legend.onAdd = function () {
  const div = L.DomUtil.create('div', 'map-legend');
  div.innerHTML = `
    <div class="legend-row"><span class="legend-dot" style="background:#3ecf7a"></span> Official source</div>
    <div class="legend-row"><span class="legend-dot" style="background:#e3b96e"></span> Review-confirmed</div>
  `;
  return div;
};
legend.addTo(map);
let allOutlets = [];
let userLocation = null;

const statusEl = document.getElementById('status');
const citySelect = document.getElementById('citySelect');
const locateBtn = document.getElementById('locateBtn');
const outletListEl = document.getElementById('outletList');
const listPanel = document.getElementById('listPanel');
const panelHandle = document.getElementById('panelHandle');
const filterSegmented = document.getElementById('filterSegmented');
const showNormalToggle = document.getElementById('showNormalToggle');
let filterMode = 'all'; // 'all' | 'coco' | 'premium'
let showNormal = false;

showNormalToggle.addEventListener('change', () => {
  showNormal = showNormalToggle.checked;
  refresh();
});

filterSegmented.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  filterSegmented.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterMode = btn.dataset.mode;
  refresh();
});

panelHandle.addEventListener('click', () => {
  const collapsing = !listPanel.classList.contains('collapsed');
  listPanel.classList.toggle('collapsed');
  if (collapsing) outletListEl.scrollTop = 0;
  updatePeekLabel(document.querySelectorAll('.outlet-card').length);
});

function setStatus(msg) { statusEl.textContent = msg; }

// ---- Data fetching ----
const RADIUS_CITIES = {
  Pune: { center: [18.5204, 73.8567], km: 100 },
};

async function fetchAllOutlets() {
  const { data, error } = await supabaseClient.from('outlets').select('*');
  if (error) {
    setStatus('Could not load data — check Supabase config in config.js');
    console.error(error);
    return [];
  }
  return data;
}

async function fetchOutlets(city) {
  setStatus('Loading outlets…');

  if (city && RADIUS_CITIES[city]) {
    const { center, km } = RADIUS_CITIES[city];
    const all = await fetchAllOutlets();
    const within = all.filter(o => distanceKm(center[0], center[1], o.lat, o.lng) <= km);
    setStatus(`${within.length} outlet(s) within ${km}km of ${city}`);
    return within;
  }

  let query = supabaseClient.from('outlets').select('*');
  if (city) query = query.eq('city', city);
  const { data, error } = await query;
  if (error) {
    setStatus('Could not load data — check Supabase config in config.js');
    console.error(error);
    return [];
  }
  setStatus(`${data.length} outlet(s) found`);
  return data;
}

// ---- Distance (haversine, km) ----
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ---- Helpers ----
function googleMapsLink(o) {
  return `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function distanceLabel(o) {
  if (!userLocation) return '';
  const d = distanceKm(userLocation[0], userLocation[1], o.lat, o.lng);
  return d < 1 ? `${Math.round(d * 1000)} m away` : `${d.toFixed(1)} km away`;
}

// ---- Rendering ----
function outletIcon(o) {
  if (!isVerified(o)) {
    return L.divIcon({
      className: 'outlet-dot-wrap',
      html: `<div class="outlet-dot outlet-dot-normal"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
  }
  const confidence = o.coco_confidence || o.premium_confidence;
  const color = confidence === 'official' ? '#3ecf7a' : '#e3b96e';
  return L.divIcon({
    className: 'outlet-dot-wrap',
    html: `<div class="outlet-dot" style="background:${color}"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function applyFilters(outlets) {
  if (filterMode === 'coco') return outlets.filter(o => o.is_coco);
  if (filterMode === 'premium') return outlets.filter(o => o.has_premium_fuel);
  // 'all' mode: verified outlets always show; normal (unverified) pumps only if toggle is on
  return outlets.filter(o => o.is_coco || o.has_premium_fuel || showNormal);
}

function isVerified(o) {
  return o.is_coco || o.has_premium_fuel;
}

function badgeHtml(outlet) {
  let html = '';
  if (outlet.is_coco) {
    html += `<span class="badge badge-coco">COCO</span>`;
  }
  if (outlet.has_premium_fuel) {
    html += `<span class="badge badge-premium">${outlet.premium_fuel_grade || 'Premium fuel'}</span>`;
  }
  return html;
}

function confidenceBadge(confidence) {
  if (confidence === 'official') return `<span class="badge badge-official">Official source</span>`;
  if (confidence === 'review') return `<span class="badge badge-review">Review-confirmed</span>`;
  return '';
}

function renderMarkers(outlets) {
  markersLayer.clearLayers();
  outlets.forEach(o => {
    const marker = L.marker([o.lat, o.lng], { icon: outletIcon(o) });
    marker.outletId = o.id;
    const dist = distanceLabel(o);
    const badges = isVerified(o) ? badgeHtml(o) : `<span class="badge badge-normal">Not verified</span>`;
    const popupHtml = `
      <strong>${o.name}</strong><br/>
      <span style="font-size:12px;color:#7a7f8a">${o.brand || ''} · ${o.area || ''}</span><br/>
      ${dist ? `<span style="font-size:12px;color:#16a34a;font-weight:600">${dist}</span><br/>` : ''}
      <div style="margin:6px 0">${badges}</div>
      <a href="${googleMapsLink(o)}" target="_blank" rel="noopener" style="font-size:12px;color:#2563eb;font-weight:600">Open in Google Maps →</a>
    `;
    marker.bindPopup(popupHtml);
    marker.on('popupopen', () => highlightCard(o.id));
    marker.addTo(markersLayer);
  });
}

function highlightCard(id) {
  document.querySelectorAll('.outlet-card').forEach(c => c.classList.remove('card-highlighted'));
  const card = outletListEl.querySelector(`.outlet-card[data-id="${id}"]`);
  if (!card) return;
  card.classList.add('card-highlighted');
  if (window.innerWidth < 900) {
    listPanel.classList.remove('collapsed');
    updatePeekLabel(document.querySelectorAll('.outlet-card').length);
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => card.classList.remove('card-highlighted'), 2200);
}

function focusOutletOnMap(o) {
  const targetZoom = Math.max(map.getZoom(), 16);
  let opened = false;
  const openIt = () => {
    if (opened) return;
    opened = true;
    let targetMarker = null;
    markersLayer.eachLayer(m => { if (m.outletId === o.id) targetMarker = m; });
    if (targetMarker) targetMarker.openPopup();
  };
  map.setView([o.lat, o.lng], targetZoom, { animate: true });
  map.once('moveend', openIt);
  setTimeout(openIt, 700); // fallback in case the view doesn't actually change (moveend won't fire)
}

function renderList(outlets) {
  if (outlets.length === 0) {
    outletListEl.innerHTML = `<p style="color:#7a7f8a;font-size:13px;padding:10px 0">No outlets match your filters yet in this area. Try a nearby city or a different filter.</p>`;
    return;
  }
  outletListEl.innerHTML = outlets.map(o => {
    const dist = distanceLabel(o);
    if (!isVerified(o)) {
      return `
        <div class="outlet-card outlet-card-normal" data-id="${o.id}" data-lat="${o.lat}" data-lng="${o.lng}" data-name="${escapeHtml(o.name)}">
          <h3>${o.name}</h3>
          <div class="addr">${o.address}</div>
          ${dist ? `<div class="distance">📍 ${dist}</div>` : ''}
          <div class="badges"><span class="badge badge-normal">Not verified</span></div>
          <a class="maps-link" href="${googleMapsLink(o)}" target="_blank" rel="noopener">Open in Google Maps →</a>
        </div>
      `;
    }
    const cocoNote = o.is_coco ? `<div class="note">COCO: ${o.coco_source || ''}</div>` : '';
    const premiumNote = o.has_premium_fuel
      ? `<div class="note">Premium: ${o.premium_source || ''}${o.premium_stock_caveat ? ' — ⚠ ' + o.premium_stock_caveat : ''}</div>`
      : '';
    return `
      <div class="outlet-card" data-id="${o.id}" data-lat="${o.lat}" data-lng="${o.lng}" data-name="${escapeHtml(o.name)}">
        <h3>${o.name}</h3>
        <div class="addr">${o.address}</div>
        ${dist ? `<div class="distance">📍 ${dist}</div>` : ''}
        <div class="badges">
          ${badgeHtml(o)}
          ${confidenceBadge(o.coco_confidence || o.premium_confidence)}
        </div>
        ${cocoNote}
        ${premiumNote}
        <a class="maps-link" href="${googleMapsLink(o)}" target="_blank" rel="noopener">Open in Google Maps →</a>
      </div>
    `;
  }).join('');
}

function refresh() {
  let filtered = applyFilters(allOutlets);
  if (userLocation) {
    filtered = filtered.slice().sort((a, b) =>
      distanceKm(userLocation[0], userLocation[1], a.lat, a.lng) -
      distanceKm(userLocation[0], userLocation[1], b.lat, b.lng)
    );
  }
  routeLayer.clearLayers();
  renderMarkers(filtered);
  renderList(filtered);
  updatePeekLabel(filtered.length);
}

function updatePeekLabel(count) {
  let label = document.getElementById('peekLabel');
  if (!label) {
    label = document.createElement('div');
    label.id = 'peekLabel';
    label.className = 'panel-peek-label';
    panelHandle.after(label);
  }
  label.textContent = count === 0 ? 'No outlets — tap to adjust filters' : `${count} outlet(s) — tap to ${listPanel.classList.contains('collapsed') ? 'expand' : 'collapse'}`;
}

// ---- Route line (click a card to see the road route + distance from your location) ----
async function drawRouteTo(lat, lng, name) {
  if (!userLocation) {
    setStatus('Tap "Use my location" first to see a route');
    return;
  }
  routeLayer.clearLayers();
  setStatus(`Finding route to ${name}…`);

  let routeLatLngs = null;
  let distText = null;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${userLocation[1]},${userLocation[0]};${lng},${lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.code === 'Ok' && json.routes && json.routes[0]) {
      const coords = json.routes[0].geometry.coordinates; // [lng, lat] pairs
      routeLatLngs = coords.map(c => [c[1], c[0]]);
      const meters = json.routes[0].distance;
      distText = meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
    }
  } catch (err) {
    console.error('Routing failed, falling back to straight line', err);
  }

  let line;
  if (routeLatLngs) {
    line = L.polyline(routeLatLngs, {
      color: '#2563eb',
      weight: 4,
      opacity: 0.85,
    }).addTo(routeLayer);
  } else {
    // Fallback: straight dashed line if routing service is unreachable
    line = L.polyline([userLocation, [lat, lng]], {
      color: '#2563eb',
      weight: 3,
      opacity: 0.8,
      dashArray: '8 6',
    }).addTo(routeLayer);
    const d = distanceKm(userLocation[0], userLocation[1], lat, lng);
    distText = d < 1 ? `${Math.round(d * 1000)} m (straight-line)` : `${d.toFixed(1)} km (straight-line)`;
  }

  const bounds = line.getBounds();
  const mid = bounds.getCenter();
  L.marker(mid, {
    icon: L.divIcon({
      className: 'route-label-wrap',
      html: `<div class="route-label">${distText}</div>`,
      iconSize: [0, 0],
    }),
  }).addTo(routeLayer);

  map.fitBounds(bounds, { padding: [60, 60] });
  setStatus(`${distText} to ${name} — tap "Open in Google Maps" on the card for turn-by-turn directions`);

  // Collapse the sheet on mobile so the drawn route is visible
  if (window.innerWidth < 900 && !listPanel.classList.contains('collapsed')) {
    outletListEl.scrollTop = 0;
    listPanel.classList.add('collapsed');
    updatePeekLabel(document.querySelectorAll('.outlet-card').length);
  }
}

outletListEl.addEventListener('click', (e) => {
  if (appMode === 'trip') return;
  const card = e.target.closest('.outlet-card');
  if (!card || e.target.closest('.maps-link')) return;
  const id = card.dataset.id;
  const lat = parseFloat(card.dataset.lat);
  const lng = parseFloat(card.dataset.lng);
  const name = card.dataset.name;

  document.querySelectorAll('.outlet-card').forEach(c => c.classList.remove('card-highlighted'));
  card.classList.add('card-highlighted');
  setTimeout(() => card.classList.remove('card-highlighted'), 2200);

  focusOutletOnMap({ id, lat, lng });

  if (userLocation) {
    drawRouteTo(lat, lng, name);
  }
});

// ---- Events ----
citySelect.addEventListener('change', async () => {
  const city = citySelect.value;
  allOutlets = await fetchOutlets(city);
  if (city && CITY_CENTERS[city]) {
    map.setView(CITY_CENTERS[city], 12);
  }
  refresh();
});

function showYouAreHereMarker(loc) {
  userLocationLayer.clearLayers();
  L.marker(loc, {
    icon: L.divIcon({
      className: 'you-marker-wrap',
      html: '<div class="you-dot"><div class="you-dot-pulse"></div></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    }),
    zIndexOffset: 1000,
  }).addTo(userLocationLayer).bindPopup('You are here');
}

function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported by your browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
      (err) => reject(err)
    );
  });
}

locateBtn.addEventListener('click', async () => {
  setStatus('Getting your location…');
  try {
    userLocation = await getUserLocation();
    map.setView(userLocation, 13);
    showYouAreHereMarker(userLocation);
    // Load all outlets across all cities so nearest results aren't limited to one city
    allOutlets = await fetchOutlets(null);
    citySelect.value = '';
    refresh();
  } catch (err) {
    setStatus('Could not get location — pick a city instead');
    console.error(err);
  }
});

// ---- Init ----
(async function init() {
  allOutlets = await fetchOutlets('Pune');
  refresh();
  setTimeout(() => map.invalidateSize(), 100);
})();

window.addEventListener('resize', () => map.invalidateSize());

// ---- Trip planner ----
const modeTabs = document.getElementById('modeTabs');
const nearbyControls = document.getElementById('nearbyControls');
const tripControls = document.getElementById('tripControls');
const tripStartInput = document.getElementById('tripStart');
const tripEndInput = document.getElementById('tripEnd');
const tripFindBtn = document.getElementById('tripFindBtn');
const tripShareBtn = document.getElementById('tripShareBtn');

let appMode = 'nearby'; // 'nearby' | 'trip'
let tripStartCoord = null;
let tripEndCoord = null;
let tripRouteLatLngs = null;
let tripPumps = []; // outlets found along the current route
let selectedStopIds = new Set();

modeTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-tab');
  if (!btn) return;
  modeTabs.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  appMode = btn.dataset.mode;
  nearbyControls.style.display = appMode === 'nearby' ? 'flex' : 'none';
  tripControls.style.display = appMode === 'trip' ? 'flex' : 'none';
  routeLayer.clearLayers();
  tripShareBtn.style.display = 'none';
  selectedStopIds.clear();

  if (appMode === 'trip') {
    tripPumps = [];
    renderList([]);
    outletListEl.innerHTML = `<p style="color:#7a7f8a;font-size:13px;padding:10px 0">Enter a destination and tap "Find pumps on route" to see verified pumps along the way.</p>`;
  } else {
    refresh();
  }
});

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const results = await res.json();
  if (!results || results.length === 0) return null;
  return [parseFloat(results[0].lat), parseFloat(results[0].lon)];
}

async function fetchRoute(start, end) {
  const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes || !json.routes[0]) return null;
  const coords = json.routes[0].geometry.coordinates;
  return {
    latlngs: coords.map(c => [c[1], c[0]]),
    distanceKm: json.routes[0].distance / 1000,
    durationMin: json.routes[0].duration / 60,
  };
}

function minDistanceToRoute(lat, lng, routeLatLngs) {
  const step = routeLatLngs.length > 400 ? Math.ceil(routeLatLngs.length / 400) : 1;
  let min = Infinity;
  for (let i = 0; i < routeLatLngs.length; i += step) {
    const [rlat, rlng] = routeLatLngs[i];
    const d = distanceKm(lat, lng, rlat, rlng);
    if (d < min) min = d;
  }
  return min;
}

tripFindBtn.addEventListener('click', async () => {
  const destQuery = tripEndInput.value.trim();
  if (!destQuery) {
    setStatus('Enter a destination first');
    return;
  }

  tripFindBtn.disabled = true;
  setStatus('Finding your route…');
  routeLayer.clearLayers();
  tripShareBtn.style.display = 'none';
  selectedStopIds.clear();

  try {
    // Resolve start
    const startQuery = tripStartInput.value.trim();
    if (startQuery) {
      tripStartCoord = await geocode(startQuery);
      if (!tripStartCoord) {
        setStatus(`Could not find "${startQuery}" — try a more specific location`);
        tripFindBtn.disabled = false;
        return;
      }
    } else {
      if (!userLocation) {
        setStatus('Getting your location…');
        userLocation = await getUserLocation();
        showYouAreHereMarker(userLocation);
      }
      tripStartCoord = userLocation;
    }

    // Resolve destination
    tripEndCoord = await geocode(destQuery);
    if (!tripEndCoord) {
      setStatus(`Could not find "${destQuery}" — try a more specific location`);
      tripFindBtn.disabled = false;
      return;
    }

    setStatus('Calculating route…');
    const route = await fetchRoute(tripStartCoord, tripEndCoord);
    if (!route) {
      setStatus('Could not find a driving route between those points');
      tripFindBtn.disabled = false;
      return;
    }
    tripRouteLatLngs = route.latlngs;

    // Draw the trip route (distinct purple line vs. the single-pump blue line)
    routeLayer.clearLayers();
    const routeLine = L.polyline(route.latlngs, { color: '#7c3aed', weight: 5, opacity: 0.85 }).addTo(routeLayer);
    L.marker(tripStartCoord, {
      icon: L.divIcon({ className: 'trip-endpoint-wrap', html: '<div class="trip-endpoint trip-start">A</div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).addTo(routeLayer);
    L.marker(tripEndCoord, {
      icon: L.divIcon({ className: 'trip-endpoint-wrap', html: '<div class="trip-endpoint trip-end">B</div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).addTo(routeLayer);
    map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

    // Find verified (and, if toggled, normal) pumps within 2km of the route — always search
    // the full dataset, not whatever city-scoped subset happens to be loaded already
    setStatus('Checking pumps along the route…');
    const allForTrip = await fetchAllOutlets();
    const candidates = applyFilters(allForTrip);
    tripPumps = candidates
      .map(o => ({ ...o, _routeDist: minDistanceToRoute(o.lat, o.lng, route.latlngs) }))
      .filter(o => o._routeDist <= 2)
      .sort((a, b) => a._routeDist - b._routeDist);

    const hrs = Math.floor(route.durationMin / 60);
    const mins = Math.round(route.durationMin % 60);
    const durText = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    setStatus(`${route.distanceKm.toFixed(0)} km · ${durText} — ${tripPumps.length} pump(s) found along the way`);

    renderTripPumpList();

    if (window.innerWidth < 900) {
      outletListEl.scrollTop = 0;
      listPanel.classList.remove('collapsed');
      updatePeekLabel(tripPumps.length);
    }
  } catch (err) {
    console.error(err);
    setStatus('Something went wrong finding the route — try again');
  }
  tripFindBtn.disabled = false;
});

function renderTripPumpList() {
  markersLayer.clearLayers();
  if (tripPumps.length === 0) {
    outletListEl.innerHTML = `<p style="color:#7a7f8a;font-size:13px;padding:10px 0">No verified pumps found within 2km of this route. Try enabling "Show other nearby pumps" for more options.</p>`;
    return;
  }
  outletListEl.innerHTML = tripPumps.map(o => {
    const verified = isVerified(o);
    const badges = verified ? badgeHtml(o) : `<span class="badge badge-normal">Not verified</span>`;
    const routeDistText = o._routeDist < 1 ? `${Math.round(o._routeDist * 1000)}m off route` : `${o._routeDist.toFixed(1)}km off route`;
    const checked = selectedStopIds.has(o.id) ? 'checked' : '';
    return `
      <div class="outlet-card ${verified ? '' : 'outlet-card-normal'}">
        <div class="stop-checkbox-row">
          <input type="checkbox" class="stop-checkbox" data-id="${o.id}" ${checked} />
          <label>Add as stop</label>
        </div>
        <h3>${o.name}</h3>
        <div class="addr">${o.address}</div>
        <div class="distance">🛣️ ${routeDistText}</div>
        <div class="badges">${badges}</div>
        <a class="maps-link" href="${googleMapsLink(o)}" target="_blank" rel="noopener">Open in Google Maps →</a>
      </div>
    `;
  }).join('');

  // Add pump markers for the trip
  tripPumps.forEach(o => {
    const marker = L.marker([o.lat, o.lng], { icon: outletIcon(o) });
    marker.bindPopup(`<strong>${o.name}</strong><br/><span style="font-size:12px;color:#7a7f8a">${o.brand || ''}</span>`);
    marker.addTo(markersLayer);
  });

  updateTripShareButton();
}

outletListEl.addEventListener('change', (e) => {
  const cb = e.target.closest('.stop-checkbox');
  if (!cb) return;
  const id = cb.dataset.id;
  if (cb.checked) selectedStopIds.add(id);
  else selectedStopIds.delete(id);
  updateTripShareButton();
});

function updateTripShareButton() {
  if (appMode !== 'trip' || !tripEndCoord) {
    tripShareBtn.style.display = 'none';
    return;
  }
  tripShareBtn.style.display = 'inline-block';
  tripShareBtn.textContent = selectedStopIds.size > 0
    ? `📍 Share trip with ${selectedStopIds.size} stop(s) via Google Maps`
    : `📍 Share trip via Google Maps`;
}

tripShareBtn.addEventListener('click', () => {
  if (!tripStartCoord || !tripEndCoord) return;
  const stops = tripPumps.filter(o => selectedStopIds.has(o.id));
  let url = `https://www.google.com/maps/dir/?api=1&origin=${tripStartCoord[0]},${tripStartCoord[1]}&destination=${tripEndCoord[0]},${tripEndCoord[1]}`;
  if (stops.length > 0) {
    // Google Maps supports up to 9 waypoints for consumer directions links
    const waypoints = stops.slice(0, 9).map(o => `${o.lat},${o.lng}`).join('|');
    url += `&waypoints=${encodeURIComponent(waypoints)}`;
  }
  url += '&travelmode=driving';
  window.open(url, '_blank', 'noopener');
});
