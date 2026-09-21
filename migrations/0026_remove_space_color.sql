-- El color en el plano ahora sale del TIPO de espacio (space_types.color, migración 0025), no de
-- cada mesa por separado — así todas las mesas de un mismo tipo se ven igual, y cambiar el color
-- de un tipo repinta de una todas sus mesas. spaces.color (migración 0024) queda sin uso.
ALTER TABLE spaces DROP COLUMN color;
