// Pruebas de la ORDEN 6: usuarios individuales, roles, transición desde la
// credencial de entorno, contraseña temporal y bloqueo por intentos.
// Corren contra el servidor Express real en un puerto efímero.

process.env.ADMIN_USUARIO = process.env.ADMIN_USUARIO || 'provisional';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'clave-entorno-larga';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const { app } = require('../server');

const hayBD = configurada();
let servidor;
let base;

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

async function entrar(correo, contrasena) {
  return pedir('/admin/acceso', { metodo: 'POST', cuerpo: { correo, contrasena } });
}

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['usuarios', 'bitacora_boletos']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  servidor = app.listen(0);
  await new Promise((resolver) => servidor.on('listening', resolver));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) servidor.close();
  if (hayBD) await obtenerPool().end();
});

let cookieEntorno;
let cookieAdmin;
let cookieOperador;

test('sin usuarios: la pantalla de acceso anuncia el acceso provisional y el entorno entra', { skip: !hayBD }, async () => {
  const acceso = await pedir('/admin/acceso');
  assert.equal(acceso.texto.includes('credencial provisional'), true);

  const sinSesion = await pedir('/admin');
  assert.equal(sinSesion.status, 302);
  assert.equal(sinSesion.destino, '/admin/acceso');

  const login = await entrar('provisional', 'clave-entorno-larga');
  assert.equal(login.status, 302);
  assert.equal(login.destino, '/admin');
  cookieEntorno = login.cookie;

  const panel = await pedir('/admin', { cookie: cookieEntorno });
  assert.equal(panel.status, 200);
  const gestion = await pedir('/admin/usuarios', { cookie: cookieEntorno });
  assert.equal(gestion.status, 200, 'el provisional es administrador y puede crear usuarios');
});

test('alta del primer administrador deshabilita el acceso de entorno', { skip: !hayBD }, async () => {
  const alta = await pedir('/admin/usuarios/alta', {
    metodo: 'POST', cookie: cookieEntorno,
    cuerpo: { correo: 'eduardo@ferez.mx', nombre: 'Eduardo Loewen', rol: 'administrador', contrasena: 'Temporal-2027' },
  });
  assert.equal(alta.texto.includes('creado'), true);

  const entorno = await entrar('provisional', 'clave-entorno-larga');
  assert.equal(entorno.texto.includes('deshabilitado'), true, 'el login de entorno queda rechazado');

  const cookieVieja = await pedir('/admin', { cookie: cookieEntorno });
  assert.equal(cookieVieja.status, 302, 'la sesión provisional muere al existir un administrador');

  const acceso = await pedir('/admin/acceso');
  assert.equal(acceso.texto.includes('está deshabilitado'), true, 'la pantalla de acceso lo indica');
});

test('contraseña temporal: fuerza el cambio y aplica la política de 10 caracteres', { skip: !hayBD }, async () => {
  const login = await entrar('eduardo@ferez.mx', 'Temporal-2027');
  assert.equal(login.destino, '/admin/cambiar-contrasena');
  cookieAdmin = login.cookie;

  const bloqueado = await pedir('/admin/boletos', { cookie: cookieAdmin });
  assert.equal(bloqueado.destino, '/admin/cambiar-contrasena', 'ninguna pantalla antes del cambio');

  const corta = await pedir('/admin/cambiar-contrasena', {
    metodo: 'POST', cookie: cookieAdmin,
    cuerpo: { actual: 'Temporal-2027', nueva: 'corta' },
  });
  assert.equal(corta.texto.includes('al menos 10 caracteres'), true);

  const cambio = await pedir('/admin/cambiar-contrasena', {
    metodo: 'POST', cookie: cookieAdmin,
    cuerpo: { actual: 'Temporal-2027', nueva: 'MiClaveDefinitiva-1' },
  });
  assert.equal(cambio.destino, '/admin');
  const panel = await pedir('/admin', { cookie: cookieAdmin });
  assert.equal(panel.status, 200);
});

