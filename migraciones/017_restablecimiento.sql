-- Opción B: "Olvidé mi contraseña" por correo en el panel.

-- Tokens de restablecimiento: un solo uso, 30 minutos de vigencia.
-- En la base solo vive el SHA-256 del token, nunca el token mismo.
CREATE TABLE IF NOT EXISTS restablecimientos (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expira DATETIME NOT NULL,
  usado TINYINT NOT NULL DEFAULT 0,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_restablecimientos_token (token_hash),
  KEY idx_restablecimientos_usuario (usuario_id)
);

-- Reversa (documentada):
--   DROP TABLE restablecimientos;
