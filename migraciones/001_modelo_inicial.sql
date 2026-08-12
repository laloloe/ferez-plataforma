-- Modelo de datos inicial (SPEC sección 4).
-- Identidad de cliente compartida entre sorteo y fidelización.

CREATE TABLE IF NOT EXISTS estaciones (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  clave_controlgas VARCHAR(50) NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_estaciones_nombre (nombre)
);

CREATE TABLE IF NOT EXISTS clientes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  telefono VARCHAR(20) NOT NULL COMMENT 'E.164, ej. +52625XXXXXXX — identidad principal',
  nombre VARCHAR(150) NOT NULL,
  fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acepto_aviso_privacidad TINYINT(1) NOT NULL DEFAULT 0,
  fecha_aceptacion_aviso DATETIME NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_clientes_telefono (telefono)
);

-- Espejo local de las cargas registradas en ControlGAS.
-- Fuente de verdad para validar folios.
CREATE TABLE IF NOT EXISTS ventas (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  estacion_id INT NOT NULL,
  folio VARCHAR(50) NOT NULL,
  fecha_hora DATETIME NOT NULL,
  producto VARCHAR(80) NULL,
  litros DECIMAL(10,3) NULL,
  importe DECIMAL(12,2) NULL,
  origen ENUM('controlgas','manual') NOT NULL DEFAULT 'manual',
  fecha_importacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ventas_estacion_folio (estacion_id, folio),
  KEY idx_ventas_folio (folio)
);

CREATE TABLE IF NOT EXISTS boletos (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  folio_boleto VARCHAR(30) NOT NULL COMMENT 'Visible al cliente; único, no adivinable',
  cliente_id BIGINT NOT NULL,
  venta_id BIGINT NOT NULL,
  estacion_id INT NOT NULL,
  cantidad INT NOT NULL DEFAULT 1,
  fecha_emision DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estado ENUM('activo','anulado') NOT NULL DEFAULT 'activo',
  UNIQUE KEY uq_boletos_folio (folio_boleto),
  -- Una venta genera boletos una sola vez (SPEC sección 13)
  UNIQUE KEY uq_boletos_venta (venta_id),
  KEY idx_boletos_cliente (cliente_id),
  KEY idx_boletos_estacion (estacion_id)
);

-- Bitácora de toda interacción por WhatsApp, para auditoría y soporte.
CREATE TABLE IF NOT EXISTS mensajes_whatsapp (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  telefono VARCHAR(20) NOT NULL,
  direccion ENUM('entrante','saliente') NOT NULL,
  contenido TEXT NULL,
  resultado ENUM('ok','folio_invalido','folio_usado','no_registrado','error') NULL,
  fecha_hora DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mensajes_telefono (telefono)
);

-- Reglas parametrizables (SPEC sección 11): la mecánica del sorteo se
-- configura aquí sin cambiar código, cuando Carlos Solís la defina.
CREATE TABLE IF NOT EXISTS configuracion (
  clave VARCHAR(100) PRIMARY KEY,
  valor TEXT NOT NULL,
  descripcion VARCHAR(255) NULL,
  fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
