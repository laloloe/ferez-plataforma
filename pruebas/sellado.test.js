// Pruebas de la ORDEN 5: sellado del padrón. Requieren base de datos.
// Este archivo corre al final de la suite: el sellado real bloquea el motor.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const motor = require('../servicios/motor-boletos');
const sellado = require('../servicios/sellado');

const hayBD = configurada();
const TELEFONO = '+526254445566';

// pdfkit escribe el texto como cadenas hexadecimales <...>; esto lo decodifica
// para poder afirmar qué contiene (y qué no contiene) el acta.
function textoPlanoDePDF(buffer) {
  const crudo = buffer.toString('latin1');
  let texto = '';
  for (const coincidencia of crudo.matchAll(/<([0-9a-fA-F]+)>/g)) {
    const hex = coincidencia[1].length % 2 ? coincidencia[1] + '0' : coincidencia[1];
    texto += Buffer.from(hex, 'hex').toString('latin1');
  }
  return texto;
}
let estacionId;
let ventaViva;

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['sellos', 'boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes', 'mensajes_whatsapp', 'estado_bot']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  sellado._limpiarCacheSelloReal();

  const [estacion] = await consultar("SELECT id FROM estaciones WHERE nombre = 'Rubio'");
  estacionId = estacion.id;
  await consultar(
    `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
     VALUES (?, 'Sellado Prueba García', 1, NOW())`, [TELEFONO]);

  // Padrón variado: 2 boletos de carga (uno se anula), 1 de oficina.
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, litros, importe, origen)
     VALUES (?, 'SEL-1', NOW(), 'Magna', 40, 1400, 'manual')`, [estacionId]);
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, litros, importe, origen)
     VALUES (?, 'SEL-2', NOW(), 'Premium', 30, 900, 'manual')`, [estacionId]);
  const r1 = await motor.reclamarFolio({ telefono: TELEFONO, folio: 'SEL-1', estacionId, actor: 'prueba' });
  assert.equal(r1.ok, true);
  const r2 = await motor.emitirBoletoOficina({ nombre: 'Oficina Prueba', telefono: '+526254445577', recibo: 'R-SEL', actor: 'prueba' });
  assert.equal(r2.ok, true);
  const anulacion = await motor.anularBoleto({ folioBoleto: r1.boletos[1], motivo: 'Prueba de anulación', actor: 'prueba' });
  assert.equal(anulacion.ok, true);
  const [venta] = await consultar("SELECT id FROM ventas WHERE folio = 'SEL-2'");
  ventaViva = venta.id;
});

after(async () => {
  if (hayBD) await obtenerPool().end();
});

test('CSV canónico: columnas públicas exactas, LF, sin BOM, sin datos personales', { skip: !hayBD }, async () => {
  const csv = await sellado.generarCSVCanonico();
  const texto = csv.toString('utf8');
  assert.equal(csv[0] === 0xEF, false, 'sin BOM');
  assert.equal(texto.includes('\r'), false, 'saltos LF, nunca CRLF');
  const lineas = texto.split('\n');
  assert.equal(lineas[0], 'boleto,fecha_emision,estacion,origen,estado');
  assert.equal(lineas[lineas.length - 1], '', 'termina con LF');
  assert.equal(lineas.length - 2, 3, 'un renglón por boleto, anulados incluidos');
  assert.match(lineas[1], /^SF27-000001,\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},Rubio,Carga,Vigente$/);
  assert.equal(texto.includes('Anulado conforme a las bases'), true);
  assert.equal(texto.includes('Oficina,Oficina'), true);
  assert.equal(texto.includes('+52'), false, 'sin teléfonos');
  assert.equal(texto.includes('García') || texto.includes('Prueba'), false, 'sin nombres');
});

test('hash reproducible: dos simulacros con el mismo padrón dan el mismo SHA-256', { skip: !hayBD }, async () => {
  const primero = await sellado.ejecutarSellado('simulacro', 'admin:prueba');
  const segundo = await sellado.ejecutarSellado('simulacro', 'admin:prueba');
  assert.equal(primero.ok, true);
  assert.equal(segundo.ok, true);
  assert.equal(primero.sha256, segundo.sha256);
  assert.notEqual(primero.id, segundo.id, 'el simulacro es repetible');
  assert.equal(await sellado.selloReal(), null, 'los simulacros no aparecen al público');
});

