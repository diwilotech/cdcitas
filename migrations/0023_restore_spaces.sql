-- Revierte 0023_simplify_spaces.sql (borrada): el pedido real era solo mover "Tipos de espacio"
-- al apartado Espacio y agregarle descripción — no quitar el plano de mesas individuales. Se
-- restaura spaces y appointments.space_id tal como estaban; space_types.description SÍ se
-- conserva (esa parte sigue siendo lo que se pidió).
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  shape TEXT NOT NULL DEFAULT 'square', -- square | rect-h | rect-v
  capacity INTEGER NOT NULL DEFAULT 2,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  w INTEGER NOT NULL DEFAULT 3,
  h INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'libre'
);

ALTER TABLE appointments ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL;

-- Datos reales que existían antes de 0023_simplify_spaces.sql (capturados antes de borrarlos).
INSERT INTO spaces (id, business_id, label, type, shape, capacity, x, y, w, h, status) VALUES
  ('29253e04-cc3d-4ac5-9f7b-317978317fe1','55442806-e6da-4ca8-a62b-cc49ce33a3ff','General','general','square',4,0,0,8,4,'libre'),
  ('897d161e-d087-4a09-a437-5c42e0b53da5','55442806-e6da-4ca8-a62b-cc49ce33a3ff','General','general','rect-h',6,0,9,8,4,'libre'),
  ('ab9f46ff-bfee-4bfd-a70b-18885b41f5f6','55442806-e6da-4ca8-a62b-cc49ce33a3ff','General','general','square',2,0,5,8,3,'libre'),
  ('0562b357-95ee-40f0-94b9-b452ffccf0ca','55442806-e6da-4ca8-a62b-cc49ce33a3ff','Privado','privado','square',2,12,0,8,4,'libre'),
  ('72596f04-c43b-4bca-88af-41f4f64666b0','55442806-e6da-4ca8-a62b-cc49ce33a3ff','Privado','privado','square',2,12,5,8,3,'libre'),
  ('a194daa1-0266-4a4d-a044-f5ff0a84dd40','55442806-e6da-4ca8-a62b-cc49ce33a3ff','Privado','privado','square',2,12,9,8,4,'libre');

UPDATE appointments SET space_id='29253e04-cc3d-4ac5-9f7b-317978317fe1' WHERE id='cff4583a-cf0e-41fd-b948-c0854f45a8ca';
UPDATE appointments SET space_id='29253e04-cc3d-4ac5-9f7b-317978317fe1' WHERE id='7c562421-c0bc-489e-ab46-21c016bd25c5';
UPDATE appointments SET space_id='ab9f46ff-bfee-4bfd-a70b-18885b41f5f6' WHERE id='c0265b44-897b-4f50-89d8-1abf5414d42a';
UPDATE appointments SET space_id='29253e04-cc3d-4ac5-9f7b-317978317fe1' WHERE id='c66d0e7f-2f2e-4001-8f88-adc872d9c885';

ALTER TABLE appointments DROP COLUMN space_type;
