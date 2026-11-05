// NearCare - nearest hospitals & pharmacies using OpenStreetMap data

const $ = (id) => document.getElementById(id);
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

let map = null;
let layer = null;

// ---------- Map ----------
function createMap() {
  map = L.map("map").setView([39, 35], 6); // Turkey overview until a search is made

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  layer = L.layerGroup().addTo(map);

  // Make sure Leaflet measures the container after the layout is ready
  setTimeout(() => map.invalidateSize(), 200);
  window.addEventListener("resize", () => map.invalidateSize());
}

// ---------- Helpers ----------
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const r = Math.PI / 180;
  const h =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").className = isError ? "error" : "";
}

async function queryOverpass(query) {
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url + "?data=" + encodeURIComponent(query));
      if (res.ok) return await res.json();
    } catch (e) {
      // try next server
    }
  }
  throw new Error("Veri sunucusuna ulaşılamadı.");
}

async function getPlaces(lat, lon) {
  const query =
    "[out:json][timeout:25];(" +
    `nwr["amenity"="hospital"](around:7000,${lat},${lon});` +
    `nwr["amenity"="pharmacy"](around:3000,${lat},${lon});` +
    ");out center tags;";
  const data = await queryOverpass(query);

  return data.elements
    .map((e) => {
      const la = e.lat ?? (e.center && e.center.lat);
      const lo = e.lon ?? (e.center && e.center.lon);
      if (la == null || lo == null) return null;
      const t = e.tags || {};
      return {
        type: t.amenity,
        lat: la,
        lon: lo,
        name: t.name || (t.amenity === "hospital" ? "İsimsiz hastane" : "İsimsiz eczane"),
        phone: t.phone || t["contact:phone"] || "",
        hours: t.opening_hours || "",
        d: distanceKm(lat, lon, la, lo)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.d - b.d);
}

// Official on-duty lists are not in OpenStreetMap, so we link to a search for the user's district
async function setDutyLink(lat, lon) {
  let place = "";
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=12&accept-language=tr&lat=${lat}&lon=${lon}`
    );
    const a = (await r.json()).address || {};
    const district = a.town || a.county || a.city_district || a.suburb || "";
    const city = a.province || a.state || a.city || "";
    place = [district, city].filter(Boolean).join(" ");
  } catch (e) {
    // fall back to a generic search
  }
  $("dutyLink").href =
    "https://www.google.com/search?q=" + encodeURIComponent("nöbetçi eczane " + place);
  $("duty").style.display = "block";
}

function makeCard(p, icon) {
  const li = document.createElement("li");

  const n = document.createElement("div");
  n.className = "name";
  n.textContent = icon + " " + p.name;

  const d = document.createElement("div");
  d.className = "dist";
  d.textContent = p.d.toFixed(2) + " km";
  li.append(n, d);

  if (p.hours) {
    const h = document.createElement("div");
    h.className = "hours";
    h.textContent = p.hours === "24/7" ? "7/24 açık" : "Çalışma saati: " + p.hours;
    li.append(h);
  }

  const dir = document.createElement("a");
  dir.href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
  dir.target = "_blank";
  dir.rel = "noopener";
  dir.textContent = "Yol tarifi";
  li.append(dir);

  if (p.phone) {
    const c = document.createElement("a");
    c.href = "tel:" + p.phone.replace(/[^+\d]/g, "");
    c.textContent = "Ara: " + p.phone;
    li.append(c);
  }

  li.addEventListener("click", () => map.setView([p.lat, p.lon], 17));
  return li;
}

function render(places, lat, lon) {
  layer.clearLayers();
  L.circleMarker([lat, lon], { radius: 9, color: "#1f6feb", fillOpacity: 0.9 })
    .addTo(layer)
    .bindPopup("Buradasınız");

  const hospitals = places.filter((p) => p.type === "hospital").slice(0, 10);
  const pharmacies = places.filter((p) => p.type === "pharmacy").slice(0, 15);
  const box = $("results");
  box.innerHTML = "";
  const pts = [[lat, lon]];

  [
    ["🏥 Hastaneler", hospitals, "🏥", "#d64545"],
    ["💊 Eczaneler", pharmacies, "💊", "#1a9e5c"]
  ].forEach(([title, arr, icon, color]) => {
    const h = document.createElement("h3");
    h.textContent = title + " (" + arr.length + ")";
    box.append(h);

    const ul = document.createElement("ul");
    if (!arr.length) {
      const li = document.createElement("li");
      li.textContent = "Bu yarıçapta sonuç yok.";
      ul.append(li);
    }
    arr.forEach((p) => {
      ul.append(makeCard(p, icon));
      L.circleMarker([p.lat, p.lon], { radius: 7, color, fillOpacity: 0.85 })
        .addTo(layer)
        .bindPopup(`<b></b><br>${p.d.toFixed(2)} km`)
        .on("popupopen", (e) => {
          e.popup.getElement().querySelector("b").textContent = p.name;
        });
      pts.push([p.lat, p.lon]);
    });
    box.append(ul);
  });

  map.invalidateSize();
  map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  setStatus(hospitals.length + " hastane ve " + pharmacies.length + " eczane bulundu.");
}

async function run(lat, lon) {
  setStatus("Çevre taranıyor...");
  try {
    const places = await getPlaces(lat, lon);
    render(places, lat, lon);
    setDutyLink(lat, lon);
  } catch (e) {
    setStatus("Hata: " + e.message + " Tekrar deneyin.", true);
  }
  $("btn").disabled = false;
}

function startSearch() {
  if (!navigator.geolocation) {
    setStatus("Tarayıcınız konumu desteklemiyor.", true);
    return;
  }
  $("btn").disabled = true;
  setStatus("Konum alınıyor...");
  navigator.geolocation.getCurrentPosition(
    (pos) => run(pos.coords.latitude, pos.coords.longitude),
    () => {
      setStatus("Konum izni verilmedi. Tarayıcı ayarlarından izin verip tekrar deneyin.", true);
      $("btn").disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ---------- Page setup ----------
document.addEventListener("DOMContentLoaded", () => {
  if ($("map")) {
    createMap();
    $("btn").addEventListener("click", startSearch);
  }
  if ($("contact-form")) {
    $("contact-form").addEventListener("submit", (e) => {
      e.preventDefault();
      $("contact-msg").textContent = "Teşekkürler! Mesajınız alındı (demo).";
      e.target.reset();
    });
  }
});
