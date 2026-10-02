-- Anticipo opcional al reservar: el cliente decide si lo paga (transferencia manual, sin pasarela
-- de pagos) y el negocio marca a mano cuando le llega, igual que ya hace con appointments.paid.
ALTER TABLE businesses ADD COLUMN deposit_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE businesses ADD COLUMN deposit_type TEXT NOT NULL DEFAULT 'fixed'; -- 'fixed' | 'percent'
ALTER TABLE businesses ADD COLUMN deposit_value REAL NOT NULL DEFAULT 0;
ALTER TABLE businesses ADD COLUMN deposit_instructions TEXT;

ALTER TABLE appointments ADD COLUMN deposit_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN deposit_amount REAL; -- monto calculado al reservar (congelado, no cambia si el negocio edita luego su config)
ALTER TABLE appointments ADD COLUMN deposit_paid INTEGER NOT NULL DEFAULT 0;
