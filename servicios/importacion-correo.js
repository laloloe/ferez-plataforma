// Importación automática por correo (ORDEN 10).
//
// La estación exporta su "Control de Despachos" diario y lo envía a un
// buzón IMAP dedicado. Este servicio lee los correos NO leídos, importa
// los adjuntos .xlsx con el importador de la ORDEN 7 y guarda el archivo
// original (con SHA-256 y reporte) para auditoría.
//
// Seguridad y robustez:
//   - Solo remitentes de la lista blanca (remitentes_autorizados); la
//     estación destino la decide esa lista, nunca el contenido del Excel.
//   - Idempotencia doble: Message-ID registrado (un correo jamás se
//     procesa dos veces) + el importador rechaza folios duplicados.
//   - A un remitente desconocido NUNCA se le responde nada.
//   - La contraseña del buzón jamás se escribe en logs ni en bitácora.
//   - Sin IMPORT_MAIL_HOST/USER/PASSWORD la función queda apagada.
//
// La conexión al buzón es inyectable (parámetro `conexion`) para poder
// probar todo el flujo sin un servidor IMAP real.

const crypto = require('crypto');
const { consultar, configurada } = require('../lib/db');
const { leerConfiguracion } = require('../lib/configuracion');
const { FuenteControlGAS } = require('../fuentes/fuente-controlgas');
const { importarVentas } = require('./importar-ventas');
const reglas = require('./reglas-boletos');
const fechas = require('../lib/fechas');

const TAMANO_MAXIMO_ADJUNTO = 10 * 1024 * 1024; // 10 MB

function configurado() {
  return Boolean(process.env.IMPORT_MAIL_HOST && process.env.IMPORT_MAIL_USER && process.env.IMPORT_MAIL_PASSWORD);
}

// ---------- Conexión IMAP real (inyectable en pruebas) ----------

async function conexionIMAP() {
  const { ImapFlow } = require('imapflow');
  const cliente = new ImapFlow({
    host: process.env.IMPORT_MAIL_HOST,
    port: Number(process.env.IMPORT_MAIL_PORT || 993),
    secure: true,
    auth: { user: process.env.IMPORT_MAIL_USER, pass: process.env.IMPORT_MAIL_PASSWORD },
    logger: false, // sin logs del cliente: que ninguna credencial se escape
  });
  await cliente.connect();
  await cliente.mailboxOpen('INBOX');
  return {
    async listarNoLeidos() {
      const uids = await cliente.search({ seen: false }, { uid: true });
      return (uids || []).map((uid) => ({ uid }));
    },
    async obtenerFuente(uid) {
      const { content } = await cliente.download(String(uid), undefined, { uid: true });
      const pedazos = [];
      for await (const pedazo of content) pedazos.push(pedazo);
      return Buffer.concat(pedazos);
    },
    async marcarLeido(uid) {
      await cliente.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    },
    async marcarParaRevision(uid) {
      await cliente.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true });
    },
    async cerrar() {
      try { await cliente.logout(); } catch { /* la desconexión no debe tronar */ }
    },
  };
}

// ---------- Bitácora y estado ----------

