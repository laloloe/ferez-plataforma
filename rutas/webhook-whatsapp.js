// Webhook de la Cloud API de WhatsApp (Meta).
//   GET  /webhooks/whatsapp — verificación de la suscripción (hub.challenge)
//   POST /webhooks/whatsapp — mensajes entrantes: firma obligatoria,
//        200 inmediato y procesamiento después (setImmediate).

const express = require('express');
const { configurada } = require('../lib/db');
const whatsappApi = require('../servicios/whatsapp-api');
const bot = require('../servicios/bot-whatsapp');

const router = express.Router();

router.get('/webhooks/whatsapp', (req, res) => {
  if (!process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(503).send('Webhook de WhatsApp no disponible');
  }
  const { estado, cuerpo } = bot.verificarSuscripcion(req.query, process.env.WHATSAPP_VERIFY_TOKEN);
  res.status(estado).send(cuerpo);
});

router.post('/webhooks/whatsapp', (req, res) => {
  // Diagnóstico en logs (ORDEN 17): UNA línea por POST — timestamp,
  // resultado, si traía encabezado de firma y tamaño del cuerpo. Jamás el
  // token, el secreto, el cuerpo del mensaje ni teléfonos.
  const traeFirma = Boolean(req.headers['x-hub-signature-256']);
  const bytes = req.rawBody ? req.rawBody.length : 0;
  const registrar = (resultado) => {
    console.log(`[webhook-whatsapp] ${new Date().toISOString()} ${resultado} encabezado-firma=${traeFirma ? 'si' : 'no'} bytes=${bytes}`);
  };

  if (!whatsappApi.configurado() || !configurada()) {
    registrar('NO_CONFIGURADO');
    return res.status(503).json({ ok: false, mensaje: 'Webhook de WhatsApp no disponible' });
  }
  const firmaValida = bot.validarFirma(
    req.rawBody, req.headers['x-hub-signature-256'], process.env.WHATSAPP_APP_SECRET);
  if (!firmaValida) {
    registrar('FIRMA_INVALIDA');
    return res.status(401).json({ ok: false, mensaje: 'Firma inválida' });
  }
  registrar('FIRMA_OK');

  // Meta exige respuesta rápida: 200 ya, el trabajo después.
  res.sendStatus(200);
  const cuerpo = req.body;
  setImmediate(() => {
    bot.procesarWebhook(cuerpo).catch((err) => {
      console.error('Error en webhook de WhatsApp:', err.message);
    });
  });
});

module.exports = router;
