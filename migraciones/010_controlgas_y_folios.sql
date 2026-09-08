-- ORDEN 7: importador del export real de ControlGAS y folio canónico.

-- Campos del export que servirán a la regla de flotillas y a soporte.
ALTER TABLE ventas ADD COLUMN tipo_pago VARCHAR(30) NULL COMMENT 'Tipo del export: Contado / Crédito';
ALTER TABLE ventas ADD COLUMN datos_pago VARCHAR(150) NULL COMMENT 'Columna Datos del export (forma de pago textual)';
ALTER TABLE ventas ADD COLUMN cliente_nombre VARCHAR(150) NULL;
ALTER TABLE ventas ADD COLUMN cliente_codigo VARCHAR(50) NULL;
ALTER TABLE ventas ADD COLUMN nota VARCHAR(120) NULL COMMENT 'Columna Nota: informativa, puede agrupar despachos';

-- Palabras que marcan una forma de pago como excluida (vales).
INSERT IGNORE INTO configuracion (clave, valor, descripcion) VALUES
  ('palabras_pago_excluido', 'vale', 'Si Tipo o Datos del export contienen alguna de estas palabras (lista separada por comas, sin distinguir mayúsculas), la venta queda con forma de pago excluida.');

-- Normalización de folios ya guardados a la forma canónica:
-- 1) folios numéricos con sufijo -N → se corta el sufijo;
-- 2) folios en formato de ticket (ceros a la izquierda + folio + un dígito)
--    → se quitan los ceros y el dígito final.
-- UPDATE IGNORE: si la normalización chocara con un folio ya existente en la
-- misma estación, la fila conflictiva se deja tal cual (revisión manual).
UPDATE IGNORE ventas SET folio = SUBSTRING_INDEX(folio, '-', 1)
  WHERE folio REGEXP '^[0-9]+-[0-9]+$';
UPDATE IGNORE ventas
  SET folio = SUBSTRING(TRIM(LEADING '0' FROM folio), 1, CHAR_LENGTH(TRIM(LEADING '0' FROM folio)) - 1)
  WHERE folio REGEXP '^0[0-9]+$' AND CHAR_LENGTH(TRIM(LEADING '0' FROM folio)) > 1;

-- Reversa (documentada):
--   DELETE FROM configuracion WHERE clave = 'palabras_pago_excluido';
--   ALTER TABLE ventas DROP COLUMN nota; ... DROP COLUMN cliente_codigo;
--   ... DROP COLUMN cliente_nombre; DROP COLUMN datos_pago; DROP COLUMN tipo_pago;
--   (la normalización de folios no es reversible: el original no se conserva)