async function asentar({ resultado, estacionId = null, detalle }) {
  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, estacion_id, resultado, detalle)
     VALUES ('sistema:correo', 'correo', ?, ?, ?)`,
    [estacionId, resultado, String(detalle).slice(0, 400)]);
}

async function registrarCorreo({ messageId, remitente, resultado, detalle }) {
  await consultar(
    `INSERT IGNORE INTO correos_importados (message_id, remitente, resultado, detalle)
     VALUES (?, ?, ?, ?)`,
    [String(messageId).slice(0, 255), remitente, resultado, String(detalle ?? '').slice(0, 400)]);
}

async function correoYaProcesado(messageId) {
  const [fila] = await consultar(
    'SELECT id FROM correos_importados WHERE message_id = ?', [String(messageId).slice(0, 255)]);
  return Boolean(fila);
}

async function guardarUltimaRevision(detalle) {
  await consultar(
    'UPDATE importacion_correo_estado SET ultima_revision = NOW(), detalle = ? WHERE id = 1',
    [String(detalle).slice(0, 200)]);
}

// ---------- Procesamiento ----------

function esExcel(buffer) {
  return buffer && buffer.length > 1 && buffer[0] === 0x50 && buffer[1] === 0x4B;
}

// Importa un adjunto .xlsx a la estación dada. Devuelve el texto del reporte.
async function importarAdjunto({ adjunto, estacionId, remitente, messageId, config }) {
  const fuente = new FuenteControlGAS(adjunto.content, {
    productosParticipantes: config.productos_participantes ?? [],
    palabrasPagoExcluido: config.palabras_pago_excluido ?? ['vale'],
  });
  const { ventas, errores, omitidas, noParticipantes } = await fuente.obtenerVentas();
  if (!ventas.length && errores.length) {
    return { ok: false, reporte: `ilegible: ${errores[0]}` };
  }
  const { insertadas, duplicadas } = await importarVentas({
    estacionId, ventas, origen: 'controlgas', actor: 'sistema:correo',
  });
  const reporte = `${insertadas} aceptadas, ${duplicadas} duplicadas, ${omitidas} omitidas, ` +
    `${noParticipantes} no participantes, ${errores.length} filas con error`;
  await consultar(
    `INSERT INTO archivos_importados (estacion_id, remitente, nombre_archivo, sha256, tamano, contenido, reporte, message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [estacionId, remitente, String(adjunto.filename ?? 'sin-nombre.xlsx').slice(0, 255),
     crypto.createHash('sha256').update(adjunto.content).digest('hex'),
     adjunto.content.length, adjunto.content, reporte, String(messageId).slice(0, 255)]);
  return { ok: true, reporte };
}

async function procesarCorreo({ crudo, conexion, uid, config, remitentes }) {
  const { simpleParser } = require('mailparser');
  const mensaje = await simpleParser(crudo);
  const remitente = String(mensaje.from?.value?.[0]?.address ?? '').toLowerCase().trim();
  const messageId = mensaje.messageId || `sin-id:${crypto.createHash('sha256').update(crudo).digest('hex')}`;

  // Idempotencia: un Message-ID nunca se procesa dos veces.
  if (await correoYaProcesado(messageId)) {
    await conexion.marcarLeido(uid);
    return { estado: 'ya_procesado' };
  }

  const autorizado = remitentes.find((r) => r.correo === remitente);
  if (!autorizado) {
    await conexion.marcarLeido(uid);
    await registrarCorreo({ messageId, remitente, resultado: 'rechazado', detalle: 'Remitente fuera de la lista blanca.' });
    await asentar({ resultado: 'CORREO_RECHAZADO', detalle: `Remitente no autorizado: ${remitente || 'desconocido'} (sin respuesta).` });
    return { estado: 'rechazado' };
  }

  const reportes = [];
  let ignorados = 0;
  let huboError = false;
  for (const adjunto of mensaje.attachments ?? []) {
    const nombre = String(adjunto.filename ?? 'sin-nombre');
    if (!esExcel(adjunto.content) || adjunto.content.length > TAMANO_MAXIMO_ADJUNTO) {
      ignorados++;
      continue;
    }
    try {
      const resultado = await importarAdjunto({
        adjunto, estacionId: autorizado.estacion_id, remitente, messageId, config,
      });
      if (resultado.ok) {
        reportes.push(`${nombre}: ${resultado.reporte}`);
        await asentar({
          resultado: 'IMPORTACION_CORREO', estacionId: autorizado.estacion_id,
          detalle: `${autorizado.estacion} — ${nombre}: ${resultado.reporte} (de ${remitente}).`,
        });
      } else {
        huboError = true;
        reportes.push(`${nombre}: ERROR ${resultado.reporte}`);
        await asentar({
          resultado: 'CORREO_ERROR', estacionId: autorizado.estacion_id,
          detalle: `${autorizado.estacion} — ${nombre} ${resultado.reporte} (de ${remitente}). Correo marcado para revisión.`,
        });
      }
    } catch (err) {
      huboError = true;
      reportes.push(`${nombre}: ERROR ${err.message}`);
      await asentar({
        resultado: 'CORREO_ERROR', estacionId: autorizado.estacion_id,
        detalle: `${autorizado.estacion} — ${nombre} falló: ${String(err.message).slice(0, 200)}. Correo marcado para revisión.`,
      });
    }
  }
  if (!reportes.length && !ignorados) {
    reportes.push('sin adjuntos');
  }

  await conexion.marcarLeido(uid);
  if (huboError) await conexion.marcarParaRevision(uid);
  await registrarCorreo({
    messageId, remitente,
    resultado: huboError ? 'error' : 'procesado',
    detalle: `${reportes.join(' | ') || 'sin adjuntos Excel'}${ignorados ? ` | ${ignorados} adjuntos ignorados (no Excel o >10 MB)` : ''}`,
  });
  return { estado: huboError ? 'error' : 'procesado', reportes };
}

