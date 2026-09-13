-- ORDEN 13: cinta promocional y sección del sorteo en la landing.

INSERT IGNORE INTO configuracion (clave, valor, descripcion) VALUES
  ('whatsapp_link', '', 'Liga del WhatsApp del sorteo (formato https://wa.me/5216251234567). Vacía = el botón "WhatsApp del sorteo" no se muestra en la landing.');

-- Reversa (documentada):
--   DELETE FROM configuracion WHERE clave = 'whatsapp_link';
