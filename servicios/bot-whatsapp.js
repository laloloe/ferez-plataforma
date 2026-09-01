// Bot de WhatsApp del Sorteo Ferez 2027 (Órdenes 3 y 4).
//
// Este módulo decide y ejecuta; el envío real vive en whatsapp-api.js y se
// puede inyectar (las pruebas pasan un enviador falso). Reglas:
//   - Idempotencia por wa_message_id: un mensaje de Meta nunca se procesa
//     dos veces (clave única en mensajes_whatsapp).
//   - Límite de 10 reclamos por teléfono por hora.
//   - El bot NUNCA adivina la estación: si un folio coincide en más de una
//     estación pregunta dónde cargó (opciones numeradas) y guarda un estado
//     pendiente por teléfono con vigencia de 10 minutos.
//   - Los textos van en "tú", breves, sin emojis. El detalle de cada rechazo
//     sale del motor tal cual (códigos estables de la Orden 1).

const crypto = require('crypto');
const { consultar } = require('../lib/db');
const { normalizarTelefono } = require('../lib/telefono');
const { normalizarTexto } = require('./reglas-boletos');
const motor = require('./motor-boletos');
const whatsappApi = require('./whatsapp-api');

const LIMITE_RECLAMOS_HORA = 10;
const MINUTOS_PENDIENTE = 10;

// Resultados de mensaje que NO cuentan para el límite por hora.
const RESULTADOS_SIN_LIMITE = ['ayuda', 'no_texto', 'PENDIENTE_REPETIDO', 'PENDIENTE_CANCELADO'];

function urlSitio() {
  return (process.env.SITIO_URL || 'https://ferez.mx').replace(/\/$/, '');
}

// Textos del bot (en "tú", sin emojis). El nombre siempre es "Sorteo Ferez 2027".
const TEXTOS = {
  ayuda: () =>
    `Así participas en el Sorteo Ferez 2027:\n` +
    `1) Regístrate una sola vez en ${urlSitio()}/registro con este mismo teléfono.\n` +
    `2) Después de cargar combustible, envíame por aquí el folio de tu ticket.\n` +
    `3) Te respondo con tu número de boleto.\n` +
    `Consulta las bases y el padrón público en ${urlSitio()}/boletos`,
  no_registrado: () =>
    `Para participar en el Sorteo Ferez 2027 primero regístrate en ${urlSitio()}/registro ` +
    `con este mismo teléfono. Cuando termines, reenvíame el folio de tu ticket.`,
  exito: (folio, estacion, boletos) =>
    boletos.length === 1
      ? `Listo. Tu folio ${folio} de ${estacion} generó el boleto ${boletos[0]}. ` +
        `Guarda este mensaje; puedes verlo en el padrón público: ${urlSitio()}/boletos`
      : `Listo. Tu folio ${folio} de ${estacion} generó ${boletos.length} boletos: ${boletos.join(', ')}. ` +
        `Guarda este mensaje; puedes verlos en el padrón público: ${urlSitio()}/boletos`,
  pregunta_estacion: (folio, opciones) =>
    `Encontramos el folio ${folio} en más de una estación. ¿En cuál cargaste? ` +
    `Responde solo con el número:\n` +
    opciones.map((opcion, indice) => `${indice + 1} ${opcion.nombre}`).join('\n'),
  pendiente_cancelado: (folio) =>
    `No reconocí tu respuesta, así que cancelé la consulta del folio ${folio}. ` +
    `Envíame el folio de nuevo cuando quieras volver a intentarlo.`,
  sin_venta_en_estacion: (folio, estacion) =>
    `En ${estacion} no encontramos una carga con el folio ${folio}, así que no emití boletos. ` +
    `Revisa tu ticket y envíame el folio de nuevo; si el problema sigue, te apoyamos en la estación.`,
  no_texto: () =>
    `Recibí tu mensaje, pero necesito el folio en texto. Escríbelo tal como aparece en tu ticket.`,
  limite: () =>
    `Has hecho varios intentos seguidos. Espera un rato y vuelve a intentarlo.`,
};

