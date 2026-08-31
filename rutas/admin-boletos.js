// Pantalla "Boletos": reclamo manual (simula al bot), alta de boleto de
// oficina, listado con filtros y detalle con la venta origen. Se monta
// dentro de /admin (la autenticación vive en rutas/admin.js).

const express = require('express');
const { consultar } = require('../lib/db');
const { normalizarTelefono } = require('../lib/telefono');
const motor = require('../servicios/motor-boletos');
const { escaparHTML, paginaAdmin } = require('../lib/html');

const router = express.Router();

function formatearFecha(valor) {
  if (!valor) return '—';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  const dos = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

const ETIQUETA_ESTADO = { vigente: 'VIGENTE', anulado: 'ANULADO' };

async function render(res, filtros = {}, avisoHTML = '') {
  const estaciones = await consultar('SELECT id, nombre FROM estaciones WHERE activa = 1 ORDER BY id');

  const condiciones = [];
  const parametros = [];
  if (filtros.estacion_id) { condiciones.push('b.estacion_id = ?'); parametros.push(Number(filtros.estacion_id)); }
  if (filtros.estado) { condiciones.push('b.estado = ?'); parametros.push(filtros.estado); }
  if (filtros.origen) { condiciones.push('b.origen = ?'); parametros.push(filtros.origen); }
  if (filtros.cliente) {
    const telefono = normalizarTelefono(filtros.cliente);
    condiciones.push('(c.telefono = ? OR c.nombre LIKE ?)');
    parametros.push(telefono || filtros.cliente, `%${filtros.cliente}%`);
  }
  const boletos = await consultar(
    `SELECT b.folio_boleto, b.numero, b.estado, b.origen, b.fecha_emision,
            c.nombre AS cliente, c.telefono, e.nombre AS estacion, v.folio AS folio_venta
     FROM boletos b
     JOIN clientes c ON c.id = b.cliente_id
     LEFT JOIN estaciones e ON e.id = b.estacion_id
     LEFT JOIN ventas v ON v.id = b.venta_id
     ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
     ORDER BY b.numero DESC LIMIT 200`, parametros);

  const [{ total }] = await consultar('SELECT COUNT(*) AS total FROM boletos');
  const [{ vigentes }] = await consultar("SELECT COUNT(*) AS vigentes FROM boletos WHERE estado = 'vigente'");

  const opciones = estaciones.map((e) => `<option value="${e.id}" ${Number(filtros.estacion_id) === e.id ? 'selected' : ''}>${escaparHTML(e.nombre)}</option>`).join('');
  const filas = boletos.map((b) => `<tr>
    <td><a href="/admin/boletos/detalle?folio=${encodeURIComponent(b.folio_boleto)}">${escaparHTML(b.folio_boleto)}</a></td>
    <td>${ETIQUETA_ESTADO[b.estado] ?? b.estado}</td><td>${escaparHTML(b.origen)}</td>
    <td>${escaparHTML(b.cliente)}<br><small>${escaparHTML(b.telefono)}</small></td>
    <td>${escaparHTML(b.estacion ?? '—')}</td><td>${escaparHTML(b.folio_venta ?? '—')}</td>
    <td>${formatearFecha(b.fecha_emision)}</td></tr>`).join('');

  res.send(paginaAdmin('Boletos', `
    <h1>Boletos</h1>
    <div class="tarjetas">
      <div class="tarjeta"><b>${total}</b><span>boletos emitidos</span></div>
      <div class="tarjeta"><b>${vigentes}</b><span>vigentes</span></div>
    </div>
    ${avisoHTML}
    <h2>Reclamar folio (simula al bot)</h2>
    <form class="linea" method="post" action="/admin/boletos/reclamar">
      <div><label>Teléfono del cliente</label><input type="tel" name="telefono" required placeholder="625 123 4567"></div>
      <div><label>Folio del ticket</label><input type="text" name="folio" required></div>
      <div><label>Estación</label><select name="estacion_id" required>${opciones}</select></div>
      <button type="submit">Reclamar</button>
    </form>
    <h2>Boleto de oficina</h2>
    <form class="linea" method="post" action="/admin/boletos/oficina"
          onsubmit="return confirm('¿Emitir boleto de oficina para ' + this.nombre.value + '?')">
      <div><label>Nombre</label><input type="text" name="nombre" required></div>
      <div><label>Teléfono</label><input type="tel" name="telefono" required></div>
      <div><label>Número de recibo</label><input type="text" name="recibo" required></div>
      <button type="submit">Emitir</button>
    </form>
    <h2>Listado</h2>
    <form class="linea" method="get" action="/admin/boletos">
      <div><label>Estación</label><select name="estacion_id"><option value="">Todas</option>${opciones}</select></div>
      <div><label>Estado</label><select name="estado"><option value="">Todos</option>
        <option value="vigente" ${filtros.estado === 'vigente' ? 'selected' : ''}>Vigente</option>
        <option value="anulado" ${filtros.estado === 'anulado' ? 'selected' : ''}>Anulado</option></select></div>
      <div><label>Origen</label><select name="origen"><option value="">Todos</option>
        <option value="reclamo" ${filtros.origen === 'reclamo' ? 'selected' : ''}>Reclamo</option>
        <option value="compra" ${filtros.origen === 'compra' ? 'selected' : ''}>Compra (oficina)</option></select></div>
      <div><label>Cliente (teléfono o nombre)</label><input type="text" name="cliente" value="${escaparHTML(filtros.cliente ?? '')}"></div>
      <button type="submit">Filtrar</button>
    </form>
    ${filas
      ? `<table><tr><th>Boleto</th><th>Estado</th><th>Origen</th><th>Cliente</th><th>Estación</th><th>Folio venta</th><th>Emisión</th></tr>${filas}</table>`
      : '<p class="vacio">Sin boletos con esos filtros.</p>'}`));
}

router.get('/boletos', async (req, res, next) => {
  try { await render(res, req.query); } catch (err) { next(err); }
});

router.post('/boletos/reclamar', async (req, res, next) => {
  try {
    const resultado = await motor.reclamarFolio({
      telefono: req.body.telefono, folio: req.body.folio,
      estacionId: req.body.estacion_id, actor: `admin:${req.actor}`,
    });
    const aviso = resultado.ok
      ? `<p class="msj ok">Emitidos ${resultado.cantidad} boleto(s) para ${escaparHTML(resultado.cliente)}: <strong>${resultado.boletos.map(escaparHTML).join(', ')}</strong></p>`
      : `<p class="msj error"><strong>${escaparHTML(resultado.codigo)}</strong> — ${escaparHTML(resultado.mensaje)}</p>`;
    await render(res, {}, aviso);
  } catch (err) { next(err); }
});

router.post('/boletos/oficina', async (req, res, next) => {
  try {
    const resultado = await motor.emitirBoletoOficina({
      nombre: req.body.nombre, telefono: req.body.telefono,
      recibo: req.body.recibo, actor: `admin:${req.actor}`,
    });
    const aviso = resultado.ok
      ? `<p class="msj ok">Boleto de oficina emitido: <strong>${resultado.boletos.map(escaparHTML).join(', ')}</strong> (recibo ${escaparHTML(String(req.body.recibo ?? ''))})</p>`
      : `<p class="msj error"><strong>${escaparHTML(resultado.codigo)}</strong> — ${escaparHTML(resultado.mensaje)}</p>`;
    await render(res, {}, aviso);
  } catch (err) { next(err); }
});

router.get('/boletos/detalle', async (req, res, next) => {
  try {
    const folio = String(req.query.folio ?? '');
    const [boleto] = await consultar(
      `SELECT b.*, c.nombre AS cliente, c.telefono, e.nombre AS estacion,
              v.id AS venta_id, v.folio AS folio_venta, v.fecha_hora AS venta_fecha,
              v.producto, v.litros, v.importe, v.forma_pago, v.estado AS venta_estado,
              em.tipo AS emision_tipo, em.recibo, em.actor AS emision_actor, em.fecha AS emision_fecha
       FROM boletos b
       JOIN clientes c ON c.id = b.cliente_id
       LEFT JOIN estaciones e ON e.id = b.estacion_id
       LEFT JOIN ventas v ON v.id = b.venta_id
       LEFT JOIN emisiones em ON em.id = b.emision_id
       WHERE b.folio_boleto = ?`, [folio]);
    if (!boleto) {
      return res.status(404).send(paginaAdmin('Boleto', '<h1>Boleto no encontrado</h1><p><a href="/admin/boletos">Volver al listado</a></p>'));
    }
    const ventaHTML = boleto.venta_id ? `
      <h2>Venta origen</h2>
      <table>
        <tr><th>Folio</th><td>${escaparHTML(boleto.folio_venta)}</td></tr>
        <tr><th>Fecha</th><td>${formatearFecha(boleto.venta_fecha)}</td></tr>
        <tr><th>Producto</th><td>${escaparHTML(boleto.producto ?? '—')}</td></tr>
        <tr><th>Litros</th><td>${boleto.litros ?? '—'}</td></tr>
        <tr><th>Importe</th><td>${boleto.importe != null ? '$' + boleto.importe : '—'}</td></tr>
        <tr><th>Forma de pago</th><td>${escaparHTML(boleto.forma_pago ?? '—')}</td></tr>
        <tr><th>Estado de la venta</th><td>${escaparHTML(boleto.venta_estado)}</td></tr>
      </table>
      ${boleto.venta_estado === 'normal' ? `
      <form class="linea" method="post" action="/admin/boletos/marcar-venta"
            onsubmit="return confirm('Esto anulará TODOS los boletos de la venta ' + ${JSON.stringify(escaparHTML(boleto.folio_venta))} + '. ¿Continuar?')">
        <input type="hidden" name="venta_id" value="${boleto.venta_id}">
        <input type="hidden" name="volver" value="${escaparHTML(folio)}">
        <div><label>Marcar venta como</label><select name="estado">
          <option value="cancelada">Cancelada</option><option value="devuelta">Devuelta</option></select></div>
        <button type="submit">Marcar y anular boletos</button>
      </form>` : ''}` : `
      <h2>Compra en oficina</h2>
      <table><tr><th>Recibo</th><td>${escaparHTML(boleto.recibo ?? '—')}</td></tr></table>`;

    res.send(paginaAdmin(`Boleto ${boleto.folio_boleto}`, `
      <h1>Boleto ${escaparHTML(boleto.folio_boleto)}</h1>
      <p><a href="/admin/boletos">← Volver al listado</a></p>
      <table>
        <tr><th>Número</th><td>${boleto.numero}</td></tr>
        <tr><th>Estado</th><td>${ETIQUETA_ESTADO[boleto.estado] ?? boleto.estado}${boleto.estado === 'anulado' ? ` — ${escaparHTML(boleto.motivo_anulacion ?? '')} (${formatearFecha(boleto.fecha_anulacion)})` : ''}</td></tr>
        <tr><th>Origen</th><td>${escaparHTML(boleto.origen)}</td></tr>
        <tr><th>Cliente</th><td>${escaparHTML(boleto.cliente)} · ${escaparHTML(boleto.telefono)}</td></tr>
        <tr><th>Estación</th><td>${escaparHTML(boleto.estacion ?? '—')}</td></tr>
        <tr><th>Emisión</th><td>${formatearFecha(boleto.emision_fecha)} por ${escaparHTML(boleto.emision_actor ?? '—')}</td></tr>
      </table>
      ${boleto.estado === 'vigente' ? `
      <h2>Anular este boleto</h2>
      <form class="linea" method="post" action="/admin/boletos/anular"
            onsubmit="return confirm('¿Anular el boleto ${escaparHTML(boleto.folio_boleto)}? El número no se libera.')">
        <input type="hidden" name="folio_boleto" value="${escaparHTML(boleto.folio_boleto)}">
        <div><label>Motivo</label><input type="text" name="motivo" required></div>
        <button type="submit">Anular</button>
      </form>` : ''}
      ${ventaHTML}`));
  } catch (err) { next(err); }
});

// Bitácora consultable: cada emisión, rechazo y anulación (ORDEN 2, remate).
router.get('/bitacora', async (req, res, next) => {
  try {
    const condiciones = [];
    const parametros = [];
    if (req.query.tipo) { condiciones.push('tipo = ?'); parametros.push(req.query.tipo); }
    if (req.query.resultado) { condiciones.push('resultado = ?'); parametros.push(req.query.resultado); }
    const filasBD = await consultar(
      `SELECT fecha, actor, tipo, telefono, folio_venta, resultado, detalle, boletos_generados
       FROM bitacora_boletos ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
       ORDER BY id DESC LIMIT 200`, parametros);
    const resultados = await consultar('SELECT DISTINCT resultado FROM bitacora_boletos ORDER BY resultado');
    const opciones = resultados.map((r) =>
      `<option value="${escaparHTML(r.resultado)}" ${req.query.resultado === r.resultado ? 'selected' : ''}>${escaparHTML(r.resultado)}</option>`).join('');
    const filas = filasBD.map((f) => `<tr>
      <td>${formatearFecha(f.fecha)}</td><td>${escaparHTML(f.actor)}</td><td>${escaparHTML(f.tipo)}</td>
      <td>${escaparHTML(f.telefono ?? '—')}</td><td>${escaparHTML(f.folio_venta ?? '—')}</td>
      <td>${escaparHTML(f.resultado)}</td><td>${f.boletos_generados}</td>
      <td style="white-space:normal">${escaparHTML(f.detalle ?? '')}</td></tr>`).join('');
    res.send(paginaAdmin('Bitácora', `
      <h1>Bitácora del motor</h1>
      <form class="linea" method="get" action="/admin/bitacora">
        <div><label>Tipo</label><select name="tipo"><option value="">Todos</option>
          <option value="reclamo" ${req.query.tipo === 'reclamo' ? 'selected' : ''}>Reclamo</option>
          <option value="compra" ${req.query.tipo === 'compra' ? 'selected' : ''}>Compra</option>
          <option value="anulacion" ${req.query.tipo === 'anulacion' ? 'selected' : ''}>Anulación</option></select></div>
        <div><label>Resultado</label><select name="resultado"><option value="">Todos</option>${opciones}</select></div>
        <button type="submit">Filtrar</button>
      </form>
      ${filas
        ? `<table><tr><th>Fecha</th><th>Actor</th><th>Tipo</th><th>Teléfono</th><th>Folio</th><th>Resultado</th><th>Boletos</th><th>Detalle</th></tr>${filas}</table>`
        : '<p class="vacio">Sin movimientos con esos filtros.</p>'}`));
  } catch (err) { next(err); }
});

router.post('/boletos/anular', async (req, res, next) => {
  try {
    const resultado = await motor.anularBoleto({
      folioBoleto: req.body.folio_boleto, motivo: req.body.motivo, actor: `admin:${req.actor}`,
    });
    if (!resultado.ok) return render(res, {}, `<p class="msj error">${escaparHTML(resultado.mensaje)}</p>`);
    res.redirect(`/admin/boletos/detalle?folio=${encodeURIComponent(req.body.folio_boleto)}`);
  } catch (err) { next(err); }
});

router.post('/boletos/marcar-venta', async (req, res, next) => {
  try {
    const resultado = await motor.marcarVenta({
      ventaId: Number(req.body.venta_id), estado: req.body.estado, actor: `admin:${req.actor}`,
    });
    if (!resultado.ok) return render(res, {}, `<p class="msj error">${escaparHTML(resultado.mensaje)}</p>`);
    res.redirect(`/admin/boletos/detalle?folio=${encodeURIComponent(req.body.volver ?? '')}`);
  } catch (err) { next(err); }
});

module.exports = router;
