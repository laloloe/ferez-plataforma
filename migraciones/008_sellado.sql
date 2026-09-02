-- ORDEN 5: sellado del padrón (SPEC 9-bis.2).
-- Los artefactos (CSV canónico y acta PDF) se guardan en la base de datos
-- para que sobrevivan los redespliegues y se sirvan tal cual se generaron.
-- es_real: 1 solo para el sellado real; su índice único garantiza a nivel de
-- base de datos que el sellado real se ejecute UNA sola vez (los simulacros
-- llevan NULL, que no colisiona).

CREATE TABLE IF NOT EXISTS sellos (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tipo ENUM('simulacro','real') NOT NULL,
  es_real TINYINT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_local VARCHAR(32) NOT NULL COMMENT 'Fecha y hora del sellado en la zona configurada',
  actor VARCHAR(100) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  total INT NOT NULL,
  resumen TEXT NOT NULL COMMENT 'JSON: totales por estación, origen y estado',
  csv LONGBLOB NOT NULL,
  acta LONGBLOB NOT NULL,
  UNIQUE KEY uq_sellos_real (es_real)
);

ALTER TABLE bitacora_boletos MODIFY tipo ENUM('reclamo','compra','anulacion','captura','sellado') NOT NULL;

-- Reversa (documentada):
--   ALTER TABLE bitacora_boletos MODIFY tipo ENUM('reclamo','compra','anulacion','captura') NOT NULL;
--   DROP TABLE sellos;
