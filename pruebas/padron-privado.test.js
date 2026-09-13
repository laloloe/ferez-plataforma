// Pruebas de la ORDEN 14: padrón privado. El público solo verifica boletos
// uno por uno; el contador, la lista completa y los archivos del sellado
// quedan para sesiones del panel. El acta asienta el depósito notarial.

process.env.ADMIN_USUARIO = process.env.ADMIN_USUARIO || 'provisional';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'clave-entorno-larga';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const motor = require('../servicios/motor-boletos');
const sellado = require('../servicios/sellado');
const { app } = require('../server');

const hayBD = configurada();
let servidor;
let base;
let cookieAdmin;

async function pedir(ruta, { metodo = 'GET', cuerpo, cookie } = {}) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    redirect: 'manual',
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(cuerpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: cuerpo ? new URLSearchParams(cuerpo).toString() : undefined,
  });
  const galletas = respuesta.headers.getSetCookie?.() ?? [];
  return {
    status: respuesta.status,
    tipo: respuesta.headers.get('content-type'),
    cookie: galletas.length ? galletas[0].split(';')[0] : null,
    texto: await respuesta.text(),
  };
}

function textoPlanoDePDF(buffer) {
  const crudo = buffer.toString('latin1');
  let texto = '';
  for (const m of crudo.matchAll(/<([0-9a-fA-F]+)>/g)) {
    const hex = m[1].length % 2 ? m[1] + '0' : m[1];
    texto += Buffer.from(hex, 'hex').toString('latin1');
  }
  return texto;
}

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['sellos', 'boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes', 'mensajes_whatsapp', 'usuarios']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  sellado._limpiarCacheSelloReal();
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  await consultar("UPDATE configuracion SET valor = '20270001PS07' WHERE clave = 'numero_permiso'");
  await consultar("UPDATE configuracion SET valor = 'false' WHERE clave = 'modo_exhibicion'");

  const [estacion] = await consultar("SELECT id FROM estaciones WHERE nombre = 'Rubio'");
  await consultar(
    `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
     VALUES ('+526256660001', 'Privado López García', 1, NOW())`);
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, importe, origen)
     VALUES (?, 'PRIV-1', NOW(), 'Magna', 1400, 'manual')`, [estacion.id]);
  const reclamo = await motor.reclamarFolio({
    telefono: '+526256660001', folio: 'PRIV-1', estacionId: estacion.id, actor: 'prueba',
  });
  assert.equal(reclamo.ok, true, 'preparación: 2 boletos emitidos');

  servidor = app.listen(0);
  await new Promise((resolver) => servidor.on('listening', resolver));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (hayBD) {
    await consultar('DELETE FROM sellos');
    sellado._limpiarCacheSelloReal();
    await consultar("UPDATE configuracion SET valor = '' WHERE clave = 'numero_permiso'");
    await obtenerPool().end();
  }
  if (servidor) servidor.close();
});

test('sin sesión: /boletos sin contador ni lista, con buscador y texto del depósito', { skip: !hayBD }, async () => {
  const r = await pedir('/boletos');
  assert.equal(r.status, 200);
  assert.equal(r.texto.includes('Verifica tu boleto'), true);
  assert.equal(r.texto.includes('Busca tu boleto'), true, 'el buscador queda');
  assert.equal(r.texto.includes('notario público e inspector de la Secretaría de Gobernación'), true);
  // El total de boletos no aparece en NINGUNA parte del HTML público.
  assert.equal(r.texto.includes('Lista completa'), false, 'sin lista');
  assert.equal(r.texto.includes('boletos participando'), false, 'sin contador');
  assert.equal(r.texto.includes('class="contador"'), false);
  assert.equal(/\b2\s+boletos/.test(r.texto), false, 'sin el total (2) en el HTML');
  assert.equal(r.texto.includes('SF27-000001'), false, 'sin boletos ajenos sueltos');
});

test('sin sesión: el buscador individual sigue funcionando, enmascarado', { skip: !hayBD }, async () => {
  const r = await pedir('/boletos?buscar=SF27-000001');
  assert.equal(r.texto.includes('Resultado de tu búsqueda'), true);
  assert.equal(r.texto.includes('SF27-000001'), true);
  assert.equal(r.texto.includes('Privado L.'), true, 'titular enmascarado');
  assert.equal(r.texto.includes('López'), false);
  assert.equal(r.texto.includes('6660001'), false, 'sin teléfono');
  assert.equal(r.texto.includes('Lista completa'), false, 'la búsqueda tampoco abre la lista');
});

test('sin sesión y sin sello: /boletos/sellado explica el mecanismo sin cifras ni descargas', { skip: !hayBD }, async () => {
  const r = await pedir('/boletos/sellado');
  assert.equal(r.texto.includes('deposita ante notario público'), true);
  assert.equal(r.texto.includes('Descargar'), false);
  assert.equal(/\b\d+\s+boletos/.test(r.texto), false, 'sin cifras');
  const csv = await pedir('/boletos/sellado/padron-sf27.csv');
  assert.equal(csv.status, 404, 'el CSV no existe para el público');
});

test('el acta del simulacro asienta el depósito notarial (capturado o en blanco)', { skip: !hayBD }, async () => {
  const conDatos = await sellado.ejecutarSellado('simulacro', 'prueba',
    { notario: 'Lic. Notario DePrueba', actaNotarial: '123/2027' });
  const archivos = await sellado.archivosDeSello(conDatos.id);
  const texto = textoPlanoDePDF(archivos.acta);
  assert.equal(texto.includes('DePrueba'), true, 'nombre del notario en el acta');
  assert.equal(texto.includes('123/2027'), true, 'número de acta');

  const sinDatos = await sellado.ejecutarSellado('simulacro', 'prueba');
  const texto2 = textoPlanoDePDF((await sellado.archivosDeSello(sinDatos.id)).acta);
  assert.equal(texto2.includes('Notario'), true, 'el renglón se asienta siempre');
  assert.equal(texto2.includes('______'), true, 'en blanco para llenarse a mano');
  assert.equal(conDatos.sha256, sinDatos.sha256, 'los datos notariales no alteran el CSV');
});

test('tras el sellado real: hash público en grande, sin descargas ni totales', { skip: !hayBD }, async () => {
  await consultar(
    `INSERT INTO sellos (tipo, es_real, fecha_local, actor, sha256, total, resumen, csv, acta, notario, acta_notarial)
     VALUES ('real', 1, '2027-12-16 12:30', 'prueba', 'abc123def456', 7, '{}', 'contenido-csv', 'pdf', 'Lic. Notario Falso', '99/2027')`);
  sellado._limpiarCacheSelloReal();

  const r = await pedir('/boletos/sellado');
  assert.equal(r.texto.includes('abc123def456'), true, 'el hash es público');
  assert.equal(r.texto.includes('depositado'), true, 'leyenda del depósito');
  assert.equal(r.texto.includes('notaría'), true, 'invitación a verificar en la notaría');
  assert.equal(r.texto.includes('Descargar'), false, 'sin descargas públicas');
  assert.equal(r.texto.includes('7 boletos'), false, 'sin el total');
  assert.equal(r.texto.includes('Notario Falso'), false, 'sin datos internos en la página pública');

  const csv = await pedir('/boletos/sellado/padron-sf27.csv');
  assert.equal(csv.status, 404);
  const acta = await pedir('/boletos/sellado/acta-sf27.pdf');
  assert.equal(acta.status, 404);
});

test('con sesión del panel: contador, lista y descargas siguen disponibles', { skip: !hayBD }, async () => {
  const acceso = await pedir('/admin/acceso', {
    metodo: 'POST',
    cuerpo: { correo: process.env.ADMIN_USUARIO, contrasena: process.env.ADMIN_PASSWORD },
  });
  cookieAdmin = acceso.cookie;
  assert.equal(Boolean(cookieAdmin), true);

  const boletos = await pedir('/boletos', { cookie: cookieAdmin });
  assert.equal(boletos.texto.includes('boletos participando'), true, 'contador para operación');
  assert.equal(boletos.texto.includes('Lista completa'), true, 'lista para operación');

  const sello = await pedir('/boletos/sellado', { cookie: cookieAdmin });
  assert.equal(sello.texto.includes('Descargar padrón (CSV)'), true);
  assert.equal(sello.texto.includes('7 boletos'), true, 'el total sí, con sesión');
  assert.equal(sello.texto.includes('Notario Falso'), true, 'depósito visible para el panel');

  const csv = await pedir('/boletos/sellado/padron-sf27.csv', { cookie: cookieAdmin });
  assert.equal(csv.status, 200);
  assert.equal(csv.texto, 'contenido-csv');

  await consultar('DELETE FROM sellos');
  sellado._limpiarCacheSelloReal();
});

test('modo exhibición: la familia sin sesión ve el buscador, no la lista', { skip: !hayBD }, async () => {
  await consultar("UPDATE configuracion SET valor = '' WHERE clave = 'numero_permiso'");
  await consultar("UPDATE configuracion SET valor = 'true' WHERE clave = 'modo_exhibicion'");

  const r = await pedir('/boletos');
  assert.equal(r.texto.includes('MODO PRUEBAS — SIN VALIDEZ'), true);
  assert.equal(r.texto.includes('Busca tu boleto'), true);
  assert.equal(r.texto.includes('Lista completa'), false);
  assert.equal(r.texto.includes('boletos participando'), false);

  await consultar("UPDATE configuracion SET valor = 'false' WHERE clave = 'modo_exhibicion'");
  await consultar("UPDATE configuracion SET valor = '20270001PS07' WHERE clave = 'numero_permiso'");
});
