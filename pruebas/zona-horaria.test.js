// Pruebas de la ORDEN 11: zona horaria única. La BD guarda UTC; toda
// presentación y toda regla con fechas usa zona_horaria (America/Chihuahua),
// sin depender de la zona del servidor.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const { leerConfiguracion } = require('../lib/configuracion');
const fechas = require('../lib/fechas');
const reglas = require('../servicios/reglas-boletos');
const motor = require('../servicios/motor-boletos');
const sellado = require('../servicios/sellado');
const correo = require('../servicios/importacion-correo');

const hayBD = configurada();
let estacionId;

// Zona fija para las unitarias: no dependen de la BD ni del servidor.
fechas._fijarZona('America/Chihuahua');

// ---------- Render (sin BD) ----------

test('un instante guardado a las 22:17Z se muestra 16:17 (Chihuahua, UTC-6)', () => {
  assert.equal(fechas.formatearFecha(new Date('2027-01-15T22:17:00Z')), '15/01/2027 16:17');
  assert.equal(fechas.formatearFecha('2027-01-15 22:17:00'), '15/01/2027 16:17', 'texto de BD = UTC');
  assert.equal(fechas.formatearFecha(null), '—');
});

test('utcDesdeLocal: el mediodía de Chihuahua es 18:00Z', () => {
  assert.equal(fechas.utcDesdeLocal('2027-12-16 12:00').toISOString(), '2027-12-16T18:00:00.000Z');
  // Ida y vuelta exacta.
  assert.equal(fechas.marcaLocal(fechas.utcDesdeLocal('2027-03-09 23:30:00')), '2027-03-09 23:30:00');
});

test('frontera D+7: una venta a las 23:30 locales pertenece a SU día local', () => {
  const config = { diasParaReclamar: 7, zonaHoraria: 'America/Chihuahua' };
  // Venta el 9 de marzo a las 23:30 locales = 05:30Z del 10 de marzo.
  const venta = '2027-03-10 05:30:00';
  assert.equal(reglas.diaLocal(venta, 'America/Chihuahua'), '2027-03-09', 'día local de la venta');
  // Fin del día local 16 de marzo (D+7): 23:59 locales = 05:59Z del 17.
  assert.equal(reglas.fueraDePlazo(venta, config, new Date('2027-03-17T05:59:00Z')), false, 'día 7: aún válido');
  // 00:01 locales del 17 de marzo = 06:01Z del 17: ya venció.
  assert.equal(reglas.fueraDePlazo(venta, config, new Date('2027-03-17T06:01:00Z')), true, 'día 8: fuera');
});

test('cierre_padron 12:00 es mediodía DE CHIHUAHUA (18:00Z)', () => {
  const config = { cierrePadron: '2027-12-16 12:00', zonaHoraria: 'America/Chihuahua' };
  assert.equal(reglas.padronCerrado(config, new Date('2027-12-16T17:59:00Z')), false, '11:59 local: abierto');
  assert.equal(reglas.padronCerrado(config, new Date('2027-12-16T18:01:00Z')), true, '12:01 local: cerrado');
});

// ---------- Con BD: motor, alerta de faltante y CSV ----------