// ---------- Seguridad del webhook ----------

function validarFirma(cuerpoCrudo, encabezado, secreto) {
  if (!secreto || !encabezado || !cuerpoCrudo) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', secreto).update(cuerpoCrudo).digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(encabezado));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verificarSuscripcion(consulta, tokenVerificacion) {
  if (consulta['hub.mode'] === 'subscribe' && tokenVerificacion &&
      consulta['hub.verify_token'] === tokenVerificacion) {
    return { estado: 200, cuerpo: consulta['hub.challenge'] ?? '' };
  }
  return { estado: 403, cuerpo: 'Verificación rechazada' };
}

// ---------- Clasificación del texto entrante ----------

const PALABRAS_AYUDA = new Set([
  'hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'ayuda',
  'boletos', 'boleto', 'info', 'informacion', 'sorteo', 'participar', 'bases',
  'gracias', 'menu', 'inicio', 'hi', 'ok',
]);

function clasificarTexto(texto) {
  const limpio = normalizarTexto(texto);
  if (!limpio) return { tipo: 'ayuda' };
  if (PALABRAS_AYUDA.has(limpio)) return { tipo: 'ayuda' };
  const candidato = String(texto).replace(/\s+/g, '').trim();
  if (/^[A-Za-z0-9][A-Za-z0-9\-/.]{2,29}$/.test(candidato) && /\d/.test(candidato)) {
    return { tipo: 'folio', folio: candidato };
  }
  return { tipo: 'ayuda' };
}

// ---------- Desambiguación de estación ----------

// Estaciones participantes en el orden aprobado para las opciones numeradas:
// 1 Km 12.9 Corredor Comercial, 2 Rubio, 3 Oasis (las no listadas van al final).
async function estacionesParticipantes() {
  return consultar(
    `SELECT id, nombre FROM estaciones WHERE activa = 1 AND participa_sorteo = 1
     ORDER BY FIELD(nombre, 'Km 12.9 Corredor Comercial', 'Rubio', 'Oasis') = 0,
              FIELD(nombre, 'Km 12.9 Corredor Comercial', 'Rubio', 'Oasis'), id`);
}

// Ventas que coinciden con el folio en estaciones participantes.
async function ventasConFolio(folio, estacionId = null) {
  const parametros = [folio];
  let filtro = '';
  if (estacionId) { filtro = 'AND v.estacion_id = ?'; parametros.push(estacionId); }
  return consultar(
    `SELECT v.id, v.estacion_id, e.nombre AS estacion
     FROM ventas v
     JOIN estaciones e ON e.id = v.estacion_id AND e.activa = 1 AND e.participa_sorteo = 1
     WHERE v.folio = ? ${filtro}`, parametros);
}

async function leerPendiente(telefono) {
  const [pendiente] = await consultar('SELECT * FROM estado_bot WHERE telefono = ?', [telefono]);
  if (!pendiente) return null;
  if (new Date(pendiente.expira).getTime() < Date.now()) {
    await consultar('DELETE FROM estado_bot WHERE telefono = ?', [telefono]);
    return null;
  }
  return { ...pendiente, opciones: JSON.parse(pendiente.opciones) };
}

async function guardarPendiente(telefono, folio, opciones) {
  await consultar(
    `REPLACE INTO estado_bot (telefono, folio, opciones, intentos, expira)
     VALUES (?, ?, ?, 0, DATE_ADD(NOW(), INTERVAL ${MINUTOS_PENDIENTE} MINUTE))`,
    [telefono, folio, JSON.stringify(opciones)]);
}

async function borrarPendiente(telefono) {
  await consultar('DELETE FROM estado_bot WHERE telefono = ?', [telefono]);
}

