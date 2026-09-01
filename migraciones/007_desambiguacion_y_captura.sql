-- ORDEN 4: desambiguación de estación en el bot + captura manual de ventas.

-- Estado pendiente del bot por teléfono (pregunta de estación, 10 minutos).
CREATE TABLE IF NOT EXISTS estado_bot (
  telefono VARCHAR(20) PRIMARY KEY,
  folio VARCHAR(50) NOT NULL,
  opciones TEXT NOT NULL COMMENT 'JSON [{id,nombre}] numeradas tal como se preguntaron',
  intentos INT NOT NULL DEFAULT 0,
  expira DATETIME NOT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Ventas capturadas a mano (Oasis no opera ControlGAS): nuevo origen y
-- usuario que registró la captura.
ALTER TABLE ventas MODIFY origen ENUM('controlgas','manual','captura') NOT NULL DEFAULT 'manual';
ALTER TABLE ventas ADD COLUMN capturada_por VARCHAR(100) NULL;

-- La bitácora también registra capturas.
ALTER TABLE bitacora_boletos MODIFY tipo ENUM('reclamo','compra','anulacion','captura') NOT NULL;

-- Reversa (documentada):
--   ALTER TABLE bitacora_boletos MODIFY tipo ENUM('reclamo','compra','anulacion') NOT NULL;
--   ALTER TABLE ventas DROP COLUMN capturada_por;
--   ALTER TABLE ventas MODIFY origen ENUM('controlgas','manual') NOT NULL DEFAULT 'manual';
--   DROP TABLE estado_bot;