test('acta PDF: bien formada, con el hash, sin datos personales', { skip: !hayBD }, async () => {
  const sellos = await sellado.listarSellos();
  const { acta, sha256 } = await sellado.archivosDeSello(sellos[0].id);
  assert.equal(acta.toString('latin1').startsWith('%PDF-'), true);
  const texto = textoPlanoDePDF(acta);
  assert.equal(texto.includes(sha256.slice(0, 32)), true, 'el hash aparece en el acta');
  assert.equal(texto.includes('PRUEBA'), true, 'el simulacro lleva marca de agua');
  assert.equal(texto.includes('526254445566'), false, 'sin teléfonos');
  assert.equal(texto.includes('Garc'), false, 'sin nombres');
});

test('el sellado real solo procede con el padrón cerrado', { skip: !hayBD }, async () => {
  const resultado = await sellado.ejecutarSellado('real', 'admin:prueba');
  assert.equal(resultado.ok, false);
  assert.equal(resultado.mensaje.includes('aún no está cerrado'), true);
});

test('sellado real: una sola vez, con acta sin marca de PRUEBA', { skip: !hayBD }, async () => {
  await consultar("UPDATE configuracion SET valor = '2020-01-01 00:00' WHERE clave = 'cierre_padron'");
  const real = await sellado.ejecutarSellado('real', 'admin:eduardo');
  assert.equal(real.ok, true);
  const otraVez = await sellado.ejecutarSellado('real', 'admin:eduardo');
  assert.equal(otraVez.ok, false);
  assert.equal(otraVez.mensaje.includes('ya se ejecutó'), true);

  const info = await sellado.selloReal();
  assert.equal(info.actor, 'admin:eduardo');
  const { acta } = await sellado.archivosDeSello(info.id);
  assert.equal(textoPlanoDePDF(acta).includes('PRUEBA'), false, 'el acta real no lleva marca de agua');
  const [registro] = await consultar(
    "SELECT detalle FROM bitacora_boletos WHERE tipo = 'sellado' ORDER BY id DESC LIMIT 1");
  assert.equal(registro.detalle.includes('SELLADO REAL'), true);
});

test('tras el sellado real: emisión y anulación bloqueadas con mensaje claro', { skip: !hayBD }, async () => {
  const reclamo = await motor.reclamarFolio({ telefono: TELEFONO, folio: 'SEL-2', estacionId, actor: 'prueba' });
  assert.equal(reclamo.codigo, 'PADRON_SELLADO');
  const oficina = await motor.emitirBoletoOficina({ nombre: 'Tarde', telefono: '+526254445588', recibo: 'R-TARDE', actor: 'prueba' });
  assert.equal(oficina.codigo, 'PADRON_SELLADO');
  const anulacion = await motor.anularBoleto({ folioBoleto: 'SF27-000001', motivo: 'tarde', actor: 'prueba' });
  assert.equal(anulacion.ok, false);
  assert.equal(anulacion.mensaje.includes('sellado'), true);
  const marca = await motor.marcarVenta({ ventaId: ventaViva, estado: 'cancelada', actor: 'prueba' });
  assert.equal(marca.ok, false);
});

test('inmutabilidad: modificar la BD después NO cambia los archivos sellados', { skip: !hayBD }, async () => {
  const info = await sellado.selloReal();
  const antes = await sellado.archivosDeSello(info.id);
  const hashAntes = crypto.createHash('sha256').update(antes.csv).digest('hex');
  assert.equal(hashAntes, info.sha256, 'el archivo guardado coincide con el hash publicado');

  // Manipulación directa de la BD (fuera del motor, que ya está bloqueado).
  await consultar("UPDATE boletos SET estado = 'anulado', motivo_anulacion = 'manipulación' WHERE folio_boleto = 'SF27-000001'");
  const despues = await sellado.archivosDeSello(info.id);
  assert.equal(crypto.createHash('sha256').update(despues.csv).digest('hex'), info.sha256,
    'el CSV servido es idéntico al sellado');
  const regenerado = await sellado.generarCSVCanonico();
  assert.notEqual(crypto.createHash('sha256').update(regenerado).digest('hex'), info.sha256,
    'la BD sí cambió: la diferencia la detectaría cualquier verificación');
});