// Revisa el buzón completo. `conexion` es inyectable para pruebas.
async function revisarBuzon({ conexion } = {}) {
  if (!conexion && !configurado()) {
    return { ok: false, apagado: true, mensaje: 'Importación por correo apagada: faltan IMPORT_MAIL_HOST/USER/PASSWORD.' };
  }
  if (!configurada()) {
    return { ok: false, mensaje: 'Base de datos no configurada.' };
  }

  const config = await leerConfiguracion();
  const remitentes = await consultar(
    `SELECT r.correo, r.estacion_id, e.nombre AS estacion
     FROM remitentes_autorizados r JOIN estaciones e ON e.id = r.estacion_id`);

  const propia = !conexion;
  const totales = { procesados: 0, rechazados: 0, errores: 0, yaProcesados: 0 };
  try {
    if (propia) conexion = await conexionIMAP();
    const pendientes = await conexion.listarNoLeidos();
    for (const { uid } of pendientes) {
      const crudo = await conexion.obtenerFuente(uid);
      const { estado } = await procesarCorreo({ crudo, conexion, uid, config, remitentes });
      if (estado === 'procesado') totales.procesados++;
      else if (estado === 'rechazado') totales.rechazados++;
      else if (estado === 'error') totales.errores++;
      else totales.yaProcesados++;
    }
    await guardarUltimaRevision(
      `${pendientes.length} correos: ${totales.procesados} procesados, ${totales.rechazados} rechazados, ` +
      `${totales.errores} con error, ${totales.yaProcesados} repetidos`);
    await revisarArchivosFaltantes(config);
    return { ok: true, ...totales, revisados: pendientes.length };
  } catch (err) {
    // Solo el mensaje del error: jamás credenciales.
    const mensaje = `No se pudo revisar el buzón: ${String(err.message).slice(0, 200)}`;
    try { await guardarUltimaRevision(mensaje); } catch { /* sin BD no hay dónde */ }
    return { ok: false, mensaje };
  } finally {
    if (propia && conexion) await conexion.cerrar();
  }
}

// ---------- Vigilancia de archivo faltante ----------

// Fecha local AAAA-MM-DD con desplazamiento en días (0 = hoy, -1 = ayer).
function fechaLocal(zonaHoraria, dias = 0, ahora = new Date()) {
  const base = new Date(ahora.getTime() + dias * 86400000);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: zonaHoraria, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(base);
}

// Estaciones con espera_archivo_diario=1 sin ventas del día LOCAL anterior,
// una vez pasada la hora límite local. La BD guarda UTC, así que el "día de
// ayer" se traduce a un rango de instantes UTC (ORDEN 11): una venta de las
// 23:30 locales (05:30Z del día siguiente) cuenta para su día local.
async function estacionesConArchivoFaltante(config, ahora = new Date()) {
  const zonaHoraria = config.zona_horaria || 'America/Chihuahua';
  const horaLimite = String(config.hora_limite_archivo ?? '10:00');
  const horaLocal = reglas.ahoraLocal(zonaHoraria, ahora).slice(11, 16);
  if (horaLocal < horaLimite) return [];
  const ayer = fechaLocal(zonaHoraria, -1, ahora);
  const hoy = fechaLocal(zonaHoraria, 0, ahora);
  const desde = fechas.utcSQL(fechas.utcDesdeLocal(`${ayer} 00:00`, zonaHoraria));
  const hasta = fechas.utcSQL(fechas.utcDesdeLocal(`${hoy} 00:00`, zonaHoraria));
  return consultar(
    `SELECT e.id, e.nombre FROM estaciones e
     WHERE e.activa = 1 AND e.espera_archivo_diario = 1
       AND NOT EXISTS (SELECT 1 FROM ventas v
                       WHERE v.estacion_id = e.id AND v.fecha_hora >= ? AND v.fecha_hora < ?)
     ORDER BY e.id`, [desde, hasta]);
}

