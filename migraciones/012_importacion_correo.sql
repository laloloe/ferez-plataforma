-- ORDEN 10: importación automática por correo (buzón IMAP dedicado).

-- Remitentes autorizados: cada correo pertenece a UNA estación; esa
-- asignación decide a qué estación se importa (no se confía en el Excel).
CREATE TABLE IF NOT EXISTS remitentes_autorizados (
  id INT PRIMARY KEY AUTO_INCREMENT,
  correo VARCHAR(190) NOT NULL,
  estacion_id INT NOT NULL,
  fecha_alta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dado_de_alta_por VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_remitentes_correo (correo)
);

-- Correos ya vistos (idempotencia por Message-ID: uno jamás se procesa dos veces).
CREATE TABLE IF NOT EXISTS correos_importados (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  message_id VARCHAR(255) NOT NULL,
  remitente VARCHAR(190) NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resultado ENUM('procesado','rechazado','error') NOT NULL,
  detalle VARCHAR(400) NULL,
  UNIQUE KEY uq_correos_message_id (message_id)
);

-- Archivos importados: el original completo con su huella y su reporte,
-- para auditoría ante cualquier disputa.
CREATE TABLE IF NOT EXISTS archivos_importados (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estacion_id INT NOT NULL,
  remitente VARCHAR(190) NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  tamano INT NOT NULL,
  contenido LONGBLOB NOT NULL,
  reporte VARCHAR(400) NOT NULL,
  message_id VARCHAR(255) NULL,
  KEY idx_archivos_estacion_fecha (estacion_id, fecha)
);

-- Estado de la revisión del buzón (una sola fila).
CREATE TABLE IF NOT EXISTS importacion_correo_estado (
  id TINYINT PRIMARY KEY,
  ultima_revision DATETIME NULL,
  detalle VARCHAR(200) NULL
);
INSERT IGNORE INTO importacion_correo_estado (id) VALUES (1);

-- Qué estaciones deben mandar archivo diario (Oasis captura a mano).
ALTER TABLE estaciones ADD COLUMN espera_archivo_diario TINYINT NOT NULL DEFAULT 0;
UPDATE estaciones SET espera_archivo_diario = 1 WHERE nombre IN ('Rubio', 'Km 12.9 Corredor Comercial');

-- Claves nuevas.
INSERT IGNORE INTO configuracion (clave, valor, descripcion) VALUES
  ('intervalo_correo_minutos', '10', 'Cada cuántos minutos se revisa el buzón de importación.'),
  ('hora_limite_archivo', '10:00', 'Hora local límite: si una estación con archivo diario no ha importado ventas del día anterior, se alerta.');

-- Nuevo tipo de asiento en bitácora (TiDB: solo se agrega AL FINAL del ENUM).
ALTER TABLE bitacora_boletos MODIFY tipo ENUM('reclamo','compra','anulacion','captura','sellado','acceso','ajuste','constancia','correo') NOT NULL;

-- Reversa (documentada):
--   DROP TABLE remitentes_autorizados; DROP TABLE correos_importados;
--   DROP TABLE archivos_importados; DROP TABLE importacion_correo_estado;
--   ALTER TABLE estaciones DROP COLUMN espera_archivo_diario;
--   DELETE FROM configuracion WHERE clave IN ('intervalo_correo_minutos','hora_limite_archivo');
--   (el valor 'correo' del ENUM no se retira: TiDB no permite quitar valores)
