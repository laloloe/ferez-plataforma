-- Bot de WhatsApp (ORDEN 3) y remate: venta de oficina cancelada.

-- mensajes_whatsapp: id de mensaje de Meta (idempotencia), estado del envío
-- y resultado ampliado para los códigos del motor. TiDB no soporta convertir
-- una columna ENUM a VARCHAR con MODIFY: se recrea la columna y se renombra.
ALTER TABLE mensajes_whatsapp ADD COLUMN resultado_texto VARCHAR(40) NULL;
UPDATE mensajes_whatsapp SET resultado_texto = resultado;
ALTER TABLE mensajes_whatsapp DROP COLUMN resultado;
ALTER TABLE mensajes_whatsapp CHANGE resultado_texto resultado VARCHAR(40) NULL;
ALTER TABLE mensajes_whatsapp ADD COLUMN wa_message_id VARCHAR(128) NULL;
ALTER TABLE mensajes_whatsapp ADD UNIQUE KEY uq_mensajes_wa_id (wa_message_id);
ALTER TABLE mensajes_whatsapp ADD COLUMN estado_envio VARCHAR(30) NULL;
ALTER TABLE mensajes_whatsapp ADD COLUMN error_envio VARCHAR(400) NULL;

-- La venta de boletos de oficina se canceló: el sorteo será sin venta de
-- ningún boleto. El código y los datos se conservan; solo se apaga.
INSERT IGNORE INTO configuracion (clave, valor, descripcion) VALUES
  ('venta_oficina_habilitada', 'false', 'false: se oculta y bloquea el alta de boletos de oficina. La venta se canceló; el sorteo es sin venta de boletos.');

-- Reversa (documentada):
--   DELETE FROM configuracion WHERE clave = 'venta_oficina_habilitada';
--   ALTER TABLE mensajes_whatsapp DROP COLUMN error_envio;
--   ALTER TABLE mensajes_whatsapp DROP COLUMN estado_envio;
--   ALTER TABLE mensajes_whatsapp DROP KEY uq_mensajes_wa_id;
--   ALTER TABLE mensajes_whatsapp DROP COLUMN wa_message_id;
--   (recrear resultado como ENUM exigiría el mismo baile de columna nueva + rename)
