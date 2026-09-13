-- ORDEN 12: modo exhibición (demo pública con banners de prueba).

INSERT IGNORE INTO configuracion (clave, valor, descripcion) VALUES
  ('modo_exhibicion', 'false', 'Solo actúa mientras numero_permiso esté vacía: true muestra el sorteo al público SIN sesión (landing con sus ligas, /boletos, /boletos/sellado y /registro completos) con banners "SIN VALIDEZ"; false lo oculta con "Próximamente". Con permiso capturado esta clave queda inerte.');

-- Reversa (documentada):
--   DELETE FROM configuracion WHERE clave = 'modo_exhibicion';
