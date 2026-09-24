// Convierte una dirección en texto o un link de Google Maps a coordenadas, sin API key: un link
// se lee directo (o se sigue su redirección si es un link corto tipo maps.app.goo.gl) y el texto
// se busca con Nominatim (OpenStreetMap, gratis). Se llama solo cuando el negocio configura su
// ubicación a mano desde el panel (Tarjeta → dirección), no en cada visita a la tarjeta.

const COORD_PATTERNS = [
  /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,        // .../place/Nombre/@4.648,-74.064,17z
  /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,    // pin de un lugar puntual dentro del link
  /[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,   // ?q=4.648,-74.064
];

function extractCoordsFromUrl(url) {
  for (const re of COORD_PATTERNS) {
    const m = url.match(re);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return null;
}

export async function geocodeQuery(query) {
  if (/^https?:\/\//i.test(query)) {
    const direct = extractCoordsFromUrl(query);
    if (direct) return direct;
    // Link corto (maps.app.goo.gl, goo.gl/maps): hay que seguir la redirección para ver la URL
    // real, que sí trae las coordenadas.
    try {
      const res = await fetch(query, { redirect: "follow" });
      const followed = extractCoordsFromUrl(res.url);
      if (followed) return followed;
    } catch { /* si falla, se intenta igual buscar el texto del link como dirección abajo */ }
  }

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
    { headers: { "User-Agent": "ControlDeCitas/1.0 (soporte de negocio, geocodificación puntual)" } });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  if (!rows.length) return null;
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon) };
}
