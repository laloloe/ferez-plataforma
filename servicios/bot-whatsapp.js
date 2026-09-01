// Bot de WhatsApp del sorteo (ORDEN 3 — paso 8, contra número de prueba).
//
// Este módulo decide y ejecuta; el envío real vive en whatsapp-api.js y se
// puede inyectar (las pruebas pasan un enviador falso). Reglas:
//   - Idempotencia por wa_message_id: un mensaje de Meta nunca se procesa
//     dos veces (clave única en mensajes_whatsapp).
//   - Límite de 10 reclamos por teléfono por hora.
//   - Los textos van en "tú", breves, sin emojis. El detalle de cada rechazo
//     sale del motor tal cual (códigos estables de la Orden 1).

const crypto = require('crypto');
const { consultar } = require('../lib/db');
const { normalizarTelefono } = require('../lib/telefono');
const { normalizarTexto } = require('./reglas-boletos');
const motor = require('./motor-boletos');
const whatsappApi = require('./whatsapp-api');

const LIMITE_RECLAMOS_HORA = 10;

function urlSitio() {
  return (process.env.SITIO_URL || 'https://ferez.mx').replace(/\/$/, '');
}

// Textos del bot (en "tú", sin emojis). Revisables por Eduardo.
const TEXTOS = {
  ayuda: () =>
    `Así participas en el sorteo Ferez:\n` +
    `1) Regístrate una sola vez en ${urlSitio()}/registro con este mismo teléfono.\n` +
    `2) Después de cargar combustible, envíame por aquí el folio de tu ticket.\n` +
    `3) Te respondo con tu número de boleto.\n` +
    `Consulta las bases y el padrón público en ${urlSitio()}/boletos`,
  no_registrado: () =>
    `Para participar primero regístrate en ${urlSitio()}/registro con este mismo teléfono. ` +
    `Cuando termines, reenvíame el folio de tu ticket.`,
  exito: (folio, boletos) =>
    boletos.length === 1
      ? `Listo. Tu folio ${folio} generó el boleto ${boletos[0]}. ` +
        `Guarda este mensaje; puedes verlo en el padrón público: ${urlSitio()}/boletos`
      : `Listo. Tu folio ${folio} generó ${boletos.length} boletos: ${boletos.join(', ')}. ` +
        `Guarda este mensaje; puedes verlos en el padrón público: ${urlSitio()}/boletos`,
  no_texto: () =>
    `Recibí tu mensaje, pero necesito el folio en texto. Escríbelo tal como aparece en tu ticket.`,
  limite: () =>
    `Has hecho varios intentos seguidos. Espera un rato y vuelve a intentarlo.`,
};

// ---------- Seguridad del webhook ----------

// Firma X-Hub-Signature-256: HMAC SHA-256 del cuerpo crudo con el app secret.
function validarFirma(cuerpoCrudo, encabezado, secreto) {
  if (!secreto || !encabezado || !cuerpoCrudo) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', secreto).update(cuerpoCrudo).digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(encabezado));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Verificación GET de Meta (hub.challenge).
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

// Un folio: 3 a 30 caracteres de letras/números/guiones/diagonales con al
// menos un dígito (se le quitan espacios). Todo lo demás pide ayuda.
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

// ---------- Flujo ----------

// La estación se deduce del folio: se busca en todas las estaciones
// participantes; se prefiere la venta aún sin reclamo y, entre varias,
// la más reciente. Si no hay ninguna, el motor responderá FOLIO_INEXISTENTE.
async function resolverEstacionParaFolio(folio) {
  const candidatas = await consultar(
    `SELECT v.estacion_id, (em.id IS NULL) AS sin_reclamo, v.fecha_hora
     FROM ventas v
     JOIN estaciones e ON e.id = v.estacion_id AND e.activa = 1 AND e.participa_sorteo = 1
     LEFT JOIN emisiones em ON em.venta_id = v.id
     WHERE v.folio = ?
     ORDER BY sin_reclamo DESC, v.fecha_hora DESC LIMIT 1`, [folio]);
  if (candidatas.length) return candidatas[0].estacion_id;
  const [primera] = await consultar(
    'SELECT id FROM estaciones WHERE activa = 1 AND participa_sorteo = 1 ORDER BY id LIMIT 1');
  return primera ? primera.id : null;
}

async function reclamosUltimaHora(telefono) {
  const [{ total }] = await consultar(
    `SELECT COUNT(*) AS total FROM mensajes_whatsapp
     WHERE telefono = ? AND direccion = 'entrante'
       AND resultado NOT IN ('ayuda', 'no_texto') AND resultado IS NOT NULL
       AND fecha_hora > DATE_SUB(NOW(), INTERVAL 1 HOUR)`, [telefono]);
  return Number(total);
}

// Decide la respuesta para un mensaje entrante. Devuelve { respuesta, resultado }.
async function procesarMensaje({ telefono, texto, tipo }) {
  if (tipo !== 'text') {
    return { respuesta: TEXTOS.no_texto(), resultado: 'no_texto' };
  }
  const clasificacion = clasificarTexto(texto);
  if (clasificacion.tipo === 'ayuda') {
    return { respuesta: TEXTOS.ayuda(), resultado: 'ayuda' };
  }

  if (await reclamosUltimaHora(telefono) >= LIMITE_RECLAMOS_HORA) {
    await consultar(
      `INSERT INTO bitacora_boletos (actor, tipo, telefono, folio_venta, resultado, detalle)
       VALUES ('bot:whatsapp', 'reclamo', ?, ?, 'LIMITE_EXCEDIDO', 'Más de ${LIMITE_RECLAMOS_HORA} reclamos en una hora')`,
      [telefono, clasificacion.folio]);
    return { respuesta: TEXTOS.limite(), resultado: 'LIMITE_EXCEDIDO' };
  }

  const estacionId = await resolverEstacionParaFolio(clasificacion.folio);
  const resultado = await motor.reclamarFolio({
    telefono, folio: clasificacion.folio, estacionId, actor: 'bot:whatsapp',
  });

  if (resultado.ok) {
    return { respuesta: TEXTOS.exito(clasificacion.folio, resultado.boletos), resultado: 'ok' };
  }
  if (resultado.codigo === 'CLIENTE_NO_REGISTRADO') {
    // El intento ya quedó en bitácora (lo registra el motor).
    return { respuesta: TEXTOS.no_registrado(), resultado: resultado.codigo };
  }
  return { respuesta: resultado.mensaje, resultado: resultado.codigo };
}

// ---------- Entrada desde el webhook ----------

// Registra el mensaje entrante. Devuelve false si ya se había procesado
// (mismo wa_message_id): idempotencia a nivel de base de datos.
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

// Procesa el cuerpo de una notificación de Meta. `enviar` es inyectable.
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
  validarFirma,
  verificarSuscripcion,
  clasificarTexto,
  resolverEstacionParaFolio,
  procesarMensaje,
  procesarWebhook,
  registrarEntrante,
};
