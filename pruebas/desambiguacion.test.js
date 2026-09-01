// Pruebas de la ORDEN 4: desambiguación de estación en el bot y captura
// manual de ventas. Requieren base de datos configurada.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const bot = require('../servicios/bot-whatsapp');
const { insertarVentaCapturada } = require('../rutas/admin-captura');
const { FuenteManual } = require('../fuentes/fuente-manual');

const hayBD = configurada();

const CLIENTE_A = '+526251110001';
const CLIENTE_B = '+526251110002';
let rubioId;
let kmId;
let oasisId;
let contadorWamid = 0;

function cargaUtil(de, texto) {
  return {
    entry: [{ changes: [{ value: { messages: [{
      id: `wamid.o4.${++contadorWamid}`, from: de, type: 'text', text: { body: texto },
    }] } }] }],
  };
}

async function conversar(telefono, texto) {
  const enviados = [];
  await bot.procesarWebhook(cargaUtil(telefono.replace('+', ''), texto), {
    enviar: async (a, b) => { enviados.push({ telefono: a, texto: b }); return { ok: true, id: `wamid.r.${contadorWamid}` }; },
  });
  return enviados[0];
}

async function crearVenta(estacionId, folio, importe = 700) {
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, litros, importe, origen)
     VALUES (?, ?, NOW(), 'Magna', 40, ?, 'manual')`, [estacionId, folio, importe]);
}

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes', 'mensajes_whatsapp', 'estado_bot']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  const estaciones = await consultar('SELECT id, nombre FROM estaciones');
  rubioId = estaciones.find((e) => e.nombre === 'Rubio').id;
  kmId = estaciones.find((e) => e.nombre === 'Km 12.9 Corredor Comercial').id;
  oasisId = estaciones.find((e) => e.nombre === 'Oasis').id;
  for (const telefono of [CLIENTE_A, CLIENTE_B]) {
    await consultar(
      `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
       VALUES (?, 'Cliente Orden Cuatro', 1, NOW())`, [telefono]);
  }
});

after(async () => {
  if (hayBD) await obtenerPool().end();
});

test('folio en una sola estación: flujo normal y éxito con la estación en el texto', { skip: !hayBD }, async () => {
  await crearVenta(rubioId, 'UNI-1', 1400);
  const r = await conversar(CLIENTE_A, 'UNI-1');
  assert.equal(r.texto.includes('de Rubio generó'), true);
  assert.equal(r.texto.includes('SF27-000001'), true);
});

test('folio en dos estaciones: el bot pregunta con opciones numeradas y no elige', { skip: !hayBD }, async () => {
  await crearVenta(rubioId, 'DUP-1');
  await crearVenta(kmId, 'DUP-1');
  const r = await conversar(CLIENTE_A, 'DUP-1');
  assert.equal(r.texto.includes('más de una estación'), true);
  assert.equal(r.texto.includes('1 Km 12.9 Corredor Comercial'), true);
  assert.equal(r.texto.includes('2 Rubio'), true);
  assert.equal(r.texto.includes('3 Oasis'), true);
  const [{ total }] = await consultar('SELECT COUNT(*) AS total FROM boletos');
  assert.equal(Number(total), 2, 'solo los boletos de UNI-1: nada se emitió sin confirmar');
});

test('elección correcta: emite SOLO contra la estación elegida', { skip: !hayBD }, async () => {
  const r = await conversar(CLIENTE_A, '2'); // 2 = Rubio
  assert.equal(r.texto.includes('de Rubio generó'), true);
  const boletos = await consultar(
    "SELECT b.estacion_id FROM boletos b JOIN ventas v ON v.id = b.venta_id WHERE v.folio = 'DUP-1'");
  assert.equal(boletos.length, 1);
  assert.equal(boletos[0].estacion_id, rubioId);
  const [{ pendientes }] = await consultar('SELECT COUNT(*) AS pendientes FROM estado_bot');
  assert.equal(Number(pendientes), 0);
});

test('elección de estación sin esa venta: rechazo, bitácora y cero emisiones', { skip: !hayBD }, async () => {
  await crearVenta(rubioId, 'DUP-2');
  await crearVenta(kmId, 'DUP-2');
  await conversar(CLIENTE_B, 'DUP-2');
  const r = await conversar(CLIENTE_B, '3'); // 3 = Oasis, que no tiene DUP-2
  assert.equal(r.texto.includes('En Oasis no encontramos'), true);
  const [registro] = await consultar(
    "SELECT resultado FROM bitacora_boletos WHERE telefono = ? ORDER BY id DESC LIMIT 1", [CLIENTE_B]);
  assert.equal(registro.resultado, 'DESAMBIGUACION_SIN_VENTA');
  const [{ total }] = await consultar(
    "SELECT COUNT(*) AS total FROM boletos b JOIN ventas v ON v.id = b.venta_id WHERE v.folio = 'DUP-2'");
  assert.equal(Number(total), 0, 'jamás se emite contra estación no confirmada');
});

test('respuesta inválida: repite la pregunta una vez y luego cancela', { skip: !hayBD }, async () => {
  await conversar(CLIENTE_B, 'DUP-2');
  const repetida = await conversar(CLIENTE_B, 'no sé');
  assert.equal(repetida.texto.includes('Responde solo con el número'), true);
  const cancelada = await conversar(CLIENTE_B, 'tampoco sé');
  assert.equal(cancelada.texto.includes('cancelé la consulta del folio DUP-2'), true);
  const [{ pendientes }] = await consultar('SELECT COUNT(*) AS pendientes FROM estado_bot');
  assert.equal(Number(pendientes), 0);
});

test('pendiente expirado: el siguiente folio arranca flujo nuevo', { skip: !hayBD }, async () => {
  await conversar(CLIENTE_B, 'DUP-2');
  await consultar('UPDATE estado_bot SET expira = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE telefono = ?', [CLIENTE_B]);
  await crearVenta(kmId, 'SOLO-2', 900);
  const r = await conversar(CLIENTE_B, 'SOLO-2');
  assert.equal(r.texto.includes('de Km 12.9 Corredor Comercial generó'), true);
});

test('captura individual: duplicado por estación + folio rechazado con bitácora', { skip: !hayBD }, async () => {
  const venta = { folio: 'OAS-1', fecha_hora: new Date(), producto: 'Premium', litros: 30, importe: 900, forma_pago: 'contado' };
  assert.equal(await insertarVentaCapturada({ estacionId: oasisId, venta, actor: 'admin:prueba' }), true);
  assert.equal(await insertarVentaCapturada({ estacionId: oasisId, venta, actor: 'admin:prueba' }), false);
  const registros = await consultar(
    "SELECT resultado FROM bitacora_boletos WHERE tipo = 'captura' AND folio_venta = 'OAS-1' ORDER BY id");
  assert.deepEqual(registros.map((registro) => registro.resultado), ['OK', 'DUPLICADO']);
  const [capturada] = await consultar("SELECT origen, capturada_por FROM ventas WHERE folio = 'OAS-1'");
  assert.equal(capturada.origen, 'captura');
  assert.equal(capturada.capturada_por, 'admin:prueba');
});

test('CSV mixto: aceptadas y rechazadas renglón por renglón', { skip: !hayBD }, async () => {
  const csv = 'folio,fecha_hora,producto,litros,importe,forma_pago\n' +
    'OAS-2,2026-09-01 10:00,Magna,40,800,contado\n' +   // válida
    'OAS-1,2026-09-01 11:00,Magna,40,700,contado\n' +   // duplicada (ya capturada)
    'OAS-3,31/02/2026,Magna,40,700,contado\n';          // fecha inválida
  const { ventas, errores } = await new FuenteManual(csv).obtenerVentas();
  assert.equal(errores.length, 1);
  assert.equal(errores[0].includes('Fila 4'), true);
  let aceptadas = 0;
  const rechazadas = [...errores];
  for (const venta of ventas) {
    if (await insertarVentaCapturada({ estacionId: oasisId, venta, actor: 'admin:prueba' })) aceptadas++;
    else rechazadas.push(`Fila ${venta.fila}: duplicada`);
  }
  assert.equal(aceptadas, 1);
  assert.equal(rechazadas.length, 2);
  assert.equal(rechazadas.some((r) => r.includes('Fila 3')), true);
});

test('el bot reclama una venta capturada de Oasis con el flujo normal', { skip: !hayBD }, async () => {
  const r = await conversar(CLIENTE_A, 'OAS-2');
  assert.equal(r.texto.includes('de Oasis generó'), true);
  assert.equal(r.texto.includes('SF27-'), true);
});
