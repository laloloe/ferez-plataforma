// Pruebas de la ORDEN 8: constancia electrónica del boleto y muestra en PDF.
// Corren contra el servidor Express real en un puerto efímero.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const { leerConfiguracion } = require('../lib/configuracion');
const constancia = require('../servicios/constancia');
const motor = require('../servicios/motor-boletos');
const bot = require('../servicios/bot-whatsapp');
const { app } = require('../server');

const hayBD = configurada();
let servidor;
let base;

const TELEFONO = '+526251112233';

async function pedir(ruta, cuerpo) {
  const respuesta = await fetch(base + ruta, {
    method: cuerpo ? 'POST' : 'GET',
    headers: cuerpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
    body: cuerpo ? new URLSearchParams(cuerpo).toString() : undefined,
  });
  return { status: respuesta.status, texto: await respuesta.text() };
}

// ---------- Unitarias (sin BD) ----------

test('interpretarBoleto: formatos aceptados y rechazados', () => {
  assert.equal(constancia.interpretarBoleto('SF27-000123'), 123);
  assert.equal(constancia.interpretarBoleto('sf27000123'), 123);
  assert.equal(constancia.interpretarBoleto('  000123 '), 123);
  assert.equal(constancia.interpretarBoleto('123'), 123);
  assert.equal(constancia.interpretarBoleto('SF27-'), null);
  assert.equal(constancia.interpretarBoleto('hola'), null);
  assert.equal(constancia.interpretarBoleto(''), null);
});

test('el mensaje de éxito del bot enlaza la constancia', () => {
  const texto = bot.TEXTOS.exito('123', 'Rubio', ['SF27-000001', 'SF27-000002']);
  assert.equal(texto.includes('/constancia'), true);
  assert.equal(texto.includes('/boletos'), true);
});

