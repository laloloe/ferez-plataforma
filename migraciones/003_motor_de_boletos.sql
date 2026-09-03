-- Motor de boletos (SPEC v0.2, sección 14 — paso 5 de la sección 12).
--
-- Cambio de modelo: `boletos` pasa a UNA FILA POR BOLETO (cada boleto tiene su
-- número consecutivo global propio). La garantía "una venta genera boletos una
-- sola vez" se mueve a la nueva tabla `emisiones` (venta_id ÚNICO a nivel BD):
-- una emisión registra el acto de emitir y agrupa los N boletos de esa venta.

-- Registro del acto de emisión. venta_id ÚNICO garantiza en BD que una venta
-- genera boletos una sola vez. Para boletos de oficina venta_id es NULL y el
-- recibo (único) evita capturar dos veces el mismo recibo.
CREATE TABLE IF NOT EXISTS emisiones (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tipo ENUM('reclamo','compra') NOT NULL,
  venta_id BIGINT NULL,
  cliente_id BIGINT NOT NULL,
  estacion_id INT NULL,
  recibo VARCHAR(50) NULL,
  cantidad INT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emisiones_venta (venta_id),
  UNIQUE KEY uq_emisiones_recibo (recibo),
  KEY idx_emisiones_cliente (cliente_id)
);

-- Contador global de numeración. Se lee con SELECT ... FOR UPDATE dentro de la
-- transacción de emisión: consecutivo sin huecos ni duplicados bajo concurrencia.
CREATE TABLE IF NOT EXISTS contador_boletos (
  id INT PRIMARY KEY,
  siguiente BIGINT NOT NULL
);
INSERT IGNORE INTO contador_boletos (id, siguiente) VALUES (1, 1);

-- Bitácora de cada emisión, rechazo y anulación (quién, cuándo, folio, resultado).
CREATE TABLE IF NOT EXISTS bitacora_boletos (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor VARCHAR(100) NOT NULL,
  tipo ENUM('reclamo','compra','anulacion') NOT NULL,
  telefono VARCHAR(20) NULL,
  folio_venta VARCHAR(50) NULL,
  estacion_id INT NULL,
  resultado VARCHAR(40) NOT NULL,
  detalle VARCHAR(400) NULL,
  boletos_generados INT NOT NULL DEFAULT 0,
  KEY idx_bitacora_fecha (fecha),
  KEY idx_bitacora_resultado (resultado)
);

-- boletos: una fila por boleto, con número propio y datos de anulación.
ALTER TABLE boletos DROP KEY uq_boletos_venta;
ALTER TABLE boletos ADD KEY idx_boletos_venta (venta_id);
ALTER TABLE boletos DROP COLUMN cantidad;
ALTER TABLE boletos MODIFY venta_id BIGINT NULL;
ALTER TABLE boletos MODIFY estacion_id INT NULL;
ALTER TABLE boletos ADD COLUMN numero BIGINT NULL;
ALTER TABLE boletos ADD UNIQUE KEY uq_boletos_numero (numero);
ALTER TABLE boletos ADD COLUMN emision_id BIGINT NULL;
ALTER TABLE boletos ADD KEY idx_boletos_emision (emision_id);
ALTER TABLE boletos ADD COLUMN origen ENUM('reclamo','compra') NOT NULL DEFAULT 'reclamo';
ALTER TABLE boletos ADD COLUMN motivo_anulacion VARCHAR(255) NULL;
ALTER TABLE boletos ADD COLUMN fecha_anulacion DATETIME NULL;

-- estado: 'activo' pasa a llamarse 'vigente' (SPEC v0.2: VIGENTE / ANULADO).
-- TiDB solo permite AGREGAR valores al final de un ENUM: 'vigente' se anexa
-- al final y 'activo' queda como valor legado en la lista (ninguna fila lo
-- usa después del UPDATE y el código nunca lo escribe).
ALTER TABLE boletos MODIFY estado ENUM('activo','anulado','vigente') NOT NULL DEFAULT 'vigente';
UPDATE boletos SET estado = 'vigente' WHERE estado = 'activo';

-- ventas: forma de pago (para excluir vales) y estado (cancelada/devuelta
-- anula sus boletos sin borrarlos ni liberar números).
ALTER TABLE ventas ADD COLUMN forma_pago VARCHAR(30) NULL;
ALTER TABLE ventas ADD COLUMN estado ENUM('normal','cancelada','devuelta') NOT NULL DEFAULT 'normal';

-- estaciones: bandera de participación en el sorteo.
ALTER TABLE estaciones ADD COLUMN participa_sorteo TINYINT(1) NOT NULL DEFAULT 1;

-- Reversa (documentada; el ejecutor no aplica reversas automáticamente):
--   ALTER TABLE estaciones DROP COLUMN participa_sorteo;
--   ALTER TABLE ventas DROP COLUMN estado; ALTER TABLE ventas DROP COLUMN forma_pago;
--   UPDATE boletos SET estado='activo' WHERE estado='vigente';
--   (el valor 'vigente' queda anexado al ENUM; TiDB no permite quitarlo)
--   ALTER TABLE boletos DROP COLUMN fecha_anulacion; ... DROP COLUMN motivo_anulacion;
--   ... DROP COLUMN origen; DROP KEY idx_boletos_emision; DROP COLUMN emision_id;
--   ... DROP KEY uq_boletos_numero; DROP COLUMN numero;
--   ALTER TABLE boletos MODIFY estacion_id INT NOT NULL; ... MODIFY venta_id BIGINT NOT NULL;
--   ALTER TABLE boletos ADD COLUMN cantidad INT NOT NULL DEFAULT 1;
--   ALTER TABLE boletos DROP KEY idx_boletos_venta; ALTER TABLE boletos ADD UNIQUE KEY uq_boletos_venta (venta_id);
--   DROP TABLE bitacora_boletos; DROP TABLE contador_boletos; DROP TABLE emisiones;
