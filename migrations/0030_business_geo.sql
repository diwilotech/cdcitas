-- Coordenadas del negocio (lat/lng), para el mapa embebido y la distancia al cliente en la
-- tarjeta digital. Se llenan desde Tarjeta → dirección (botón "Usar mi ubicación actual" en el
-- navegador del negocio, no del cliente) — no hay geocodificación automática desde el texto de la
-- dirección, así se evita depender de una API de mapas con costo/llave.
ALTER TABLE businesses ADD COLUMN card_lat REAL;
ALTER TABLE businesses ADD COLUMN card_lng REAL;
