-- ORDEN 6: usuarios individuales y roles en /admin.
-- Los usuarios nunca se borran (por la bitácora): solo se desactivan.

CREATE TABLE IF NOT EXISTS usuarios (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  correo VARCHAR(190) NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  hash_contrasena VARCHAR(100) NOT NULL,
  rol ENUM('administrador','operador') NOT NULL DEFAULT 'operador',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  debe_cambiar TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Contraseña temporal: obliga cambio al primer acceso',
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueado_hasta DATETIME NULL,
  fecha_ultimo_acceso DATETIME NULL,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_correo (correo)
);

-- La bitácora también registra eventos de acceso (bloqueos) y ajustes
-- administrativos (parámetros, gestión de usuarios, importaciones).
ALTER TABLE bitacora_boletos MODIFY tipo ENUM('reclamo','compra','anulacion','captura','sellado','acceso','ajuste') NOT NULL;

-- Reversa (documentada):
--   ALTER TABLE bitacora_boletos MODIFY tipo ENUM('reclamo','compra','anulacion','captura','sellado') NOT NULL;
--   DROP TABLE usuarios;