// ---------- Con BD y servidor ----------

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['sellos', 'boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes', 'mensajes_whatsapp']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  await consultar("UPDATE configuracion SET valor = '' WHERE clave = 'numero_permiso'");

  const [estacion] = await consultar("SELECT id FROM estaciones WHERE nombre = 'Rubio'");
  await consultar(
    `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
     VALUES (?, 'Constancia López García', 1, NOW())`, [TELEFONO]);
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, litros, importe, origen)
     VALUES (?, 'CONST-1', NOW(), 'Magna', 40, 1400, 'manual')`, [estacion.id]);
  const reclamo = await motor.reclamarFolio({
    telefono: TELEFONO, folio: 'CONST-1', estacionId: estacion.id, actor: 'prueba',
  });
  assert.equal(reclamo.ok, true, 'el reclamo de preparación debe emitir boletos');

  servidor = app.listen(0);
  await new Promise((resolver) => servidor.on('listening', resolver));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) servidor.close();
  if (hayBD) await obtenerPool().end();
});

test('GET /constancia muestra el formulario', { skip: !hayBD }, async () => {
  const r = await pedir('/constancia');
  assert.equal(r.status, 200);
  assert.equal(r.texto.includes('Número de boleto'), true);
  assert.equal(r.texto.includes('Teléfono del titular'), true);
});

test('boleto + teléfono correctos: constancia completa, EN TRÁMITE sin permiso, sin datos personales', { skip: !hayBD }, async () => {
  const r = await pedir('/constancia', { boleto: 'SF27-000001', telefono: '625 111 2233' });
  assert.equal(r.status, 200);
  assert.equal(r.texto.includes('SF27-000001'), true);
  assert.equal(r.texto.includes('SORTEO FEREZ 2027'), true);
  assert.equal(r.texto.includes('Rubio'), true);
  assert.equal(r.texto.includes('CONST-1'), true, 'folio de la operación');
  assert.equal(r.texto.includes('Constancia L.'), true, 'titular enmascarado');
  assert.equal(r.texto.includes('Vigente'), true);
  assert.equal(r.texto.includes('EN TRÁMITE'), true, 'sin permiso: marca EN TRÁMITE');
  assert.equal(r.texto.includes('DOCUMENTO SIN VALIDEZ'), true);
  assert.equal(r.texto.includes('20 días hábiles'), true);
  assert.equal(r.texto.includes('Ministerio Público'), true);
  assert.equal(r.texto.includes('Versalles 49'), true);
  // Privacidad: ni teléfono ni apellidos completos.
  assert.equal(r.texto.includes('1112233'), false, 'sin teléfono');
  assert.equal(r.texto.includes('López'), false, 'sin apellido');
  assert.equal(r.texto.includes('García'), false, 'sin segundo apellido');
});

test('teléfono equivocado y boleto inexistente: mismo mensaje genérico, sin revelar nada', { skip: !hayBD }, async () => {
  const equivocado = await pedir('/constancia', { boleto: 'SF27-000001', telefono: '6259990000' });
  const inexistente = await pedir('/constancia', { boleto: 'SF27-999999', telefono: '6259990000' });
  for (const r of [equivocado, inexistente]) {
    assert.equal(r.status, 200);
    assert.equal(r.texto.includes('No pudimos validar la constancia'), true);
    assert.equal(r.texto.includes('Vigente'), false);
    assert.equal(r.texto.includes('Constancia L.'), false);
  }
  // La respuesta no distingue boleto real de inexistente (mismo mensaje).
  assert.equal(
    equivocado.texto.includes('No pudimos validar la constancia'),
    inexistente.texto.includes('No pudimos validar la constancia'));
});

test('sin permiso, el sitio no enlaza /constancia; con permiso, todo se activa', { skip: !hayBD }, async () => {
  const sinPermiso = await pedir('/boletos');
  assert.equal(sinPermiso.texto.includes('/constancia'), false, 'sin permiso no hay enlace público');

  await consultar("UPDATE configuracion SET valor = '20270001PS07' WHERE clave = 'numero_permiso'");
  const conPermiso = await pedir('/boletos');
  assert.equal(conPermiso.texto.includes('/constancia'), true, 'con permiso el padrón enlaza la constancia');

  const r = await pedir('/constancia', { boleto: 'SF27-000002', telefono: '6251112233' });
  assert.equal(r.texto.includes('20270001PS07'), true, 'el número de permiso aparece');
  assert.equal(r.texto.includes('EN TRÁMITE'), false, 'la constancia queda limpia');
  assert.equal(r.texto.includes('DOCUMENTO SIN VALIDEZ'), false);
});

// ---------- Muestra en PDF ----------

function textoPlanoDePDF(buffer) {
  const crudo = buffer.toString('latin1');
  let texto = '';
  for (const coincidencia of crudo.matchAll(/<([0-9a-fA-F]+)>/g)) {
    const hex = coincidencia[1].length % 2 ? coincidencia[1] + '0' : coincidencia[1];
    texto += Buffer.from(hex, 'hex').toString('latin1');
  }
  return texto;
}

test('la muestra en PDF trae todas las leyendas, la marca MUESTRA y el permiso en blanco', { skip: !hayBD }, async () => {
  const config = await leerConfiguracion();
  const pdf = await constancia.generarMuestraPDF(config);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const texto = textoPlanoDePDF(pdf);
  assert.equal(texto.includes('MUESTRA'), true);
  assert.equal(texto.includes('SORTEO'), true);
  assert.equal(texto.includes('FEREZ'), true);
  assert.equal(texto.includes('Feres'), true, 'razón social');
  assert.equal(texto.includes('Gasolinero'), true, 'segunda razón social');
  assert.equal(texto.includes('______'), true, 'número de permiso en blanco');
  assert.equal(texto.includes('gratuito'), true);
  assert.equal(texto.includes('caducan'), true);
  assert.equal(texto.includes('Ministerio'), true);
  assert.equal(texto.includes('Versalles'), true);
  assert.equal(texto.includes('ferez.mx/bases'), true);
  assert.equal(texto.includes('700'), true, 'condición con el monto');
  assert.equal(texto.includes('SF27-000000'), true, 'boleto ficticio');
});

// ---------- Límite de intentos (al final: consume el cupo de la IP) ----------

test('límite de 10 intentos por hora, con bitácora', { skip: !hayBD }, async () => {
  await consultar("DELETE FROM bitacora_boletos WHERE tipo = 'constancia'");
  for (let i = 1; i <= constancia.LIMITE_INTENTOS_HORA; i++) {
    const r = await pedir('/constancia', { boleto: `SF27-88800${i}`, telefono: '6254440000' });
    assert.equal(r.texto.includes('No pudimos validar la constancia'), true, `intento ${i} aún pasa`);
  }
  const bloqueado = await pedir('/constancia', { boleto: 'SF27-888011', telefono: '6254440000' });
  assert.equal(bloqueado.texto.includes('demasiadas consultas'), true, 'el undécimo intento se bloquea');
  const [registro] = await consultar(
    "SELECT COUNT(*) AS total FROM bitacora_boletos WHERE tipo = 'constancia' AND resultado = 'LIMITE_EXCEDIDO'");
  assert.equal(Number(registro.total), 1);
  const [intentos] = await consultar(
    "SELECT COUNT(*) AS total FROM bitacora_boletos WHERE tipo = 'constancia' AND resultado = 'NO_COINCIDE'");
  assert.equal(Number(intentos.total), 10);
});
