-- Para cerrar el embudo de la tarjeta digital (vista -> click en Reservar -> cita agendada) hace
-- falta que la cita en sí recuerde de qué fuente venía, no solo el click en la tarjeta.
ALTER TABLE appointments ADD COLUMN source_code TEXT;
