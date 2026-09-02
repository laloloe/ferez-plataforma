// Usuarios individuales del panel /admin (ORDEN 6).
//
// Contraseñas con bcrypt (bcryptjs). Sesiones firmadas con HMAC en una
// cookie: el secreto sale de SESSION_SECRET o se deriva de las credenciales
// de entorno (y si no hay nada, es aleatorio por arranque). Bloqueo de 15
// minutos tras 10 intentos fallidos, con asiento en bitácora.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { consultar } = require('../lib/db');

const MIN_CONTRASENA = 10;
const MAX_INTENTOS = 10;
const MINUTOS_BLOQUEO = 15;
const HORAS_SESION = 12;
const RONDAS_BCRYPT = 10;

// ---------- Sesiones firmadas ----------

let secretoGenerado = null;

function secretoSesion() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.ADMIN_USUARIO || process.env.ADMIN_PASSWORD) {
    return crypto.createHash('sha256')
      .update(`sesion-ferez:${process.env.ADMIN_USUARIO ?? ''}:${process.env.ADMIN_PASSWORD ?? ''}`)
      .digest('hex');
  }
  if (!secretoGenerado) secretoGenerado = crypto.randomBytes(32).toString('hex');
  return secretoGenerado;
}

function firmarSesion(datos, horas = HORAS_SESION) {
  const carga = Buffer.from(JSON.stringify({ ...datos, exp: Date.now() + horas * 3600000 })).toString('base64url');
  const firma = crypto.createHmac('sha256', secretoSesion()).update(carga).digest('base64url');
  return `${carga}.${firma}`;
}

function verificarSesion(token) {
  if (!token || !token.includes('.')) return null;
  const [carga, firma] = token.split('.');
  const esperada = crypto.createHmac('sha256', secretoSesion()).update(carga).digest('base64url');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const datos = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
    if (!datos.exp || datos.exp < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

// ---------- Reglas ----------

function validarContrasena(contrasena) {
  if (typeof contrasena !== 'string' || contrasena.length < MIN_CONTRASENA) {
    return `La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres.`;
  }
  return null;
}

function validarCorreo(correo) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(correo ?? '').trim());
}

async function registrarAcceso(actor, resultado, detalle) {
  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, resultado, detalle) VALUES (?, 'acceso', ?, ?)`,
    [actor, resultado, detalle]);
}

async function registrarAjuste(actor, resultado, detalle) {
  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, resultado, detalle) VALUES (?, 'ajuste', ?, ?)`,
    [actor, resultado, detalle]);
}

// ---------- Gestión ----------

async function hayAdministradorActivo() {
  const [{ total }] = await consultar(
    "SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'administrador' AND activo = 1");
  return Number(total) > 0;
}

async function crearUsuario({ correo, nombre, contrasenaTemporal, rol, actor }) {
  const correoLimpio = String(correo ?? '').trim().toLowerCase();
  const nombreLimpio = String(nombre ?? '').trim();
  if (!validarCorreo(correoLimpio)) return { ok: false, mensaje: 'El correo no es válido.' };
  if (nombreLimpio.length < 2) return { ok: false, mensaje: 'Escribe el nombre completo.' };
  if (rol !== 'administrador' && rol !== 'operador') return { ok: false, mensaje: 'Rol no válido.' };
  const errorContrasena = validarContrasena(contrasenaTemporal);
  if (errorContrasena) return { ok: false, mensaje: errorContrasena };

  const hash = bcrypt.hashSync(contrasenaTemporal, RONDAS_BCRYPT);
  try {
    await consultar(
      `INSERT INTO usuarios (correo, nombre, hash_contrasena, rol, debe_cambiar) VALUES (?, ?, ?, ?, 1)`,
      [correoLimpio, nombreLimpio, hash, rol]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return { ok: false, mensaje: 'Ya existe un usuario con ese correo.' };
    throw err;
  }
  await registrarAjuste(actor, 'ALTA_USUARIO', `Usuario ${correoLimpio} creado con rol ${rol} (contraseña temporal).`);
  return { ok: true, correo: correoLimpio };
}

// Autentica contra la tabla. Maneja bloqueo por intentos.
async function autenticar(correo, contrasena) {
  const correoLimpio = String(correo ?? '').trim().toLowerCase();
  const [usuario] = await consultar('SELECT * FROM usuarios WHERE correo = ?', [correoLimpio]);
  if (!usuario) return { ok: false, motivo: 'credenciales' };
  if (!usuario.activo) return { ok: false, motivo: 'inactivo' };
  if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta).getTime() > Date.now()) {
    return { ok: false, motivo: 'bloqueado' };
  }

  if (bcrypt.compareSync(String(contrasena ?? ''), usuario.hash_contrasena)) {
    await consultar(
      'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, fecha_ultimo_acceso = NOW() WHERE id = ?',
      [usuario.id]);
    return { ok: true, usuario };
  }

  const intentos = usuario.intentos_fallidos + 1;
  if (intentos >= MAX_INTENTOS) {
    await consultar(
      `UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = DATE_ADD(NOW(), INTERVAL ${MINUTOS_BLOQUEO} MINUTE) WHERE id = ?`,
      [usuario.id]);
    await registrarAcceso(usuario.correo, 'BLOQUEO',
      `${MAX_INTENTOS} intentos fallidos: acceso bloqueado ${MINUTOS_BLOQUEO} minutos.`);
    return { ok: false, motivo: 'bloqueado' };
  }
  await consultar('UPDATE usuarios SET intentos_fallidos = ? WHERE id = ?', [intentos, usuario.id]);
  return { ok: false, motivo: 'credenciales' };
}