test('operador: sin parámetros, sin sellado, sin usuarios; lo suyo sí', { skip: !hayBD }, async () => {
  await pedir('/admin/usuarios/alta', {
    metodo: 'POST', cookie: cookieAdmin,
    cuerpo: { correo: 'gerente@ferez.mx', nombre: 'Gerente Estación', rol: 'operador', contrasena: 'Temporal-Ger1' },
  });
  const primerAcceso = await entrar('gerente@ferez.mx', 'Temporal-Ger1');
  await pedir('/admin/cambiar-contrasena', {
    metodo: 'POST', cookie: primerAcceso.cookie,
    cuerpo: { actual: 'Temporal-Ger1', nueva: 'ClaveGerente-27' },
  });
  const login = await entrar('gerente@ferez.mx', 'ClaveGerente-27');
  assert.equal(login.destino, '/admin');
  cookieOperador = login.cookie;

  for (const ruta of ['/admin/parametros', '/admin/sellado', '/admin/usuarios', '/admin/sellado/descarga?id=1&archivo=csv']) {
    const r = await pedir(ruta, { cookie: cookieOperador });
    assert.equal(r.status, 403, `${ruta} debe dar 403 al operador`);
  }
  for (const ruta of ['/admin', '/admin/boletos', '/admin/captura', '/admin/whatsapp', '/admin/bitacora']) {
    const r = await pedir(ruta, { cookie: cookieOperador });
    assert.equal(r.status, 200, `${ruta} debe abrir para el operador`);
  }
});

test('bloqueo tras 10 intentos fallidos, con bitácora, y expira', { skip: !hayBD }, async () => {
  let ultima;
  for (let i = 0; i < 10; i++) {
    ultima = await entrar('gerente@ferez.mx', 'clave-equivocada');
  }
  assert.equal(ultima.texto.includes('bloqueado'), true);

  const [registro] = await consultar(
    "SELECT resultado FROM bitacora_boletos WHERE tipo = 'acceso' AND actor = 'gerente@ferez.mx' ORDER BY id DESC LIMIT 1");
  assert.equal(registro.resultado, 'BLOQUEO');

  const conBuena = await entrar('gerente@ferez.mx', 'ClaveGerente-27');
  assert.equal(conBuena.texto.includes('bloqueado'), true, 'ni con la contraseña correcta durante el bloqueo');

  await consultar("UPDATE usuarios SET bloqueado_hasta = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE correo = 'gerente@ferez.mx'");
  const trasExpirar = await entrar('gerente@ferez.mx', 'ClaveGerente-27');
  assert.equal(trasExpirar.destino, '/admin', 'el bloqueo expira a los 15 minutos');
});

test('usuario desactivado no entra y su sesión muere', { skip: !hayBD }, async () => {
  const [gerente] = await consultar("SELECT id FROM usuarios WHERE correo = 'gerente@ferez.mx'");
  await pedir('/admin/usuarios/estado', {
    metodo: 'POST', cookie: cookieAdmin,
    cuerpo: { usuario_id: String(gerente.id), activo: '0' },
  });
  const login = await entrar('gerente@ferez.mx', 'ClaveGerente-27');
  assert.equal(login.texto.includes('desactivado'), true);
  const sesionVieja = await pedir('/admin/boletos', { cookie: cookieOperador });
  assert.equal(sesionVieja.status, 302, 'la sesión del desactivado deja de servir');
});

test('bitácora: parámetros y gestión de usuarios registran quién lo hizo', { skip: !hayBD }, async () => {
  await pedir('/admin/parametros', {
    metodo: 'POST', cookie: cookieAdmin,
    cuerpo: { clave: 'dias_para_reclamar', valor: '7' },
  });
  const [parametro] = await consultar(
    "SELECT actor FROM bitacora_boletos WHERE tipo = 'ajuste' AND resultado = 'PARAMETRO' ORDER BY id DESC LIMIT 1");
  assert.equal(parametro.actor, 'eduardo@ferez.mx');
  const [alta] = await consultar(
    "SELECT actor FROM bitacora_boletos WHERE resultado = 'ALTA_USUARIO' ORDER BY id LIMIT 1");
  assert.equal(alta.actor, `entorno:${process.env.ADMIN_USUARIO}`);
});
