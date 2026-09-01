// Pantalla "Captura de ventas" (ORDEN 4): alta individual y carga CSV para
// estaciones sin importación de ControlGAS (hoy: Oasis). Toda venta capturada
// queda con origen 'captura', el usuario que la registró, y en bitácora.

const express = require('express');
const multer = require('multer');
const { consultar } = require('../lib/db');
const { FuenteManual } = require('../fuentes/fuente-manual');
const { escaparHTML, paginaAdmin } = require('../lib/html');

const router = express.Router();
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function formatearFecha(valor) {
  if (!valor) return '—';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  const dos = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

async function registrarCapturaEnBitacora({ actor, folio, estacionId, resultado, detalle }) {
  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, folio_venta, estacion_id, resultado, detalle)
     VALUES (?, 'captura', ?, ?, ?, ?)`,
    [actor, folio, estacionId, resultado, detalle]);
}

// Inserta una venta capturada. Devuelve true si entró, false si era duplicada.
async function insertarVentaCapturada({ estacionId, venta, actor }) {
  const resultado = await consultar(
    `INSERT IGNORE INTO ventas (estacion_id, folio, fecha_hora, producto, litros, importe, forma_pago, origen, capturada_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'captura', ?)`,
    [estacionId, venta.folio, venta.fecha_hora, venta.producto ?? null,
     venta.litros ?? null, venta.importe ?? null, venta.forma_pago ?? null, actor]);
  const insertada = resultado.affectedRows > 0;
  await registrarCapturaEnBitacora({
    actor, folio: venta.folio, estacionId,
    resultado: insertada ? 'OK' : 'DUPLICADO',
    detalle: insertada
      ? `Venta capturada: ${venta.producto ?? 's/producto'}, $${venta.importe ?? '—'}`
      : 'Ya existía una venta con ese folio en la estación.',
  });
  return insertada;
}

async function render(res, avisoHTML = '') {
  const estaciones = await consultar('SELECT id, nombre FROM estaciones WHERE activa = 1 ORDER BY id');
  const opciones = (seleccionada) => estaciones.map((e) =>
    `<option value="${e.id}" ${e.nombre === seleccionada ? 'selected' : ''}>${escaparHTML(e.nombre)}</option>`).join('');
  const recientes = await consultar(
    `SELECT v.folio, e.nombre AS estacion, v.fecha_hora, v.producto, v.importe, v.forma_pago, v.capturada_por
     FROM ventas v JOIN estaciones e ON e.id = v.estacion_id
     WHERE v.origen = 'captura' ORDER BY v.id DESC LIMIT 30`);
  const filas = recientes.map((v) => `<tr>
    <td>${escaparHTML(v.folio)}</td><td>${escaparHTML(v.estacion)}</td><td>${formatearFecha(v.fecha_hora)}</td>
    <td>${escaparHTML(v.producto ?? '—')}</td><td>${v.importe != null ? '$' + v.importe : '—'}</td>
    <td>${escaparHTML(v.forma_pago ?? '—')}</td><td>${escaparHTML(v.capturada_por ?? '—')}</td></tr>`).join('');

  res.send(paginaAdmin('Captura de ventas', `
    <h1>Captura de ventas</h1>
    <p>Para estaciones sin importación de ControlGAS (hoy: Oasis). Las ventas capturadas
    entran al flujo normal del motor y del bot.</p>
    ${avisoHTML}
    <h2>Alta individual</h2>
    <form class="linea" method="post" action="/admin/captura">
      <div><label>Estación</label><select name="estacion_id" required>${opciones('Oasis')}</select></div>
      <div><label>Folio</label><input type="text" name="folio" required maxlength="50"></div>
      <div><label>Fecha y hora</label><input type="datetime-local" name="fecha_hora" required></div>
      <div><label>Producto</label><input type="text" name="producto" placeholder="Magna / Premium / Diésel"></div>
      <div><label>Litros</label><input type="text" name="litros" inputmode="decimal"></div>
      <div><label>Importe</label><input type="text" name="importe" inputmode="decimal" required></div>
      <div><label>Forma de pago</label><input type="text" name="forma_pago" placeholder="contado / crédito / vales"></div>
      <button type="submit">Capturar</button>
    </form>
    <h2>Carga por archivo CSV</h2>
    <p>Columnas: <code>folio</code> y <code>fecha_hora</code> (obligatorias); <code>producto</code>,
    <code>litros</code>, <code>importe</code>, <code>forma_pago</code> (opcionales). Un archivo por estación.</p>
    <form class="linea" method="post" action="/admin/captura/csv" enctype="multipart/form-data">
      <div><label>Estación</label><select name="estacion_id" required>${opciones('Oasis')}</select></div>
      <div><label>Archivo CSV</label><input type="file" name="archivo" accept=".csv,text/csv" required></div>
      <button type="submit">Cargar</button>
    </form>
    <h2>Últimas capturas</h2>
    ${filas
      ? `<table><tr><th>Folio</th><th>Estación</th><th>Fecha</th><th>Producto</th><th>Importe</th><th>Pago</th><th>Capturó</th></tr>${filas}</table>`
      : '<p class="vacio">Aún no hay ventas capturadas.</p>'}`));
}

router.get('/captura', async (req, res, next) => {
  try { await render(res); } catch (err) { next(err); }
});

router.post('/captura', async (req, res, next) => {
  try {
    const estacionId = Number(req.body.estacion_id);
    const [estacion] = await consultar('SELECT id, nombre FROM estaciones WHERE id = ? AND activa = 1', [estacionId]);
    const folio = String(req.body.folio ?? '').trim();
    const fecha = new Date(String(req.body.fecha_hora ?? '').replace(' ', 'T'));
    const importe = Number(String(req.body.importe ?? '').replace(/[$\s,]/g, ''));

    if (!estacion) return render(res, '<p class="msj error">Estación no válida.</p>');
    if (!folio) return render(res, '<p class="msj error">El folio es obligatorio.</p>');
    if (Number.isNaN(fecha.getTime())) return render(res, '<p class="msj error">La fecha y hora no son válidas.</p>');
    if (!Number.isFinite(importe) || importe <= 0) return render(res, '<p class="msj error">El importe debe ser un número mayor a cero.</p>');

    const litros = String(req.body.litros ?? '').trim();
    const insertada = await insertarVentaCapturada({
      estacionId,
      venta: {
        folio, fecha_hora: fecha,
        producto: String(req.body.producto ?? '').trim() || null,
        litros: litros ? Number(litros.replace(/[,\s]/g, '')) || null : null,
        importe,
        forma_pago: String(req.body.forma_pago ?? '').trim() || null,
      },
      actor: `admin:${req.actor}`,
    });
    await render(res, insertada
      ? `<p class="msj ok">Venta capturada: folio <strong>${escaparHTML(folio)}</strong> en ${escaparHTML(estacion.nombre)}.</p>`
      : `<p class="msj error">Duplicado: ya existe una venta con el folio <strong>${escaparHTML(folio)}</strong> en ${escaparHTML(estacion.nombre)}. No se capturó de nuevo.</p>`);
  } catch (err) { next(err); }
});

router.post('/captura/csv', subida.single('archivo'), async (req, res, next) => {
  try {
    const estacionId = Number(req.body.estacion_id);
    const [estacion] = await consultar('SELECT id, nombre FROM estaciones WHERE id = ? AND activa = 1', [estacionId]);
    if (!estacion) return render(res, '<p class="msj error">Estación no válida.</p>');
    if (!req.file || !req.file.buffer.length) return render(res, '<p class="msj error">Selecciona un archivo CSV.</p>');

    const fuente = new FuenteManual(req.file.buffer);
    const { ventas, errores } = await fuente.obtenerVentas();

    const rechazadas = errores.map((error) => escaparHTML(error));
    let aceptadas = 0;
    for (const venta of ventas) {
      const insertada = await insertarVentaCapturada({ estacionId, venta, actor: `admin:${req.actor}` });
      if (insertada) aceptadas++;
      else rechazadas.push(`Fila ${venta.fila}: duplicada (folio ${escaparHTML(venta.folio)} ya existe en ${escaparHTML(estacion.nombre)}).`);
    }

    const detalleRechazos = rechazadas.length
      ? `<ul class="errores">${rechazadas.slice(0, 30).map((r) => `<li>${r}</li>`).join('')}${rechazadas.length > 30 ? `<li>… y ${rechazadas.length - 30} más</li>` : ''}</ul>`
      : '';
    await render(res, `<div class="msj ${aceptadas || !rechazadas.length ? 'ok' : 'error'}">
      <strong>${escaparHTML(estacion.nombre)}</strong>: ${aceptadas} ventas aceptadas, ${rechazadas.length} rechazadas.${detalleRechazos}</div>`);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.insertarVentaCapturada = insertarVentaCapturada;