async function registrarEnBitacora(telefono, folio, resultado, detalle, estacionId = null) {
  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, telefono, folio_venta, estacion_id, resultado, detalle)
     VALUES ('bot:whatsapp', 'reclamo', ?, ?, ?, ?, ?)`,
    [telefono, folio, estacionId, resultado, detalle]);
}

// ---------- Flujo ----------

async function reclamosUltimaHora(telefono) {
  const marcadores = RESULTADOS_SIN_LIMITE.map(() => '?').join(', ');
  const [{ total }] = await consultar(
    `SELECT COUNT(*) AS total FROM mensajes_whatsapp
     WHERE telefono = ? AND direccion = 'entrante'
       AND resultado IS NOT NULL AND resultado NOT IN (${marcadores})
       AND fecha_hora > DATE_SUB(NOW(), INTERVAL 1 HOUR)`, [telefono, ...RESULTADOS_SIN_LIMITE]);
  return Number(total);
}

async function reclamarEnEstacion(telefono, folio, estacionId, estacionNombre) {
  const resultado = await motor.reclamarFolio({ telefono, folio, estacionId, actor: 'bot:whatsapp' });
  if (resultado.ok) {
    return { respuesta: TEXTOS.exito(folio, estacionNombre, resultado.boletos), resultado: 'ok' };
  }
  if (resultado.codigo === 'CLIENTE_NO_REGISTRADO') {
    return { respuesta: TEXTOS.no_registrado(), resultado: resultado.codigo };
  }
  return { respuesta: resultado.mensaje, resultado: resultado.codigo };
}

// Respuesta del cliente cuando hay una pregunta de estación pendiente.
async function resolverPendiente(telefono, texto, pendiente) {
  const eleccion = String(texto ?? '').trim();
  const numero = /^\d{1,2}$/.test(eleccion) ? Number(eleccion) : null;

  if (!numero || numero < 1 || numero > pendiente.opciones.length) {
    if (pendiente.intentos >= 1) {
      await borrarPendiente(telefono);
      return { respuesta: TEXTOS.pendiente_cancelado(pendiente.folio), resultado: 'PENDIENTE_CANCELADO' };
    }
    await consultar('UPDATE estado_bot SET intentos = intentos + 1 WHERE telefono = ?', [telefono]);
    return { respuesta: TEXTOS.pregunta_estacion(pendiente.folio, pendiente.opciones), resultado: 'PENDIENTE_REPETIDO' };
  }

  const estacion = pendiente.opciones[numero - 1];
  await borrarPendiente(telefono);

  // Jamás se emite contra una estación no confirmada: se valida que en la
  // estación elegida exista exactamente UNA venta con ese folio.
  const coincidencias = await ventasConFolio(pendiente.folio, estacion.id);
  if (coincidencias.length === 0) {
    await registrarEnBitacora(telefono, pendiente.folio, 'DESAMBIGUACION_SIN_VENTA',
      `El cliente eligió ${estacion.nombre} pero ahí no existe el folio. Revisión manual.`, estacion.id);
    return { respuesta: TEXTOS.sin_venta_en_estacion(pendiente.folio, estacion.nombre), resultado: 'DESAMBIGUACION_SIN_VENTA' };
  }
  if (coincidencias.length > 1) {
    await registrarEnBitacora(telefono, pendiente.folio, 'DESAMBIGUACION_AMBIGUA',
      `Más de una venta con el folio en ${estacion.nombre}. Revisión manual.`, estacion.id);
    return { respuesta: TEXTOS.sin_venta_en_estacion(pendiente.folio, estacion.nombre), resultado: 'DESAMBIGUACION_AMBIGUA' };
  }
  return reclamarEnEstacion(telefono, pendiente.folio, estacion.id, estacion.nombre);
}

// Decide la respuesta para un mensaje entrante. Devuelve { respuesta, resultado }.
async function procesarMensaje({ telefono, texto, tipo }) {
  if (tipo !== 'text') {
    return { respuesta: TEXTOS.no_texto(), resultado: 'no_texto' };
  }

  const pendiente = await leerPendiente(telefono);
  if (pendiente) return resolverPendiente(telefono, texto, pendiente);

  const clasificacion = clasificarTexto(texto);
  if (clasificacion.tipo === 'ayuda') {
    return { respuesta: TEXTOS.ayuda(), resultado: 'ayuda' };
  }

  if (await reclamosUltimaHora(telefono) >= LIMITE_RECLAMOS_HORA) {
    await registrarEnBitacora(telefono, clasificacion.folio, 'LIMITE_EXCEDIDO',
      `Más de ${LIMITE_RECLAMOS_HORA} reclamos en una hora`);
    return { respuesta: TEXTOS.limite(), resultado: 'LIMITE_EXCEDIDO' };
  }

  const coincidencias = await ventasConFolio(clasificacion.folio);
  if (coincidencias.length > 1) {
    const opciones = await estacionesParticipantes();
    await guardarPendiente(telefono, clasificacion.folio, opciones);
    return { respuesta: TEXTOS.pregunta_estacion(clasificacion.folio, opciones), resultado: 'DESAMBIGUACION' };
  }
  if (coincidencias.length === 1) {
    return reclamarEnEstacion(telefono, clasificacion.folio, coincidencias[0].estacion_id, coincidencias[0].estacion);
  }
  // Sin coincidencias: el motor emite el rechazo FOLIO_INEXISTENTE (y lo bitacorea).
  const [primera] = await estacionesParticipantes();
  return reclamarEnEstacion(telefono, clasificacion.folio, primera ? primera.id : 0, primera ? primera.nombre : '');
}

// ---------- Entrada desde el webhook ----------

async function registrarEntrante({ telefono, contenido, waMessageId }) {
  const filas = await consultar(
    `INSERT IGNORE INTO mensajes_whatsapp (telefono, direccion, contenido, wa_message_id)
     VALUES (?, 'entrante', ?, ?)`,
    [telefono, contenido, waMessageId]);
  return filas.affectedRows > 0;
}

async function registrarSaliente({ telefono, contenido, resultado, envio }) {
  await consultar(
    `INSERT INTO mensajes_whatsapp (telefono, direccion, contenido, resultado, wa_message_id, estado_envio, error_envio)
     VALUES (?, 'saliente', ?, ?, ?, ?, ?)`,
    [telefono, contenido, resultado ?? null, envio.id ?? null,
     envio.ok ? 'enviado' : 'fallo', envio.ok ? null : (envio.error ?? 'desconocido')]);
}

async function procesarWebhook(cuerpo, { enviar = whatsappApi.enviarTexto } = {}) {
  const procesados = [];
  for (const entrada of cuerpo?.entry ?? []) {
    for (const cambio of entrada?.changes ?? []) {
      for (const mensaje of cambio?.value?.messages ?? []) {
        const telefono = normalizarTelefono(String(mensaje.from ?? ''));
        if (!telefono || !mensaje.id) continue;

        const contenido = mensaje.type === 'text' ? String(mensaje.text?.body ?? '').slice(0, 1000) : `[${mensaje.type}]`;
        const esNuevo = await registrarEntrante({ telefono, contenido, waMessageId: mensaje.id });
        if (!esNuevo) {
          procesados.push({ id: mensaje.id, duplicado: true });
          continue;
        }

        let respuesta;
        let resultado;
        try {
          ({ respuesta, resultado } = await procesarMensaje({ telefono, texto: contenido, tipo: mensaje.type }));
        } catch (err) {
          console.error('Error procesando mensaje de WhatsApp:', err.message);
          respuesta = null;
          resultado = 'error';
        }
        await consultar('UPDATE mensajes_whatsapp SET resultado = ? WHERE wa_message_id = ?', [resultado, mensaje.id]);

        if (respuesta) {
          const envio = await enviar(telefono, respuesta);
          await registrarSaliente({ telefono, contenido: respuesta, resultado, envio });
        }
        procesados.push({ id: mensaje.id, resultado });
      }
    }
  }
  return procesados;
}

module.exports = {
  TEXTOS,
  LIMITE_RECLAMOS_HORA,
  MINUTOS_PENDIENTE,
  validarFirma,
  verificarSuscripcion,
  clasificarTexto,
  estacionesParticipantes,
  procesarMensaje,
  procesarWebhook,
  registrarEntrante,
};
