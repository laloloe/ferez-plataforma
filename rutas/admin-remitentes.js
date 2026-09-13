// Pantalla "Remitentes" (ORDEN 10, solo administrador): lista blanca del
// buzón de importación. Un remitente pertenece a UNA estación; esa
// asignación decide a qué estación se importa su archivo. También se
// controla aquí qué estaciones deben mandar archivo diario.

const express = require('express');
const { consultar } = require('../lib/db');
const { escaparHTML, paginaAdmin } = require('../lib/html');

const router = express.Router();

function correoValido(correo) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
}

async function registrarAjuste(actor, detalle) {
  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, resultado, detalle)
     VALUES (?, 'ajuste', 'REMITENTES', ?)`, [actor, detalle.slice(0, 400)]);
}

async function render(res, avisoHTML = '') {
  const estaciones = await consultar('SELECT id, nombre, espera_archivo_diario FROM estaciones WHERE activa = 1 ORDER BY id');
  const remitentes = await consultar(
    `SELECT r.id, r.correo, r.fecha_alta, r.dado_de_alta_por, e.nombre AS estacion
     FROM remitentes_autorizados r JOIN estaciones e ON e.id = r.estacion_id ORDER BY r.id`);

  const opciones = estaciones.map((e) => `<option value="${e.id}">${escaparHTML(e.nombre)}</option>`).join('');
  const filas = remitentes.map((r) => `<tr>
    <td>${escaparHTML(r.correo)}</td><td>${escaparHTML(r.estacion)}</td>
    <td>${escaparHTML(r.dado_de_alta_por)}</td>
    <td><form method="post" action="/admin/remitentes/baja" style="display:inline"
          onsubmit="return confirm('¿Dar de baja al remitente ${escaparHTML(r.correo)}? Sus correos dejarán de importarse.')">
        <input type="hidden" name="id" value="${r.id}">
        <button type="submit" style="background:#FBE9E7;color:#8E1B12;border:1px solid #C62828">Dar de baja</button>
        </form></td></tr>`).join('');

  const filasEstaciones = estaciones.map((e) => `<tr>
    <td>${escaparHTML(e.nombre)}</td>
    <td>${e.espera_archivo_diario ? 'Sí' : 'No'}</td>
    <td><form method="post" action="/admin/remitentes/archivo-diario" style="display:inline">
        <input type="hidden" name="estacion_id" value="${e.id}">
        <input type="hidden" name="valor" value="${e.espera_archivo_diario ? 0 : 1}">
        <button type="submit">${e.espera_archivo_diario ? 'Ya no esperar' : 'Esperar archivo'}</button>
        </form></td></tr>`).join('');

  res.send(paginaAdmin('Remitentes', `
    <h1>Remitentes autorizados del buzón</h1>
    <p>Solo los correos de esta lista pueden importar ventas. La estación del remitente decide
    a dónde entra su archivo, sin confiar en el contenido del Excel. Los correos de remitentes
    desconocidos se rechazan en silencio (sin respuesta) y quedan en bitácora.</p>
    ${avisoHTML}
    <h2>Alta de remitente</h2>
    <form class="linea" method="post" action="/admin/remitentes">
      <div><label>Correo</label><input type="email" name="correo" required maxlength="190" placeholder="estacion@dominio.com"></div>
      <div><label>Estación</label><select name="estacion_id" required>${opciones}</select></div>
      <button type="submit">Autorizar</button>
    </form>
    <h2>Lista blanca</h2>
    ${filas
      ? `<table><tr><th>Correo</th><th>Estación</th><th>Dado de alta por</th><th></th></tr>${filas}</table>`
      : '<p class="vacio">Aún no hay remitentes autorizados: el buzón rechaza todo.</p>'}
    <h2>Archivo diario esperado</h2>
    <p>Las estaciones marcadas se vigilan: si a la hora límite no han importado ventas del día
    anterior, aparecen en rojo en la pantalla de Ventas y queda un asiento en bitácora.</p>
    <table><tr><th>Estación</th><th>Espera archivo diario</th><th></th></tr>${filasEstaciones}</table>`));
}

router.get('/remitentes', async (req, res, next) => {
  try { await render(res); } catch (err) { next(err); }
});

router.post('/remitentes', async (req, res, next) => {
  try {
    const correo = String(req.body.correo ?? '').toLowerCase().trim();
    const estacionId = Number(req.body.estacion_id);
    const [estacion] = await consultar('SELECT id, nombre FROM estaciones WHERE id = ? AND activa = 1', [estacionId]);
    if (!correoValido(correo)) return render(res, '<p class="msj error">El correo no es válido.</p>');
    if (!estacion) return render(res, '<p class="msj error">Estación no válida.</p>');
    const resultado = await consultar(
      'INSERT IGNORE INTO remitentes_autorizados (correo, estacion_id, dado_de_alta_por) VALUES (?, ?, ?)',
      [correo, estacionId, req.actor]);
    if (!resultado.affectedRows) {
      return render(res, `<p class="msj error">El remitente ${escaparHTML(correo)} ya está en la lista.</p>`);
    }
    await registrarAjuste(`admin:${req.actor}`, `Remitente autorizado: ${correo} → ${estacion.nombre}.`);
    await render(res, `<p class="msj ok">Remitente ${escaparHTML(correo)} autorizado para ${escaparHTML(estacion.nombre)}.</p>`);
  } catch (err) { next(err); }
});

router.post('/remitentes/baja', async (req, res, next) => {
  try {
    const [remitente] = await consultar(
      `SELECT r.correo, e.nombre AS estacion FROM remitentes_autorizados r
       JOIN estaciones e ON e.id = r.estacion_id WHERE r.id = ?`, [Number(req.body.id)]);
    if (!remitente) return render(res, '<p class="msj error">Remitente no encontrado.</p>');
    await consultar('DELETE FROM remitentes_autorizados WHERE id = ?', [Number(req.body.id)]);
    await registrarAjuste(`admin:${req.actor}`, `Remitente dado de baja: ${remitente.correo} (${remitente.estacion}).`);
    await render(res, `<p class="msj ok">Remitente ${escaparHTML(remitente.correo)} dado de baja.</p>`);
  } catch (err) { next(err); }
});

router.post('/remitentes/archivo-diario', async (req, res, next) => {
  try {
    const estacionId = Number(req.body.estacion_id);
    const valor = req.body.valor === '1' ? 1 : 0;
    const [estacion] = await consultar('SELECT id, nombre FROM estaciones WHERE id = ?', [estacionId]);
    if (!estacion) return render(res, '<p class="msj error">Estación no válida.</p>');
    await consultar('UPDATE estaciones SET espera_archivo_diario = ? WHERE id = ?', [valor, estacionId]);
    await registrarAjuste(`admin:${req.actor}`,
      `Archivo diario ${valor ? 'ACTIVADO' : 'desactivado'} para ${estacion.nombre}.`);
    await render(res, `<p class="msj ok">${escaparHTML(estacion.nombre)}: archivo diario ${valor ? 'esperado' : 'ya no esperado'}.</p>`);
  } catch (err) { next(err); }
});

module.exports = router;