before(async () => {
  if (!hayBD) return;
  fechas._fijarZona(null); // con BD, la zona sale de configuracion
  await ejecutarMigraciones();
  for (const tabla of ['sellos', 'boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes', 'mensajes_whatsapp']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  const [estacion] = await consultar("SELECT id FROM estaciones WHERE nombre = 'Rubio'");
  estacionId = estacion.id;
  await consultar(
    `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
     VALUES ('+526257770001', 'Cliente Zona Horaria', 1, NOW())`);
});

after(async () => {
  fechas._fijarZona(null);
  if (hayBD) await obtenerPool().end();
});

test('motor con reloj simulado: emite a las 11:59 locales del cierre y ya no a las 12:01', { skip: !hayBD }, async () => {
  // Ventas de ese mismo día (16-dic-2027, hora local) para que el plazo D+7 no interfiera.
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, importe, origen) VALUES
     (?, 'TZ-1', '2027-12-16 15:00:00', 'Magna', 700, 'manual'),
     (?, 'TZ-2', '2027-12-16 15:05:00', 'Magna', 700, 'manual')`, [estacionId, estacionId]);

  const antes = await motor.reclamarFolio({
    telefono: '+526257770001', folio: 'TZ-1', estacionId, actor: 'prueba',
    ahora: new Date('2027-12-16T17:59:00Z'), // 11:59 local
  });
  assert.equal(antes.ok, true, 'a las 11:59 locales el padrón sigue abierto');

  const despues = await motor.reclamarFolio({
    telefono: '+526257770001', folio: 'TZ-2', estacionId, actor: 'prueba',
    ahora: new Date('2027-12-16T18:01:00Z'), // 12:01 local
  });
  assert.equal(despues.ok, false);
  assert.equal(despues.codigo, 'PADRON_CERRADO', 'a las 12:01 locales ya no se emite');
});

test('alerta de faltante: la venta de las 23:30 locales cuenta como "ayer" correcto', { skip: !hayBD }, async () => {
  await consultar("UPDATE configuracion SET valor = '10:00' WHERE clave = 'hora_limite_archivo'");
  await consultar('UPDATE estaciones SET espera_archivo_diario = 0');
  await consultar('UPDATE estaciones SET espera_archivo_diario = 1 WHERE id = ?', [estacionId]);
  await consultar("DELETE FROM ventas WHERE folio LIKE 'TZF-%'");

  // Reloj simulado: 17-mar-2027 a las 12:00 locales (18:00Z), pasada la hora límite.
  const ahora = new Date('2027-03-17T18:00:00Z');
  // Única venta de "ayer" (16-mar local): a las 23:30 locales = 05:30Z del 17.
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, importe, origen)
     VALUES (?, 'TZF-1', '2027-03-17 05:30:00', 700, 'controlgas')`, [estacionId]);

  const config = await leerConfiguracion();
  const faltantes = await correo.estacionesConArchivoFaltante(config, ahora);
  assert.equal(faltantes.some((e) => e.id === estacionId), false,
    'la venta de las 23:30 locales cubre el día de ayer');

  // Sin esa venta, la estación sí aparece pendiente.
  await consultar("DELETE FROM ventas WHERE folio = 'TZF-1'");
  const sinVenta = await correo.estacionesConArchivoFaltante(config, ahora);
  assert.equal(sinVenta.some((e) => e.id === estacionId), true);
  await consultar('UPDATE estaciones SET espera_archivo_diario = 0 WHERE id = ?', [estacionId]);
});

test('CSV canónico: fecha_emision en hora local, hash reproducible y acta con la zona declarada', { skip: !hayBD }, async () => {
  // El boleto TZ-1 se emitió con fecha real (NOW() al reclamar); el CSV debe
  // mostrar la emisión en hora local, no la hora UTC guardada.
  const [boleto] = await consultar('SELECT fecha_emision FROM boletos ORDER BY numero LIMIT 1');
  const esperado = fechas.marcaLocal(boleto.fecha_emision, 'America/Chihuahua');
  const csv = (await sellado.generarCSVCanonico()).toString('utf8');
  assert.equal(csv.includes(esperado), true, 'el CSV trae la hora local');

  const primero = await sellado.ejecutarSellado('simulacro', 'prueba');
  const segundo = await sellado.ejecutarSellado('simulacro', 'prueba');
  assert.equal(primero.sha256, segundo.sha256, 'el hash sigue siendo reproducible');

  const archivos = await sellado.archivosDeSello(segundo.id);
  const crudo = archivos.acta.toString('latin1');
  let texto = '';
  for (const m of crudo.matchAll(/<([0-9a-fA-F]+)>/g)) {
    const hex = m[1].length % 2 ? m[1] + '0' : m[1];
    texto += Buffer.from(hex, 'hex').toString('latin1');
  }
  assert.equal(texto.includes('America/Chihuahua'), true, 'el acta declara la zona horaria');
});