// Asienta la alerta en bitácora UNA vez al día por estación.
async function revisarArchivosFaltantes(config, ahora = new Date()) {
  const faltantes = await estacionesConArchivoFaltante(config, ahora);
  const zonaHoraria = config.zona_horaria || 'America/Chihuahua';
  const hoy = fechaLocal(zonaHoraria, 0, ahora);
  for (const estacion of faltantes) {
    const [ya] = await consultar(
      `SELECT id FROM bitacora_boletos
       WHERE tipo = 'correo' AND resultado = 'ARCHIVO_FALTANTE' AND estacion_id = ? AND detalle LIKE ?
       LIMIT 1`, [estacion.id, `%[${hoy}]%`]);
    if (ya) continue;
    await asentar({
      resultado: 'ARCHIVO_FALTANTE', estacionId: estacion.id,
      detalle: `[${hoy}] ${estacion.nombre}: sin ventas importadas del día anterior a las ${config.hora_limite_archivo ?? '10:00'} (hora local).`,
    });
  }
  return faltantes;
}

// ---------- Revisión periódica ----------

let temporizador = null;

function iniciarRevisionPeriodica() {
  if (!configurado()) {
    console.log('Importación por correo apagada: faltan IMPORT_MAIL_HOST/USER/PASSWORD.');
    return false;
  }
  const programar = async () => {
    let minutos = 10;
    try {
      const config = await leerConfiguracion();
      minutos = Number(config.intervalo_correo_minutos) > 0 ? Number(config.intervalo_correo_minutos) : 10;
    } catch { /* con la BD caída se reintenta con el default */ }
    temporizador = setTimeout(async () => {
      try {
        await revisarBuzon();
      } catch (err) {
        console.error('Revisión de buzón falló:', String(err.message).slice(0, 200));
      }
      programar();
    }, minutos * 60000);
    temporizador.unref(); // no mantiene vivo el proceso
  };
  programar();
  console.log(`Importación por correo activa: buzón ${process.env.IMPORT_MAIL_USER} en ${process.env.IMPORT_MAIL_HOST}.`);
  return true;
}

function detenerRevisionPeriodica() {
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
}

// ---------- Consultas para el panel ----------

async function resumenPanel() {
  const [estado] = await consultar('SELECT ultima_revision, detalle FROM importacion_correo_estado WHERE id = 1');
  const ultimos = await consultar(
    `SELECT a.fecha, a.nombre_archivo, a.remitente, a.sha256, a.reporte, e.nombre AS estacion
     FROM archivos_importados a
     JOIN estaciones e ON e.id = a.estacion_id
     JOIN (SELECT estacion_id, MAX(id) AS max_id FROM archivos_importados GROUP BY estacion_id) u
       ON u.max_id = a.id`);
  const problemas = await consultar(
    `SELECT fecha, remitente, resultado, detalle FROM correos_importados
     WHERE resultado IN ('rechazado', 'error') ORDER BY id DESC LIMIT 20`);
  return { estado: estado ?? { ultima_revision: null, detalle: null }, ultimos, problemas };
}

module.exports = {
  TAMANO_MAXIMO_ADJUNTO,
  configurado,
  revisarBuzon,
  estacionesConArchivoFaltante,
  revisarArchivosFaltantes,
  iniciarRevisionPeriodica,
  detenerRevisionPeriodica,
  resumenPanel,
};
