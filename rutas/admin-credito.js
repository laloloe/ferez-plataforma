// Pantalla "Crédito" (ORDEN 15): cuentas de crédito (flotillas) y sus
// teléfonos autorizados. En ventas a crédito los boletos corresponden al
// titular de la cuenta, salvo choferes autorizados con carta de
// consentimiento archivada en oficina. Administrador y operador.

const express = require('express');
const { consultar } = require('../lib/db');
const { normalizarTelefono } = require('../lib/telefono');
const { escaparHTML, paginaAdmin } = require('../lib/html');

const router = express.Router();

async function registrarAjuste(actor, detalle) {
  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, resultado, detalle)
     VALUES (?, 'ajuste', 'CREDITO', ?)`, [actor, detalle.slice(0, 400)]);
}

// ---------- Listado ----------

async function render(res, avisoHTML = '', prellenado = {}) {
  const cuentas = await consultar(
    `SELECT c.*, cl.nombre AS titular_nombre,
            (SELECT COUNT(*) FROM credito_autorizados a WHERE a.cuenta_id = c.id) AS autorizados
     FROM cuentas_credito c
     LEFT JOIN clientes cl ON cl.telefono = c.telefono_titular
     ORDER BY c.codigo`);

  // Códigos de crédito vistos en ventas que aún no tienen cuenta.
  const pendientes = await consultar(
    `SELECT v.cliente_codigo AS codigo, MAX(v.cliente_nombre) AS nombre, COUNT(*) AS ventas
     FROM ventas v
     WHERE v.forma_pago = 'credito' AND v.cliente_codigo IS NOT NULL AND v.cliente_codigo <> ''
       AND NOT EXISTS (SELECT 1 FROM cuentas_credito c WHERE c.codigo = v.cliente_codigo)
     GROUP BY v.cliente_codigo ORDER BY ventas DESC LIMIT 50`);

  const filas = cuentas.map((c) => `<tr>
    <td><a href="/admin/credito/cuenta?id=${c.id}"><strong>${escaparHTML(c.codigo)}</strong></a></td>
    <td>${escaparHTML(c.nombre)}</td>
    <td>${escaparHTML(c.telefono_titular)}${c.titular_nombre ? `<br><small>${escaparHTML(c.titular_nombre)}</small>` : ' <small>(sin registrar como participante)</small>'}</td>
    <td>${c.autorizados}</td>
    <td>${c.activa ? 'Activa' : 'Inactiva'}</td>
    <td><form method="post" action="/admin/credito/estado" style="display:inline">
        <input type="hidden" name="id" value="${c.id}">
        <input type="hidden" name="activa" value="${c.activa ? 0 : 1}">
        <button type="submit">${c.activa ? 'Desactivar' : 'Activar'}</button></form></td></tr>`).join('');

  const filasPendientes = pendientes.map((p) => `<tr>
    <td>${escaparHTML(p.codigo)}</td><td>${escaparHTML(p.nombre ?? '—')}</td><td>${p.ventas}</td>
    <td><a href="/admin/credito?codigo=${encodeURIComponent(p.codigo)}&nombre=${encodeURIComponent(p.nombre ?? '')}#alta">Dar de alta</a></td></tr>`).join('');

  res.send(paginaAdmin('Crédito', `
    <h1>Cuentas de crédito (flotillas)</h1>
    <p>En ventas a crédito, los boletos corresponden al titular de la cuenta; los choferes
    solo pueden reclamar si su teléfono está autorizado con carta de consentimiento.</p>
    ${avisoHTML}
    <h2 id="alta">Alta de cuenta</h2>
    <form class="linea" method="post" action="/admin/credito">
      <div><label>Código (el del export)</label><input type="text" name="codigo" required maxlength="50"
        value="${escaparHTML(prellenado.codigo ?? '')}"></div>
      <div><label>Nombre del cliente</label><input type="text" name="nombre" required maxlength="150"
        value="${escaparHTML(prellenado.nombre ?? '')}"></div>
      <div><label>Teléfono del titular (10 dígitos)</label><input type="tel" name="telefono" required maxlength="16"></div>
      <div><label><input type="checkbox" name="crear_participante" value="1" checked style="width:auto">
        Registrar al titular como participante si no existe</label></div>
      <button type="submit">Registrar cuenta</button>
    </form>
    <h2>Cuentas registradas</h2>
    ${filas
      ? `<table><tr><th>Código</th><th>Cliente</th><th>Titular</th><th>Autorizados</th><th>Estado</th><th></th></tr>${filas}</table>`
      : '<p class="vacio">Aún no hay cuentas registradas.</p>'}
    <h2>Códigos vistos en ventas sin cuenta registrada</h2>
    ${filasPendientes
      ? `<table><tr><th>Código</th><th>Cliente (según export)</th><th>Ventas</th><th></th></tr>${filasPendientes}</table>`
      : '<p class="vacio">Todos los códigos de crédito vistos ya tienen cuenta.</p>'}`));
}

router.get('/credito', async (req, res, next) => {
  try {
    await render(res, '', { codigo: String(req.query.codigo ?? ''), nombre: String(req.query.nombre ?? '') });
  } catch (err) { next(err); }
});

router.post('/credito', async (req, res, next) => {
  try {
    const codigo = String(req.body.codigo ?? '').trim();
    const nombre = String(req.body.nombre ?? '').trim();
    const telefono = normalizarTelefono(String(req.body.telefono ?? ''));
    if (!codigo || !nombre) return render(res, '<p class="msj error">Código y nombre son obligatorios.</p>');
    if (!telefono) return render(res, '<p class="msj error">El teléfono del titular debe ser de 10 dígitos.</p>');

    const [cliente] = await consultar('SELECT id FROM clientes WHERE telefono = ?', [telefono]);
    if (!cliente) {
      if (req.body.crear_participante !== '1') {
        return render(res, `<p class="msj error">El teléfono ${escaparHTML(telefono)} no está registrado como
          participante. Marca la casilla "Registrar al titular como participante" para crearlo junto con la cuenta.</p>`,
        { codigo, nombre });
      }
      await consultar(
        `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
         VALUES (?, ?, 1, NOW())`, [telefono, nombre]);
      await registrarAjuste(`admin:${req.actor}`, `Participante creado desde crédito: ${telefono} (${nombre}).`);
    }

    const resultado = await consultar(
      'INSERT IGNORE INTO cuentas_credito (codigo, nombre, telefono_titular, creada_por) VALUES (?, ?, ?, ?)',
      [codigo, nombre, telefono, req.actor]);
    if (!resultado.affectedRows) {
      return render(res, `<p class="msj error">El código ${escaparHTML(codigo)} ya tiene cuenta registrada.</p>`);
    }
    await registrarAjuste(`admin:${req.actor}`, `Cuenta de crédito registrada: ${codigo} (${nombre}), titular ${telefono}.`);
    await render(res, `<p class="msj ok">Cuenta <strong>${escaparHTML(codigo)}</strong> registrada con titular ${escaparHTML(telefono)}.</p>`);
  } catch (err) { next(err); }
});

router.post('/credito/estado', async (req, res, next) => {
  try {
    const [cuenta] = await consultar('SELECT * FROM cuentas_credito WHERE id = ?', [Number(req.body.id)]);
    if (!cuenta) return render(res, '<p class="msj error">Cuenta no encontrada.</p>');
    const activa = req.body.activa === '1' ? 1 : 0;
    await consultar('UPDATE cuentas_credito SET activa = ? WHERE id = ?', [activa, cuenta.id]);
    await registrarAjuste(`admin:${req.actor}`,
      `Cuenta de crédito ${cuenta.codigo} ${activa ? 'ACTIVADA' : 'desactivada'}.`);
    await render(res, `<p class="msj ok">Cuenta ${escaparHTML(cuenta.codigo)} ${activa ? 'activada' : 'desactivada'}.</p>`);
  } catch (err) { next(err); }
});

// ---------- Detalle de cuenta: teléfonos autorizados ----------

async function renderCuenta(res, cuentaId, avisoHTML = '') {
  const [cuenta] = await consultar(
    `SELECT c.*, cl.nombre AS titular_nombre FROM cuentas_credito c
     LEFT JOIN clientes cl ON cl.telefono = c.telefono_titular WHERE c.id = ?`, [cuentaId]);
  if (!cuenta) {
    return res.status(404).send(paginaAdmin('Crédito', '<h1>Cuenta no encontrada</h1><p><a href="/admin/credito">Volver</a></p>'));
  }
  const autorizados = await consultar(
    `SELECT a.*, cl.nombre AS chofer_nombre FROM credito_autorizados a
     LEFT JOIN clientes cl ON cl.telefono = a.telefono
     WHERE a.cuenta_id = ? ORDER BY a.id`, [cuentaId]);
  const filas = autorizados.map((a) => `<tr>
    <td>${escaparHTML(a.telefono)}${a.chofer_nombre ? `<br><small>${escaparHTML(a.chofer_nombre)}</small>` : ''}</td>
    <td>${escaparHTML(a.referencia_carta)}</td>
    <td>${escaparHTML(a.dado_de_alta_por)}</td>
    <td><form method="post" action="/admin/credito/autorizados/baja" style="display:inline"
          onsubmit="return confirm('¿Dar de baja el teléfono ${escaparHTML(a.telefono)}? Dejará de poder reclamar boletos de esta cuenta.')">
        <input type="hidden" name="id" value="${a.id}"><input type="hidden" name="cuenta_id" value="${cuentaId}">
        <button type="submit" style="background:#FBE9E7;color:#8E1B12;border:1px solid #C62828">Dar de baja</button></form></td></tr>`).join('');

  res.send(paginaAdmin(`Crédito ${cuenta.codigo}`, `
    <h1>Cuenta ${escaparHTML(cuenta.codigo)} — ${escaparHTML(cuenta.nombre)}</h1>
    <p><a href="/admin/credito">← Volver a cuentas</a></p>
    <table>
      <tr><th>Titular</th><td>${escaparHTML(cuenta.telefono_titular)}${cuenta.titular_nombre ? ` — ${escaparHTML(cuenta.titular_nombre)}` : ''}</td></tr>
      <tr><th>Estado</th><td>${cuenta.activa ? 'Activa' : 'Inactiva'}</td></tr>
    </table>
    ${avisoHTML}
    <h2>Teléfonos autorizados (choferes)</h2>
    <p>Cada autorización requiere la referencia de la carta de consentimiento archivada en oficina.</p>
    <form class="linea" method="post" action="/admin/credito/autorizados">
      <input type="hidden" name="cuenta_id" value="${cuentaId}">
      <div><label>Teléfono (10 dígitos)</label><input type="tel" name="telefono" required maxlength="16"></div>
      <div><label>Referencia de la carta</label><input type="text" name="referencia" required maxlength="200"
        placeholder="carta 14-oct-2026, archivada en oficina"></div>
      <button type="submit">Autorizar</button>
    </form>
    ${filas
      ? `<table><tr><th>Teléfono</th><th>Carta de consentimiento</th><th>Autorizó</th><th></th></tr>${filas}</table>`
      : '<p class="vacio">Sin teléfonos autorizados: solo el titular puede reclamar.</p>'}`));
}

router.get('/credito/cuenta', async (req, res, next) => {
  try { await renderCuenta(res, Number(req.query.id)); } catch (err) { next(err); }
});

router.post('/credito/autorizados', async (req, res, next) => {
  try {
    const cuentaId = Number(req.body.cuenta_id);
    const telefono = normalizarTelefono(String(req.body.telefono ?? ''));
    const referencia = String(req.body.referencia ?? '').trim();
    const [cuenta] = await consultar('SELECT codigo FROM cuentas_credito WHERE id = ?', [cuentaId]);
    if (!cuenta) return render(res, '<p class="msj error">Cuenta no encontrada.</p>');
    if (!telefono) return renderCuenta(res, cuentaId, '<p class="msj error">El teléfono debe ser de 10 dígitos.</p>');
    if (!referencia) return renderCuenta(res, cuentaId, '<p class="msj error">La referencia de la carta es obligatoria.</p>');
    const resultado = await consultar(
      'INSERT IGNORE INTO credito_autorizados (cuenta_id, telefono, referencia_carta, dado_de_alta_por) VALUES (?, ?, ?, ?)',
      [cuentaId, telefono, referencia, req.actor]);
    if (!resultado.affectedRows) {
      return renderCuenta(res, cuentaId, `<p class="msj error">El teléfono ${escaparHTML(telefono)} ya está autorizado en esta cuenta.</p>`);
    }
    await registrarAjuste(`admin:${req.actor}`,
      `Autorizado en cuenta ${cuenta.codigo}: ${telefono} (${referencia}).`);
    await renderCuenta(res, cuentaId, `<p class="msj ok">Teléfono ${escaparHTML(telefono)} autorizado.</p>`);
  } catch (err) { next(err); }
});

router.post('/credito/autorizados/baja', async (req, res, next) => {
  try {
    const cuentaId = Number(req.body.cuenta_id);
    const [autorizado] = await consultar(
      `SELECT a.telefono, c.codigo FROM credito_autorizados a
       JOIN cuentas_credito c ON c.id = a.cuenta_id WHERE a.id = ?`, [Number(req.body.id)]);
    if (!autorizado) return renderCuenta(res, cuentaId, '<p class="msj error">Autorización no encontrada.</p>');
    await consultar('DELETE FROM credito_autorizados WHERE id = ?', [Number(req.body.id)]);
    await registrarAjuste(`admin:${req.actor}`,
      `Baja de autorizado en cuenta ${autorizado.codigo}: ${autorizado.telefono}.`);
    await renderCuenta(res, cuentaId, `<p class="msj ok">Teléfono ${escaparHTML(autorizado.telefono)} dado de baja.</p>`);
  } catch (err) { next(err); }
});

module.exports = router;
