// Pruebas del bot de WhatsApp: verificación, firma, idempotencia, ramas del
// flujo y límite por hora. Las de flujo requieren base de datos configurada.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const bot = require('../servicios/bot-whatsapp');

const hayBD = configurada();

// ---------- Unitarias (sin BD) ----------

test('verificación GET: token correcto responde el challenge; incorrecto 403', () => {
  const ok = bot.verificarSuscripcion(
    { 'hub.mode': 'subscribe', 'hub.verify_token': 'secreto-verif', 'hub.challenge': '12345' }, 'secreto-verif');
  assert.deepEqual(ok, { estado: 200, cuerpo: '12345' });
  assert.equal(bot.verificarSuscripcion(
    { 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': 'x' }, 'secreto-verif').estado, 403);
  assert.equal(bot.verificarSuscripcion({}, 'secreto-verif').estado, 403);
  assert.equal(bot.verificarSuscripcion({ 'hub.mode': 'subscribe', 'hub.verify_token': '' }, '').estado, 403);
});

test('firma X-Hub-Signature-256: válida pasa, inválida o ausente no', () => {
  const secreto = 'app-secret-de-prueba';
  const cuerpo = Buffer.from(JSON.stringify({ hola: 'mundo' }));
  const firma = 'sha256=' + crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex');
  assert.equal(bot.validarFirma(cuerpo, firma, secreto), true);
  assert.equal(bot.validarFirma(cuerpo, firma.replace('sha256=', 'sha256=0'), secreto), false);
  assert.equal(bot.validarFirma(cuerpo, undefined, secreto), false);
  assert.equal(bot.validarFirma(cuerpo, firma, 'otro-secreto'), false);
  assert.equal(bot.validarFirma(Buffer.from('otro cuerpo'), firma, secreto), false);
});

test('clasificación: saludos y textos sin folio piden ayuda; folios se detectan', () => {
  assert.equal(bot.clasificarTexto('hola').tipo, 'ayuda');
  assert.equal(bot.clasificarTexto('AYUDA').tipo, 'ayuda');
  assert.equal(bot.clasificarTexto('boletos').tipo, 'ayuda');
  assert.equal(bot.clasificarTexto('quiero participar en el sorteo').tipo, 'ayuda');
  assert.equal(bot.clasificarTexto('').tipo, 'ayuda');
  assert.deepEqual(bot.clasificarTexto('A-1023'), { tipo: 'folio', folio: 'A-1023' });
  assert.deepEqual(bot.clasificarTexto(' 74 552 '), { tipo: 'folio', folio: '74552' });
  assert.deepEqual(bot.clasificarTexto('t 100'), { tipo: 'folio', folio: 't100' });
});

test('el token jamás aparece en los errores de envío', async (t) => {
  const anteriores = { ...process.env };
  process.env.WHATSAPP_TOKEN = 'TOKEN-ULTRA-SECRETO-XYZ';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456';
  process.env.WHATSAPP_VERIFY_TOKEN = 'verif';
  process.env.WHATSAPP_APP_SECRET = 'SECRETO-APP-ABC';
  const fetchOriginal = global.fetch;
  global.fetch = async () => { throw new Error('fallo de red simulado'); };
  t.after(() => {
    global.fetch = fetchOriginal;
    Object.assign(process.env, anteriores);
  });
  const { enviarTexto } = require('../servicios/whatsapp-api');
  const resultado = await enviarTexto('+526251234567', 'hola');
  assert.equal(resultado.ok, false);
  assert.equal(resultado.error.includes('TOKEN-ULTRA-SECRETO-XYZ'), false);
  assert.equal(resultado.error.includes('SECRETO-APP-ABC'), false);
});

// ---------- De flujo (con BD) ----------

const REGISTRADO = '+526253334455';
const NO_REGISTRADO = '5216259990000'; // formato viejo de WhatsApp
let estacionId;
let contadorMensajes = 0;

function cargaUtil(de, texto, id, tipo = 'text') {
  return {
    entry: [{ changes: [{ value: { messages: [{
      id, from: de, type: tipo,
      ...(tipo === 'text' ? { text: { body: texto } } : {}),
    }] } }] }],
  };
}

function enviadorFalso(registro) {
  return async (telefono, texto) => {
    registro.push({ telefono, texto });
    return { ok: true, id: `wamid.salida.${++contadorMensajes}` };
  };
}

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes', 'mensajes_whatsapp']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  const [estacion] = await consultar("SELECT id FROM estaciones WHERE nombre = 'Rubio'");
  estacionId = estacion.id;
  await consultar(
    `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
     VALUES (?, 'Cliente Bot López', 1, NOW())`, [REGISTRADO]);
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, litros, importe, origen)
     VALUES (?, 'BOT-1', NOW(), 'Magna', 40, 1400, 'manual')`, [estacionId]);
});

after(async () => {
  if (hayBD) await obtenerPool().end();
});

test('no registrado: invita a /registro y queda en bitácora', { skip: !hayBD }, async () => {
  const enviados = [];
  await bot.procesarWebhook(cargaUtil(NO_REGISTRADO, 'BOT-1', 'wamid.norel.1'), { enviar: enviadorFalso(enviados) });
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].telefono, '+526259990000');
  assert.equal(enviados[0].texto.includes('/registro'), true);
  const [registro] = await consultar(
    "SELECT resultado FROM bitacora_boletos WHERE telefono = '+526259990000' ORDER BY id DESC LIMIT 1");
  assert.equal(registro.resultado, 'CLIENTE_NO_REGISTRADO');
});

test('registrado con folio válido: boletos y liga al padrón; estación deducida', { skip: !hayBD }, async () => {
  const enviados = [];
  await bot.procesarWebhook(cargaUtil('526253334455', ' BOT - 1 ', 'wamid.exito.1'), { enviar: enviadorFalso(enviados) });
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].texto.includes('SF27-000001'), true);
  assert.equal(enviados[0].texto.includes('SF27-000002'), true);
  assert.equal(enviados[0].texto.includes('/boletos'), true);
});

test('idempotencia: el mismo wa_message_id no se procesa dos veces', { skip: !hayBD }, async () => {
  const enviados = [];
  const resultado = await bot.procesarWebhook(cargaUtil('526253334455', 'BOT-1', 'wamid.exito.1'), { enviar: enviadorFalso(enviados) });
  assert.equal(enviados.length, 0, 'no se envía nada en un duplicado');
  assert.equal(resultado[0].duplicado, true);
});

test('folio ya reclamado (mensaje nuevo): respuesta específica sin datos de terceros', { skip: !hayBD }, async () => {
  const enviados = [];
  await bot.procesarWebhook(cargaUtil('526253334455', 'BOT-1', 'wamid.repetido.2'), { enviar: enviadorFalso(enviados) });
  assert.equal(enviados[0].texto.includes('ya generó boleto'), true);
  assert.equal(enviados[0].texto.includes('López'), false);
});

test('ayuda y mensajes no de texto', { skip: !hayBD }, async () => {
  const enviados = [];
  await bot.procesarWebhook(cargaUtil('526253334455', 'hola', 'wamid.hola.1'), { enviar: enviadorFalso(enviados) });
  assert.equal(enviados[0].texto.includes('Regístrate una sola vez'), true);
  await bot.procesarWebhook(cargaUtil('526253334455', null, 'wamid.foto.1', 'image'), { enviar: enviadorFalso(enviados) });
  assert.equal(enviados[1].texto.includes('folio en texto'), true);
  const [fila] = await consultar("SELECT resultado FROM mensajes_whatsapp WHERE wa_message_id = 'wamid.hola.1'");
  assert.equal(fila.resultado, 'ayuda');
});

test('límite por hora: al undécimo reclamo responde que espere', { skip: !hayBD }, async () => {
  const telefono = '+526258887766';
  await consultar(
    `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
     VALUES (?, 'Cliente Insistente', 1, NOW())`, [telefono]);
  const enviados = [];
  for (let i = 1; i <= bot.LIMITE_RECLAMOS_HORA; i++) {
    await bot.procesarWebhook(cargaUtil('526258887766', `NADA-${i}`, `wamid.lim.${i}`), { enviar: enviadorFalso(enviados) });
  }
  await bot.procesarWebhook(cargaUtil('526258887766', 'NADA-11', 'wamid.lim.11'), { enviar: enviadorFalso(enviados) });
  const ultimo = enviados[enviados.length - 1];
  assert.equal(ultimo.texto, bot.TEXTOS.limite());
  const [registro] = await consultar(
    "SELECT COUNT(*) AS total FROM bitacora_boletos WHERE telefono = ? AND resultado = 'LIMITE_EXCEDIDO'", [telefono]);
  assert.equal(Number(registro.total), 1);
});

test('todo mensaje queda en mensajes_whatsapp con dirección y estado de envío', { skip: !hayBD }, async () => {
  const [salientes] = await consultar(
    "SELECT COUNT(*) AS total FROM mensajes_whatsapp WHERE direccion = 'saliente' AND estado_envio = 'enviado'");
  const [entrantes] = await consultar(
    "SELECT COUNT(*) AS total FROM mensajes_whatsapp WHERE direccion = 'entrante'");
  assert.equal(Number(salientes.total) > 0, true);
  assert.equal(Number(entrantes.total) >= Number(salientes.total), true);
});
