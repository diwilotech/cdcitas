-- Se quita el plano visual de mesas individuales (spaces) — la asignación de espacio a una cita
-- era puramente informativa (nunca afectó disponibilidad de horarios). Ahora las citas solo
-- guardan el TIPO de espacio asignado (space_types.key), no una mesa física puntual.
ALTER TABLE space_types ADD COLUMN description TEXT;
ALTER TABLE appointments ADD COLUMN space_type TEXT;

-- Preserva la asignación que ya tuvieran citas reales: pasa el tipo de la mesa que tenían asignada
-- (spaces.type) a la nueva columna, antes de perder la tabla de mesas individuales.
UPDATE appointments SET space_type = (SELECT type FROM spaces WHERE spaces.id = appointments.space_id)
WHERE space_id IS NOT NULL;

ALTER TABLE appointments DROP COLUMN space_id;
DROP TABLE spaces;
