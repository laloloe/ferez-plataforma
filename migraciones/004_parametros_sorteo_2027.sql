-- Parámetros del motor aprobados el 31-ago-2026 (SPEC v0.2, sección 14).
-- Valores por defecto: solo se insertan si no existen; editables desde /admin.

INSERT IGNORE INTO configuracion (clave, valor, descripcion) VALUES
  ('monto_por_boleto', '700', 'MXN por boleto. Boletos por venta = piso(importe / monto).'),
  ('acumula_multiplos', 'true', 'true: $1,400 = 2 boletos. Nunca se suman importes de ventas distintas.'),
  ('productos_participantes', 'magna,premium,diesel', 'Solo combustibles, todos por igual (lista separada por comas, sin distinguir mayúsculas ni acentos). Otros conceptos no generan boletos.'),
  ('formas_pago_excluidas', 'vales', 'Formas de pago que NO generan boletos (lista separada por comas). Contado y crédito participan igual.'),
  ('asignacion', 'cliente_registrado', 'El boleto se emite al cliente registrado (teléfono E.164) que reclama el folio.'),
  ('dias_para_reclamar', '7', 'Días naturales desde la fecha de la venta para reclamar el folio.'),
  ('precio_boleto_oficina', '70', 'MXN por boleto vendido en oficina (origen compra).'),
  ('tope_por_persona', '0', 'Máximo de boletos vigentes por persona. 0 = sin tope.'),
  ('formato_boleto', 'SF27-######', 'Prefijo + consecutivo global (los # son los dígitos, con ceros a la izquierda). Desde SF27-000001, sin huecos.'),
  ('cierre_padron', '2027-12-16 12:00', 'Fecha y hora local del cierre del padrón; después no se emite nada.'),
  ('zona_horaria', 'America/Chihuahua', 'Zona horaria para el cierre del padrón y el plazo de reclamo.');

-- Estación Oasis: alta como participante si no existe (sus ventas entrarán
-- por captura manual más adelante). Campo y Rubio operan por importación.
INSERT IGNORE INTO estaciones (nombre) VALUES ('Oasis');

-- Reversa (documentada):
--   DELETE FROM configuracion WHERE clave IN ('monto_por_boleto','acumula_multiplos',
--     'productos_participantes','formas_pago_excluidas','asignacion','dias_para_reclamar',
--     'precio_boleto_oficina','tope_por_persona','formato_boleto','cierre_padron','zona_horaria');
