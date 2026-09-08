-- ORDEN 8: constancia electrónica del boleto (Reglamento art. 3, fr. III).

-- Claves nuevas. numero_permiso nace VACÍO: mientras lo esté, la constancia
-- se muestra "EN TRÁMITE — DOCUMENTO SIN VALIDEZ" y el sitio no la enlaza.
INSERT IGNORE INTO configuracion (clave, valor, descripcion) VALUES
  ('numero_permiso', '', 'Número de permiso otorgado por la Secretaría de Gobernación. Vacío = constancia EN TRÁMITE, sin enlaces públicos.'),
  ('vigencia_promocion', 'Del 1 de enero de 2027 al 16 de diciembre de 2027', 'Vigencia de la promoción tal como se imprime en la constancia.'),
  ('fecha_sorteo', '19 de diciembre de 2027', 'Fecha de celebración del sorteo tal como se imprime en la constancia.'),
  ('telefono_aclaraciones', '', 'Teléfono de la estación para aclaraciones (se imprime en la constancia).');

-- Nuevo tipo de asiento en bitácora para las consultas de constancia.
-- TiDB: los valores del ENUM solo se agregan AL FINAL.
ALTER TABLE bitacora_boletos MODIFY tipo ENUM('reclamo','compra','anulacion','captura','sellado','acceso','ajuste','constancia') NOT NULL;

-- Reversa (documentada):
--   DELETE FROM configuracion WHERE clave IN
--     ('numero_permiso','vigencia_promocion','fecha_sorteo','telefono_aclaraciones');
--   (el valor 'constancia' del ENUM no se retira: TiDB no permite quitar valores)
