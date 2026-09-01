// Pantalla "WhatsApp": conversaciones por teléfono con últimos mensajes,
// resultado del reclamo y reenvío manual de respuestas fallidas. El operador
// autenticado ve el número completo (a diferencia del sitio público).

const express = require('express');
const { consultar } = require('../lib/db');
const { enviarTexto } = require('../servicios/whatsapp-api');
const { escaparHTML, paginaAdmin } = require('../lib/html');

const router = express.Router();

function formatearFecha(valor) {
  if (!valor) return '—';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  const dos = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

router.get('/whatsapp', async (req, res, next) => {
  try {
    const conversaciones = await consultar(
      `SELECT m.telefono,
              MAX(m.fecha_hora) AS ultima,
              COUNT(*) AS mensajes,
              SUM(m.direccion = 'entrante') AS entrantes,
              SUM(m.estado_envio = 'fallo') AS fallos
       FROM mensajes_whatsapp m
       GROUP BY m.telefono
       ORDER BY ultima DESC LIMIT 50`);
    const filas = [];
    for (const conversacion of conversaciones) {
      const [ultimo] = await consultar(
        `SELECT direccion, contenido, resultado FROM mensajes_whatsapp
         WHERE telefono = ? ORDER BY id DESC LIMIT 1`, [conversacion.telefono]);
      filas.push(`<tr>
        <td><a href="/admin/whatsapp/conversacion?telefono=${encodeURIComponent(conversacion.telefono)}">${escaparHTML(conversacion.telefono)}</a></td>
        <td>${formatearFecha(conversacion.ultima)}</td>
        <td>${conversacion.mensajes} (${conversacion.entrantes} entrantes)</td>
        <td>${Number(conversacion.fallos) ? `<strong style="color:#8E1B12">${conversacion.fallos} fallo(s)</strong>` : '—'}</td>
        <td style="white-space:normal">${escaparHTML((ultimo?.contenido ?? '').slice(0, 80))}${(ultimo?.contenido ?? '').length > 80 ? '…' : ''}
          ${ultimo?.resultado ? `<br><small>${escaparHTML(ultimo.resultado)}</small>` : ''}</td>
      </tr>`);
    }
    res.send(paginaAdmin('WhatsApp', `
      <h1>Conversaciones de WhatsApp</h1>
      ${filas.length
        ? `<table><tr><th>Teléfono</th><th>Último mensaje</th><th>Mensajes</th><th>Envíos fallidos</th><th>Contenido reciente</th></tr>${filas.join('')}</table>`
        : '<p class="vacio">Aún no hay conversaciones.</p>'}`));
  } catch (err) { next(err); }
});

router.get('/whatsapp/conversacion', async (req, res, next) => {
  try {
    const telefono = String(req.query.telefono ?? '');
    const mensajes = await consultar(
      `SELECT id, direccion, contenido, resultado, estado_envio, error_envio, fecha_hora
       FROM mensajes_whatsapp WHERE telefono = ? ORDER BY id LIMIT 500`, [telefono]);
    if (!mensajes.length) {
      return res.status(404).send(paginaAdmin('Conversación',
        '<h1>Sin mensajes</h1><p><a href="/admin/whatsapp">Volver</a></p>'));
    }
    const filas = mensajes.map((mensaje) => `<tr>
      <td>${formatearFecha(mensaje.fecha_hora)}</td>
      <td>${mensaje.direccion === 'entrante' ? 'Cliente' : 'Bot'}</td>
      <td style="white-space:normal">${escaparHTML(mensaje.contenido ?? '')}</td>
      <td>${escaparHTML(mensaje.resultado ?? '—')}</td>
      <td>${mensaje.direccion === 'saliente'
        ? (mensaje.estado_envio === 'enviado' ? 'Enviado'
           : `<strong style="color:#8E1B12">Fallo</strong><br><small>${escaparHTML(mensaje.error_envio ?? '')}</small>`)
        : '—'}</td>
      <td>${mensaje.direccion === 'saliente' ? `
        <form method="post" action="/admin/whatsapp/reenviar" style="margin:0"
              onsubmit="return confirm('¿Reenviar este mensaje al cliente?')">
          <input type="hidden" name="mensaje_id" value="${mensaje.id}">
          <input type="hidden" name="telefono" value="${escaparHTML(telefono)}">
          <button type="submit">Reenviar</button>
        </form>` : ''}</td>
    </tr>`).join('');
    res.send(paginaAdmin(`WhatsApp ${telefono}`, `
      <h1>Conversación con ${escaparHTML(telefono)}</h1>
      <p><a href="/admin/whatsapp">← Todas las conversaciones</a> ·
         <a href="/admin/boletos?cliente=${encodeURIComponent(telefono)}">Boletos de este cliente</a></p>
      <table><tr><th>Fecha</th><th>De</th><th>Mensaje</th><th>Resultado</th><th>Envío</th><th></th></tr>${filas}</table>`));
  } catch (err) { next(err); }
});

router.post('/whatsapp/reenviar', async (req, res, next) => {
  try {
    const [mensaje] = await consultar(
      `SELECT telefono, contenido, resultado FROM mensajes_whatsapp
       WHERE id = ? AND direccion = 'saliente'`, [Number(req.body.mensaje_id)]);
    if (!mensaje) {
      return res.status(404).send(paginaAdmin('Reenvío', '<h1>Mensaje no encontrado</h1>'));
    }
    const envio = await enviarTexto(mensaje.telefono, mensaje.contenido);
    await consultar(
      `INSERT INTO mensajes_whatsapp (telefono, direccion, contenido, resultado, wa_message_id, estado_envio, error_envio)
       VALUES (?, 'saliente', ?, ?, ?, ?, ?)`,
      [mensaje.telefono, mensaje.contenido, mensaje.resultado, envio.id ?? null,
       envio.ok ? 'enviado' : 'fallo', envio.ok ? null : (envio.error ?? 'desconocido')]);
    res.redirect(`/admin/whatsapp/conversacion?telefono=${encodeURIComponent(req.body.telefono ?? mensaje.telefono)}`);
  } catch (err) { next(err); }
});

module.exports = router;