async function cambiarContrasena({ usuarioId, actual, nueva }) {
  const [usuario] = await consultar('SELECT * FROM usuarios WHERE id = ? AND activo = 1', [usuarioId]);
  if (!usuario) return { ok: false, mensaje: 'Usuario no encontrado.' };
  if (!bcrypt.compareSync(String(actual ?? ''), usuario.hash_contrasena)) {
    return { ok: false, mensaje: 'La contraseña actual no es correcta.' };
  }
  const error = validarContrasena(nueva);
  if (error) return { ok: false, mensaje: error };
  if (nueva === actual) return { ok: false, mensaje: 'La contraseña nueva debe ser distinta de la actual.' };
  await consultar('UPDATE usuarios SET hash_contrasena = ?, debe_cambiar = 0 WHERE id = ?',
    [bcrypt.hashSync(nueva, RONDAS_BCRYPT), usuarioId]);
  await registrarAjuste(usuario.correo, 'CAMBIO_CONTRASENA', 'El usuario cambió su contraseña.');
  return { ok: true };
}

async function cambiarEstado({ usuarioId, activo, actor }) {
  const [usuario] = await consultar('SELECT correo FROM usuarios WHERE id = ?', [usuarioId]);
  if (!usuario) return { ok: false, mensaje: 'Usuario no encontrado.' };
  await consultar('UPDATE usuarios SET activo = ? WHERE id = ?', [activo ? 1 : 0, usuarioId]);
  await registrarAjuste(actor, activo ? 'USUARIO_ACTIVADO' : 'USUARIO_DESACTIVADO',
    `Usuario ${usuario.correo} ${activo ? 'reactivado' : 'desactivado'}.`);
  return { ok: true };
}

async function cambiarRol({ usuarioId, rol, actor }) {
  if (rol !== 'administrador' && rol !== 'operador') return { ok: false, mensaje: 'Rol no válido.' };
  const [usuario] = await consultar('SELECT correo FROM usuarios WHERE id = ?', [usuarioId]);
  if (!usuario) return { ok: false, mensaje: 'Usuario no encontrado.' };
  await consultar('UPDATE usuarios SET rol = ? WHERE id = ?', [rol, usuarioId]);
  await registrarAjuste(actor, 'CAMBIO_ROL', `Usuario ${usuario.correo} ahora es ${rol}.`);
  return { ok: true };
}

async function obtenerUsuarioActivo(id) {
  const [usuario] = await consultar(
    'SELECT id, correo, nombre, rol, activo, debe_cambiar FROM usuarios WHERE id = ? AND activo = 1', [id]);
  return usuario ?? null;
}

async function listarUsuarios() {
  return consultar(
    `SELECT id, correo, nombre, rol, activo, debe_cambiar, bloqueado_hasta, fecha_ultimo_acceso, fecha_creacion
     FROM usuarios ORDER BY fecha_creacion`);
}

module.exports = {
  MIN_CONTRASENA,
  MAX_INTENTOS,
  MINUTOS_BLOQUEO,
  firmarSesion,
  verificarSesion,
  validarContrasena,
  hayAdministradorActivo,
  crearUsuario,
  autenticar,
  cambiarContrasena,
  cambiarEstado,
  cambiarRol,
  obtenerUsuarioActivo,
  listarUsuarios,
  registrarAjuste,
};
