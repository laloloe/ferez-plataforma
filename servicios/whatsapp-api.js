// Envío de mensajes por la Cloud API de WhatsApp (Meta).
//
// Variables de entorno (número de prueba hoy; la línea real será SOLO
// cambiar estos valores, sin tocar código):
//   WHATSAPP_TOKEN            — token de acceso de la app
//   WHATSAPP_PHONE_NUMBER_ID  — id del número emisor
//   WHATSAPP_VERIFY_TOKEN     — token de verificación del webhook
//   WHATSAPP_APP_SECRET       — secreto de la app (firma X-Hub-Signature-256)
//
// El token y el secreto NUNCA se escriben en logs ni en errores.

const VERSION_API = process.env.WHATSAPP_API_VERSION || 'v20.0';

function configurado() {
  return Boolean(
    process.env.WHATSAPP_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_VERIFY_TOKEN &&
    process.env.WHATSAPP_APP_SECRET
  );
}

// Envía un mensaje de texto. Devuelve { ok, id? , error? } — el error es un
// texto corto y seguro (sin credenciales).
async function enviarTexto(telefonoE164, texto) {
  if (!configurado()) return { ok: false, error: 'WhatsApp no configurado' };
  const url = `https://graph.facebook.com/${VERSION_API}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefonoE164.replace(/^\+/, ''),
        type: 'text',
        text: { preview_url: false, body: texto },
      }),
    });
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      const detalle = cuerpo?.error?.message ? String(cuerpo.error.message).slice(0, 300) : `HTTP ${respuesta.status}`;
      return { ok: false, error: detalle };
    }
    return { ok: true, id: cuerpo?.messages?.[0]?.id ?? null };
  } catch (err) {
    return { ok: false, error: String(err.message).slice(0, 300) };
  }
}

module.exports = { configurado, enviarTexto };
