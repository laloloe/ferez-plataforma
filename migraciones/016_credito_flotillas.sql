-- ORDEN 15: titularidad de boletos en ventas a crédito (flotillas).

-- Cuentas de crédito: el código es el mismo de la columna Código del
-- export de ControlGAS. Los boletos de una venta a crédito corresponden
-- al titular, salvo teléfonos autorizados con carta de consentimiento.
CREATE TABLE IF NOT EXISTS cuentas_credito (
  id INT PRIMARY KEY AUTO_INCREMENT,
  codigo VARCHAR(50) NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  telefono_titular VARCHAR(20) NOT NULL,
  activa TINYINT NOT NULL DEFAULT 1,
  fecha_alta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creada_por VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_cuentas_codigo (codigo)
);

-- Teléfonos autorizados (choferes) por cuenta, con la referencia de la
-- carta de consentimiento archivada en oficina.
CREATE TABLE IF NOT EXISTS credito_autorizados (
  id INT PRIMARY KEY AUTO_INCREMENT,
  cuenta_id INT NOT NULL,
  telefono VARCHAR(20) NOT NULL,
  referencia_carta VARCHAR(200) NOT NULL,
  fecha_alta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dado_de_alta_por VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_autorizado_cuenta_telefono (cuenta_id, telefono)
);

-- El boleto emitido por regla de crédito recuerda su cuenta.
ALTER TABLE boletos ADD COLUMN cuenta_credito_id INT NULL;

INSERT IGNORE INTO configuracion (clave, valor, descripcion) VALUES
  ('credito_requiere_titular', 'true', 'true: una venta a crédito sin cuenta registrada se rechaza (CREDITO_SIN_CUENTA) hasta registrar la cuenta. false: se emite a quien reclama (comportamiento anterior).');

-- Reversa (documentada):
--   ALTER TABLE boletos DROP COLUMN cuenta_credito_id;
--   DROP TABLE credito_autorizados; DROP TABLE cuentas_credito;
--   DELETE FROM configuracion WHERE clave = 'credito_requiere_titular';
