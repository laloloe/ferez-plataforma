// Pruebas de la opción B: "Olvidé mi contraseña" por correo. Token de un
// solo uso con 30 minutos de vigencia (solo su SHA-256 en BD), respuesta
// genérica sin enumeración de usuarios, límite de solicitudes y limpieza
// de bloqueos al restablecer. El envío de correo es inyectable.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const usuarios = require('../servicios/usuarios');
const restablecimiento = require('../servicios/restablecimiento');
const { app } = require('../server');

const hayBD = configurada();
let servidor;
let base;
const CORREO = 'carlos@ferez-prueba.mx';
const enviados = [];

async function pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    redirect: 'manual',
    headers: cuerpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
    body: cuerpo ? new URLSearchParams(cuerpo).toString() : undefined,
  });
  return { status: respuesta.status, texto: await respuesta.text() };
}

// El envío ahora corre en segundo plano tras responder: espera activa corta.
async function esperarA(condicion, ms = 2000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condicion()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return condicion();
}

async function solicitudesEnBitacora() {
  const [{ total }] = await consultar(
    "SELECT COUNT(*) AS total FROM bitacora_boletos WHERE resultado = 'RESTABLECIMIENTO_SOLICITADO'");
  return Number(total);
}

function ultimaLiga() {
  const correo = enviados[enviados.length - 1];
  const m = correo.texto.match(/\/admin\/restablecer\?token=([0-9a-f]{64})/);
  return m ? m[1] : null;
}

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['restablecimientos', 'usuarios', 'bitacora_boletos']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  // SMTP "configurado" para que la liga aparezca; el envío real se intercepta.
  process.env.SMTP_HOST = 'smtp.prueba';
  process.env.SMTP_USER = 'buzon@prueba';
  process.env.SMTP_PASSWORD = 'SECRETO-SMTP-XYZ';
  restablecimiento._fijarEnviador(async (destino, asunto, texto) => {
    enviados.push({ destino, asunto, texto });
  });
  await usuarios.crearUsuario({
    correo: CORREO, nombre: 'Carlos Solís', contrasenaTemporal: 'temporal-123', rol: 'operador', actor: 'prueba',
  });

  servidor = app.listen(0);
  await new Promise((resolver) => servidor.on('listening', resolver));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  restablecimiento._fijarEnviador(null);
  for (const clave of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']) delete process.env[clave];
  if (servidor) servidor.close();
  if (hayBD) await obtenerPool().end();
});

test('la pantalla de acceso muestra la liga cuando hay SMTP configurado', { skip: !hayBD }, async () => {
  const r = await pedir('/admin/acceso');
  assert.equal(r.texto.includes('Olvidé mi contraseña'), true);
  assert.equal(r.texto.includes('/admin/olvide-contrasena'), true);
});

test('solicitud con correo registrado: respuesta genérica INMEDIATA y liga por correo; solo el hash vive en BD', { skip: !hayBD }, async () => {
  const inicio = Date.now();
  const r = await pedir('/admin/olvide-contrasena', { metodo: 'POST', cuerpo: { correo: CORREO } });
  assert.equal(r.texto.includes('Si el correo está registrado'), true);
  assert.equal(Date.now() - inicio < 2000, true, 'la respuesta no espera al envío');
  assert.equal(await esperarA(() => enviados.length === 1), true, 'el correo sale en segundo plano');
  assert.equal(enviados[0].destino, CORREO);
  const token = ultimaLiga();
  assert.equal(Boolean(token), true, 'la liga trae el token');
  const [fila] = await consultar('SELECT token_hash, usado FROM restablecimientos');
  assert.equal(fila.usado, 0);
  assert.notEqual(fila.token_hash, token, 'en BD solo vive el hash, no el token');
});

test('correo inexistente: misma respuesta genérica y nada enviado', { skip: !hayBD }, async () => {
  const antes = enviados.length;
  const solicitudesAntes = await solicitudesEnBitacora();
  const r = await pedir('/admin/olvide-contrasena', { metodo: 'POST', cuerpo: { correo: 'nadie@nada.mx' } });
  assert.equal(r.texto.includes('Si el correo está registrado'), true, 'texto idéntico: sin enumeración');
  assert.equal(await esperarA(async () => (await solicitudesEnBitacora()) > solicitudesAntes), true,
    'la solicitud sí se procesó (bitácora)');
  assert.equal(enviados.length, antes, 'sin correo enviado');
});

test('la liga restablece: contraseña corta rechazada, confirmación distinta rechazada, válida entra y limpia bloqueos', { skip: !hayBD }, async () => {
  // Simula un bloqueo por intentos fallidos: el restablecimiento debe limpiarlo.
  await consultar(
    'UPDATE usuarios SET intentos_fallidos = 10, bloqueado_hasta = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE correo = ?',
    [CORREO]);
  const token = ultimaLiga();

  const formulario = await pedir(`/admin/restablecer?token=${token}`);
  assert.equal(formulario.texto.includes('Nueva contraseña'), true);

  const corta = await pedir('/admin/restablecer', { metodo: 'POST', cuerpo: { token, nueva: 'corta', confirmacion: 'corta' } });
  assert.equal(corta.texto.includes('msj error'), true, 'contraseña corta rechazada');

  const distinta = await pedir('/admin/restablecer', { metodo: 'POST', cuerpo: { token, nueva: 'contrasena-nueva-1', confirmacion: 'otra-cosa-123' } });
  assert.equal(distinta.texto.includes('no coinciden'), true);

  const buena = await pedir('/admin/restablecer', { metodo: 'POST', cuerpo: { token, nueva: 'contrasena-nueva-1', confirmacion: 'contrasena-nueva-1' } });
  assert.equal(buena.texto.includes('Contraseña actualizada'), true);

  const sesion = await usuarios.autenticar(CORREO, 'contrasena-nueva-1');
  assert.equal(sesion.ok, true, 'la nueva contraseña entra y el bloqueo quedó limpio');
  assert.equal(sesion.usuario.debe_cambiar, 0, 'no es temporal: no fuerza cambio');

  const [asiento] = await consultar(
    "SELECT detalle FROM bitacora_boletos WHERE resultado = 'RESTABLECIMIENTO_OK'");
  assert.equal(asiento.detalle.includes(CORREO), true);
});

