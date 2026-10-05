// Restablecimiento de contraseña por correo (autoservicio, opción B).
//
// Flujo: el usuario pide la liga desde la pantalla de acceso → se genera un
// token de UN solo uso con vigencia de 30 minutos (en BD solo vive su
// SHA-256) → se envía la liga por correo → al abrirla define su nueva
// contraseña. La respuesta de la solicitud es SIEMPRE genérica: no revela
// si el correo existe. Límite de 3 solicitudes por hora por correo/IP.
//
// Correo saliente (SMTP): variables SMTP_HOST / SMTP_USER / SMTP_PASSWORD
// (+ SMTP_PORT opcional, default 465). Si no están y el buzón de
// importación es Gmail, se reutiliza: la contraseña de aplicación de
// IMPORT_MAIL_* sirve igual para smtp.gmail.com. Sin nada de esto, la
// función queda apagada y la pantalla de acceso no muestra la liga.
// Ni tokens ni contraseñas tocan logs o bitácora.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { consultar } = require('../lib/db');
const usuarios = require('./usuarios');

const MINUTOS_VIGENCIA = 30;
const LIMITE_SOLICITUDES_HORA = 3;

function servidorSMTP() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
    return {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    };
  }
  if (process.env.IMPORT_MAIL_HOST === 'imap.gmail.com' &&
      process.env.IMPORT_MAIL_USER && process.env.IMPORT_MAIL_PASSWORD) {
    return {
      host: 'smtp.gmail.com',
      port: 465,
      user: process.env.IMPORT_MAIL_USER,
      pass: process.env.IMPORT_MAIL_PASSWORD,
    };
  }
  return null;
}

function configurado() {
  return Boolean(servidorSMTP());
}

function urlSitio() {
  return (process.env.SITIO_URL || 'https://ferez.mx').replace(/\/$/, '');
}

async function enviarSMTP(destino, asunto, texto) {
  const nodemailer = require('nodemailer');
  const smtp = servidorSMTP();
  const transporte = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    logger: false,
  });
  await transporte.sendMail({ from: smtp.user, to: destino, subject: asunto, text: texto });
}

// Inyectable en pruebas (y recuperable).
let enviador = enviarSMTP;
function _fijarEnviador(fn) {
  enviador = fn ?? enviarSMTP;
}

function hashDeToken(token) {
  return crypto.createHash('sha256').update(String(token ?? '')).digest('hex');
}

async function asentar(resultado, detalle) {
  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, resultado, detalle)
     VALUES ('publico:restablecer', 'acceso', ?, ?)`,
    [resultado, String(detalle).slice(0, 400)]);
}

// Solicitud de liga. SIEMPRE devuelve { ok: true } (respuesta genérica),
// salvo cuando el servicio está apagado por falta de SMTP.
async function solicitar({ correo, ip }) {
  if (!configurado() && enviador === enviarSMTP) {
    return { ok: false, codigo: 'NO_CONFIGURADO' };
  }
  const correoLimpio = String(correo ?? '').trim().toLowerCase();
  const ipTexto = String(ip ?? 'desconocida');

  // Límite silencioso: tres solicitudes por hora por correo o por IP.
  const [{ total }] = await consultar(
    `SELECT COUNT(*) AS total FROM bitacora_boletos
     WHERE tipo = 'acceso' AND resultado = 'RESTABLECIMIENTO_SOLICITADO'
       AND fecha > DATE_SUB(NOW(), INTERVAL 1 HOUR)
       AND (detalle LIKE ? OR detalle LIKE ?)`,
    [`% ${correoLimpio}`, `%[IP ${ipTexto}]%`]);
  await asentar('RESTABLECIMIENTO_SOLICITADO', `[IP ${ipTexto}] ${correoLimpio}`);
  if (Number(total) >= LIMITE_SOLICITUDES_HORA) return { ok: true };

  const [usuario] = await consultar(
    'SELECT id, correo, nombre FROM usuarios WHERE correo = ? AND activo = 1', [correoLimpio]);
  if (!usuario) return { ok: true }; // sin revelar nada

  const token = crypto.randomBytes(32).toString('hex');
  await consultar('DELETE FROM restablecimientos WHERE usuario_id = ?', [usuario.id]);
  await consultar(
    `INSERT INTO restablecimientos (usuario_id, token_hash, expira)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${MINUTOS_VIGENCIA} MINUTE))`,
    [usuario.id, hashDeToken(token)]);

  const liga = `${urlSitio()}/admin/restablecer?token=${token}`;
  await enviador(usuario.correo, 'Restablecer contraseña — Panel Ferez',
    `Hola ${usuario.nombre}:\n\n` +
    `Alguien (ojalá tú) pidió restablecer la contraseña de tu usuario del Panel Ferez.\n\n` +
    `Abre esta liga para definir una nueva contraseña (vence en ${MINUTOS_VIGENCIA} minutos y sirve una sola vez):\n\n` +
    `${liga}\n\n` +
    `Si tú no lo pediste, ignora este correo: tu contraseña actual sigue siendo válida.\n\n` +
    `Panel Ferez — ferez.mx`);
  return { ok: true };
}

// Canjea el token por una contraseña nueva. También limpia bloqueos.
async function restablecer({ token, nueva }) {
  const [fila] = await consultar(
    `SELECT r.id, r.usuario_id, u.correo FROM restablecimientos r
     JOIN usuarios u ON u.id = r.usuario_id
     WHERE r.token_hash = ? AND r.usado = 0 AND r.expira > NOW() AND u.activo = 1`,
    [hashDeToken(token)]);
  if (!fila) {
    await asentar('RESTABLECIMIENTO_RECHAZADO', 'Liga inválida, vencida o ya usada.');
    return { ok: false, mensaje: 'La liga no es válida, ya venció o ya se usó. Solicita una nueva desde "Olvidé mi contraseña".' };
  }
  const error = usuarios.validarContrasena(nueva);
  if (error) return { ok: false, mensaje: error };

  await consultar(
    `UPDATE usuarios SET hash_contrasena = ?, debe_cambiar = 0, intentos_fallidos = 0, bloqueado_hasta = NULL
     WHERE id = ?`,
    [bcrypt.hashSync(String(nueva), 10), fila.usuario_id]);
  await consultar('UPDATE restablecimientos SET usado = 1 WHERE id = ?', [fila.id]);
  await asentar('RESTABLECIMIENTO_OK', `Contraseña restablecida para ${fila.correo}.`);
  return { ok: true, correo: fila.correo };
}

module.exports = {
  MINUTOS_VIGENCIA,
  LIMITE_SOLICITUDES_HORA,
  configurado,
  solicitar,
  restablecer,
  _fijarEnviador,
};
