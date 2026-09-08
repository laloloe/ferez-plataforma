// Pruebas de la ORDEN 9: modo pruebas público (sin permiso de SEGOB nada
// del sorteo se ve; una sesión del panel sí, con franja) y reinicio de
// arranque. Corren contra el servidor Express real en un puerto efímero.

process.env.ADMIN_USUARIO = process.env.ADMIN_USUARIO || 'provisional';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'clave-entorno-larga';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const motor = require('../servicios/motor-boletos');
const sellado = require('../servicios/sellado');
const usuarios = require('../servicios/usuarios');
const { app } = require('../server');

const hayBD = configurada();
let servidor;
let base;
let cookieAdmin;
let estacionId;

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
    destino: respuesta.headers.get('location'),
    cookie: galletas.length ? galletas[0].split(';')[0] : null,
    texto: await respuesta.text(),
  };
}

async function sembrarVenta(folio) {
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, litros, importe, origen)
     VALUES (?, ?, NOW(), 'Magna', 40, 1400, 'manual')`, [estacionId, folio]);
}

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['sellos', 'boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes', 'mensajes_whatsapp', 'estado_bot', 'usuarios']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  await consultar("UPDATE configuracion SET valor = '' WHERE clave = 'numero_permiso'");
  const [estacion] = await consultar("SELECT id FROM estaciones WHERE nombre = 'Rubio'");
  estacionId = estacion.id;

  servidor = app.listen(0);
  await new Promise((resolver) => servidor.on('listening', resolver));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) servidor.close();
  if (hayBD) await obtenerPool().end();
});

test('sin permiso y sin sesión: /boletos y /boletos/sellado muestran Próximamente', { skip: !hayBD }, async () => {
  for (const ruta of ['/boletos', '/boletos/sellado']) {
    const r = await pedir(ruta);
    assert.equal(r.status, 200);
    assert.equal(r.texto.includes('Próximamente'), true, `${ruta} en Próximamente`);
    assert.equal(r.texto.includes('Busca tu boleto'), false, 'sin buscador');
    assert.equal(r.texto.includes('boletos participando'), false, 'sin contador');
    assert.equal(r.texto.includes('MODO PRUEBAS'), false, 'la franja es solo para el panel');
  }
});

test('sin permiso: la landing no tiene ligas al sorteo; /registro lleva la franja', { skip: !hayBD }, async () => {
  const landing = await pedir('/');
  assert.equal(landing.texto.includes('/boletos'), false, 'sin ligas al sorteo');
  assert.equal(landing.texto.includes('Consultar mis boletos'), false);
  assert.equal(landing.texto.includes('Consultar mis puntos'), true, 'el resto de la landing sigue');

  const directa = await pedir('/index.html');
  assert.equal(directa.texto.includes('/boletos'), false, '/index.html pasa por el mismo filtro');

  const registro = await pedir('/registro');
  assert.equal(registro.status, 200);
  assert.equal(registro.texto.includes('MODO PRUEBAS'), true);

  const constancia = await pedir('/constancia');
  assert.equal(constancia.status, 200, '/constancia sigue igual que antes');
  assert.equal(constancia.texto.includes('Número de boleto'), true);
});

test('con sesión del panel: páginas completas con franja MODO PRUEBAS', { skip: !hayBD }, async () => {
  const acceso = await pedir('/admin/acceso', {
    metodo: 'POST',
    cuerpo: { correo: process.env.ADMIN_USUARIO, contrasena: process.env.ADMIN_PASSWORD },
  });
  cookieAdmin = acceso.cookie;
  assert.equal(Boolean(cookieAdmin), true, 'entró con la credencial provisional');

  const r = await pedir('/boletos', { cookie: cookieAdmin });
  assert.equal(r.texto.includes('Busca tu boleto'), true, 'página completa');
  assert.equal(r.texto.includes('MODO PRUEBAS'), true, 'con franja');
  const s = await pedir('/boletos/sellado', { cookie: cookieAdmin });
  assert.equal(s.texto.includes('Próximamente'), false);
  assert.equal(s.texto.includes('MODO PRUEBAS'), true);
});

test('con numero_permiso llena: todo público, sin franjas; el reinicio desaparece', { skip: !hayBD }, async () => {
  await consultar("UPDATE configuracion SET valor = '20270001PS07' WHERE clave = 'numero_permiso'");

  const boletos = await pedir('/boletos');
  assert.equal(boletos.texto.includes('Busca tu boleto'), true, 'público completo');
  assert.equal(boletos.texto.includes('MODO PRUEBAS'), false);
  const landing = await pedir('/');
  assert.equal(landing.texto.includes('Consultar mis boletos'), true);
  const registro = await pedir('/registro');
  assert.equal(registro.texto.includes('MODO PRUEBAS'), false);

  // El botón de reinicio no aparece y el POST se rechaza.
  const inicio = await pedir('/admin', { cookie: cookieAdmin });
  assert.equal(inicio.texto.includes('REINICIAR'), false, 'sin botón con permiso lleno');
  const bloqueado = await pedir('/admin/reinicio', {
    metodo: 'POST', cookie: cookieAdmin, cuerpo: { confirmacion: 'REINICIAR' },
  });
  assert.equal(bloqueado.texto.includes('solo está disponible'), true, 'el POST también se bloquea');

  await consultar("UPDATE configuracion SET valor = '' WHERE clave = 'numero_permiso'");
});

test('reinicio de arranque: borra datos de prueba, deja bitácora y el siguiente boleto es SF27-000001', { skip: !hayBD }, async () => {
  // Datos de prueba: cliente, venta reclamada (avanza el contador) y simulacro.
  await consultar(
    `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
     VALUES ('+526250001111', 'Cliente Prueba Uno', 1, NOW())`);
  await sembrarVenta('REIN-1');
  const reclamo = await motor.reclamarFolio({
    telefono: '+526250001111', folio: 'REIN-1', estacionId, actor: 'prueba',
  });
  assert.equal(reclamo.ok, true);
  await sellado.ejecutarSellado('simulacro', 'prueba');

  const inicio = await pedir('/admin', { cookie: cookieAdmin });
  assert.equal(inicio.texto.includes('REINICIAR'), true, 'el botón aparece sin permiso ni sellado real');

  const mal = await pedir('/admin/reinicio', {
    metodo: 'POST', cookie: cookieAdmin, cuerpo: { confirmacion: 'BORRAR' },
  });
  assert.equal(mal.texto.includes('Confirmación incorrecta'), true);

  const r = await pedir('/admin/reinicio', {
    metodo: 'POST', cookie: cookieAdmin, cuerpo: { confirmacion: 'REINICIAR' },
  });
  assert.equal(r.texto.includes('Reinicio de arranque ejecutado'), true);

  for (const tabla of ['clientes', 'ventas', 'boletos', 'emisiones', 'mensajes_whatsapp', 'estado_bot', 'sellos']) {
    const [{ total }] = await consultar(`SELECT COUNT(*) AS total FROM ${tabla}`);
    assert.equal(Number(total), 0, `${tabla} en cero`);
  }
  const [{ total: negocio }] = await consultar(
    "SELECT COUNT(*) AS total FROM bitacora_boletos WHERE tipo IN ('reclamo','compra','anulacion','captura','sellado','constancia')");
  assert.equal(Number(negocio), 0, 'bitácora de negocio limpia');
  const [asiento] = await consultar(
    "SELECT actor, detalle FROM bitacora_boletos WHERE tipo = 'ajuste' AND resultado = 'REINICIO'");
  assert.equal(Boolean(asiento), true, 'asiento permanente del reinicio');
  assert.equal(asiento.detalle.includes('clientes=1'), true, 'el asiento dice cuánto se borró');

  // Configuración y estaciones intactas.
  const [{ total: estaciones }] = await consultar('SELECT COUNT(*) AS total FROM estaciones');
  assert.equal(Number(estaciones) >= 3, true);
  const [monto] = await consultar("SELECT valor FROM configuracion WHERE clave = 'monto_por_boleto'");
  assert.equal(monto.valor, '700');

  // Arranque limpio: el siguiente boleto es el SF27-000001.
  await consultar(
    `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
     VALUES ('+526250002222', 'Cliente Arranque Real', 1, NOW())`);
  await sembrarVenta('REAL-1');
  const primero = await motor.reclamarFolio({
    telefono: '+526250002222', folio: 'REAL-1', estacionId, actor: 'prueba',
  });
  assert.equal(primero.ok, true);
  assert.equal(primero.boletos[0], 'SF27-000001', 'la numeración arranca en 1');
});

test('el reinicio tampoco está disponible con sellado real', { skip: !hayBD }, async () => {
  // Simula un sellado real ya ejecutado (se limpia al final).
  await consultar(
    `INSERT INTO sellos (tipo, es_real, fecha_local, actor, sha256, total, resumen, csv, acta)
     VALUES ('real', 1, '2027-12-16 12:30', 'prueba', 'abc', 1, '{}', 'csv', 'pdf')`);
  sellado._limpiarCacheSelloReal();

  const inicio = await pedir('/admin', { cookie: cookieAdmin });
  assert.equal(inicio.texto.includes('REINICIAR'), false, 'sin botón con sellado real');
  const bloqueado = await pedir('/admin/reinicio', {
    metodo: 'POST', cookie: cookieAdmin, cuerpo: { confirmacion: 'REINICIAR' },
  });
  assert.equal(bloqueado.texto.includes('solo está disponible'), true);

  await consultar('DELETE FROM sellos');
  sellado._limpiarCacheSelloReal();
});