test('el token es de un solo uso y el vencido se rechaza', { skip: !hayBD }, async () => {
  const usado = ultimaLiga();
  const reuso = await pedir('/admin/restablecer', { metodo: 'POST', cuerpo: { token: usado, nueva: 'contrasena-nueva-2', confirmacion: 'contrasena-nueva-2' } });
  assert.equal(reuso.texto.includes('ya se usó'), true, 'reutilizar la liga falla');

  // Nueva liga, vencida artificialmente.
  await pedir('/admin/olvide-contrasena', { metodo: 'POST', cuerpo: { correo: CORREO } });
  const vencido = ultimaLiga();
  await consultar("UPDATE restablecimientos SET expira = DATE_SUB(NOW(), INTERVAL 1 MINUTE)");
  const r = await pedir('/admin/restablecer', { metodo: 'POST', cuerpo: { token: vencido, nueva: 'contrasena-nueva-2', confirmacion: 'contrasena-nueva-2' } });
  assert.equal(r.texto.includes('ya venció') || r.texto.includes('no es válida'), true);
  assert.equal((await usuarios.autenticar(CORREO, 'contrasena-nueva-1')).ok, true, 'la contraseña no cambió');
});

test('límite: a la cuarta solicitud en una hora ya no se envía correo (respuesta igual)', { skip: !hayBD }, async () => {
  await consultar('DELETE FROM bitacora_boletos');
  const antes = enviados.length;
  for (let i = 1; i <= restablecimiento.LIMITE_SOLICITUDES_HORA + 1; i++) {
    const r = await pedir('/admin/olvide-contrasena', { metodo: 'POST', cuerpo: { correo: CORREO } });
    assert.equal(r.texto.includes('Si el correo está registrado'), true, `respuesta genérica en el intento ${i}`);
    assert.equal(await esperarA(async () => (await solicitudesEnBitacora()) === i), true, `solicitud ${i} procesada`);
  }
  assert.equal(enviados.length - antes, restablecimiento.LIMITE_SOLICITUDES_HORA, 'la cuarta ya no envió');
});

test('sin SMTP: la liga desaparece del acceso y el servicio responde apagado', { skip: !hayBD }, async () => {
  const guardadas = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD };
  delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASSWORD;
  restablecimiento._fijarEnviador(null); // enviador real: configurado() manda
  try {
    const acceso = await pedir('/admin/acceso');
    assert.equal(acceso.texto.includes('Olvidé mi contraseña'), false);
    const post = await pedir('/admin/olvide-contrasena', { metodo: 'POST', cuerpo: { correo: CORREO } });
    assert.equal(post.texto.includes('no está disponible'), true, 'el POST avisa sin colgarse');
    const r = await restablecimiento.solicitar({ correo: CORREO, ip: 'x' });
    assert.equal(r.ok, false);
    assert.equal(r.codigo, 'NO_CONFIGURADO');
  } finally {
    process.env.SMTP_HOST = guardadas.host;
    process.env.SMTP_USER = guardadas.user;
    process.env.SMTP_PASSWORD = guardadas.pass;
    restablecimiento._fijarEnviador(async (destino, asunto, texto) => { enviados.push({ destino, asunto, texto }); });
  }
});

test('si el envío falla, la respuesta sigue siendo genérica y el error queda en bitácora', { skip: !hayBD }, async () => {
  await consultar('DELETE FROM bitacora_boletos');
  restablecimiento._fijarEnviador(async () => { throw new Error('puerto SMTP bloqueado (simulado)'); });
  try {
    const inicio = Date.now();
    const r = await pedir('/admin/olvide-contrasena', { metodo: 'POST', cuerpo: { correo: CORREO } });
    assert.equal(r.texto.includes('Si el correo está registrado'), true);
    assert.equal(Date.now() - inicio < 2000, true, 'sin colgarse aunque el envío falle');
    const hayError = await esperarA(async () => {
      const [{ total }] = await consultar(
        "SELECT COUNT(*) AS total FROM bitacora_boletos WHERE resultado = 'RESTABLECIMIENTO_ERROR'");
      return Number(total) === 1;
    });
    assert.equal(hayError, true, 'el fallo de envío queda en bitácora para el administrador');
  } finally {
    restablecimiento._fijarEnviador(async (destino, asunto, texto) => { enviados.push({ destino, asunto, texto }); });
  }
});

test('ni la contraseña ni el token ni el secreto SMTP tocan la bitácora', { skip: !hayBD }, async () => {
  for (const texto of ['contrasena-nueva-1', 'SECRETO-SMTP-XYZ']) {
    const [{ total }] = await consultar(
      'SELECT COUNT(*) AS total FROM bitacora_boletos WHERE detalle LIKE ?', [`%${texto}%`]);
    assert.equal(Number(total), 0, `sin "${texto}" en bitácora`);
  }
  const [{ total }] = await consultar(
    "SELECT COUNT(*) AS total FROM bitacora_boletos b JOIN restablecimientos r ON b.detalle LIKE CONCAT('%', r.token_hash, '%')");
  assert.equal(Number(total), 0, 'ni siquiera el hash del token se asienta');
});
