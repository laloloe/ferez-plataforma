// Panel básico de administración (SPEC sección 12, paso 4).
// Autenticación HTTP Basic con credenciales en variables de entorno
// (ADMIN_USUARIO, ADMIN_PASSWORD). Los roles diferenciados de la sección 8
// llegarán con el panel completo.

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { configurada, consultar } = require('../lib/db');
const { normalizarTelefono } = require('../lib/telefono');
const { FuenteManual } = require('../fuentes/fuente-manual');
const { escaparHTML, paginaAdmin } = require('../lib/html');

const router = express.Router();
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function comparaSegura(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

router.use((req, res, next) => {
  const usuario = process.env.ADMIN_USUARIO;
  const password = process.env.ADMIN_PASSWORD;
  if (!usuario || !password) {
    return res.status(503).send(paginaAdmin('Panel no configurado',
      '<h1>Panel no configurado</h1><p>Define las variables de entorno <code>ADMIN_USUARIO</code> y <code>ADMIN_PASSWORD</code>.</p>'));
  }
  const cabecera = req.headers.authorization || '';
  if (cabecera.startsWith('Basic ')) {
    const [u, ...resto] = Buffer.from(cabecera.slice(6), 'base64').toString('utf8').split(':');
    if (comparaSegura(u, usuario) && comparaSegura(resto.join(':'), password)) {
      req.actor = u;
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Panel Ferez", charset="UTF-8"');
  return res.status(401).send('Se requiere autenticación.');
});

router.use((req, res, next) => {
  if (!configurada()) {
    return res.status(503).send(paginaAdmin('Sin base de datos',
      '<h1>Base de datos no configurada</h1><p>Define <code>DATABASE_URL</code> (o las variables <code>DB_*</code>) para usar el panel.</p>'));
  }
  next();
});

// ---------- Inicio: resumen ----------
router.get('/', async (req, res, next) => {
  try {
    const [clientes] = await consultar('SELECT COUNT(*) AS total FROM clientes WHERE activo = 1');
    const [ventas] = await consultar('SELECT COUNT(*) AS total FROM ventas');
    const porEstacion = await consultar(
      `SELECT e.nombre, COUNT(v.id) AS ventas
       FROM estaciones e LEFT JOIN ventas v ON v.estacion_id = e.id
       WHERE e.activa = 1 GROUP BY e.id, e.nombre ORDER BY e.id`
    );
    const filas = porEstacion.map((f) =>
      `<tr><td>${escaparHTML(f.nombre)}</td><td>${f.ventas}</td></tr>`).join('');
    res.send(paginaAdmin('Inicio', `
      <h1>Resumen</h1>
      <div class="tarjetas">
        <div class="tarjeta"><b>${clientes.total}</b><span>participantes registrados</span></div>
        <div class="tarjeta"><b>${ventas.total}</b><span>ventas importadas</span></div>
      </div>
      <h2>Ventas por estación</h2>
      <table><tr><th>Estación</th><th>Ventas</th></tr>${filas}</table>`));
  } catch (err) { next(err); }
});

// ---------- Participantes ----------
router.get('/clientes', async (req, res, next) => {
  try {
    const buscar = String(req.query.buscar || '').trim();
    let filasBD;
    if (buscar) {
      const telefono = normalizarTelefono(buscar);
      filasBD = await consultar(
        `SELECT id, telefono, nombre, fecha_registro, activo FROM clientes
         WHERE telefono = ? OR nombre LIKE ? ORDER BY fecha_registro DESC LIMIT 100`,
        [telefono || buscar, `%${buscar}%`]
      );
    } else {
      filasBD = await consultar(
        'SELECT id, telefono, nombre, fecha_registro, activo FROM clientes ORDER BY fecha_registro DESC LIMIT 100'
      );
    }
    const filas = filasBD.map((c) => `<tr>
      <td>${c.id}</td><td>${escaparHTML(c.nombre)}</td><td>${escaparHTML(c.telefono)}</td>
      <td>${formatearFecha(c.fecha_registro)}</td><td>${c.activo ? 'Activo' : 'Inactivo'}</td></tr>`).join('');
    res.send(paginaAdmin('Participantes', `
      <h1>Participantes</h1>
      <form class="linea" method="get" action="/admin/clientes">
        <div><label for="buscar">Buscar por teléfono o nombre</label>
        <input type="text" id="buscar" name="buscar" value="${escaparHTML(buscar)}" placeholder="625 123 4567 o nombre"></div>
        <button type="submit">Buscar</button>
      </form>
      ${filas
        ? `<table><tr><th>ID</th><th>Nombre</th><th>Teléfono</th><th>Registro</th><th>Estado</th></tr>${filas}</table>`
        : '<p class="vacio">Sin resultados.</p>'}`));
  } catch (err) { next(err); }
});

// ---------- Ventas: listado + importación CSV ----------
async function paginaVentas(res, avisoHTML = '') {
  const estaciones = await consultar('SELECT id, nombre FROM estaciones WHERE activa = 1 ORDER BY id');
  const recientes = await consultar(
    `SELECT v.folio, e.nombre AS estacion, v.fecha_hora, v.producto, v.litros, v.importe, v.origen
     FROM ventas v JOIN estaciones e ON e.id = v.estacion_id
     ORDER BY v.fecha_importacion DESC, v.id DESC LIMIT 50`
  );
  const opciones = estaciones.map((e) => `<option value="${e.id}">${escaparHTML(e.nombre)}</option>`).join('');
  const filas = recientes.map((v) => `<tr>
    <td>${escaparHTML(v.folio)}</td><td>${escaparHTML(v.estacion)}</td><td>${formatearFecha(v.fecha_hora)}</td>
    <td>${escaparHTML(v.producto ?? '—')}</td><td>${v.litros ?? '—'}</td><td>${v.importe != null ? '$' + v.importe : '—'}</td>
    <td>${escaparHTML(v.origen)}</td></tr>`).join('');
  res.send(paginaAdmin('Ventas', `
    <h1>Ventas</h1>
    ${avisoHTML}
    <h2>Importar ventas (CSV)</h2>
    <p>Columnas requeridas: <code>folio</code> y <code>fecha_hora</code> (o <code>fecha</code>). Opcionales: <code>producto</code>, <code>litros</code>, <code>importe</code>, <code>forma_pago</code>. Un archivo por estación.</p>
    <form class="linea" method="post" action="/admin/ventas/importar" enctype="multipart/form-data">
      <div><label for="estacion_id">Estación</label>
      <select id="estacion_id" name="estacion_id" required>${opciones}</select></div>
      <div><label for="archivo">Archivo CSV</label>
      <input type="file" id="archivo" name="archivo" accept=".csv,text/csv" required></div>
      <button type="submit">Importar</button>
    </form>
    <h2>Últimas ventas importadas</h2>
    ${filas
      ? `<table><tr><th>Folio</th><th>Estación</th><th>Fecha</th><th>Producto</th><th>Litros</th><th>Importe</th><th>Origen</th></tr>${filas}</table>`
      : '<p class="vacio">Aún no hay ventas importadas.</p>'}`));
}

router.get('/ventas', async (req, res, next) => {
  try { await paginaVentas(res); } catch (err) { next(err); }
});

router.post('/ventas/importar', subida.single('archivo'), async (req, res, next) => {
  try {
    const estacionId = Number(req.body.estacion_id);
    const [estacion] = await consultar('SELECT id, nombre FROM estaciones WHERE id = ? AND activa = 1', [estacionId]);
    if (!estacion) {
      return paginaVentas(res, '<p class="msj error">Estación no válida.</p>');
    }
    if (!req.file || !req.file.buffer.length) {
      return paginaVentas(res, '<p class="msj error">Selecciona un archivo CSV.</p>');
    }

    const fuente = new FuenteManual(req.file.buffer);
    const { ventas, errores } = await fuente.obtenerVentas();

    let insertadas = 0;
    let duplicadas = 0;
    for (const venta of ventas) {
      const resultado = await consultar(
        `INSERT IGNORE INTO ventas (estacion_id, folio, fecha_hora, producto, litros, importe, forma_pago, origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')`,
        [estacionId, venta.folio, venta.fecha_hora, venta.producto, venta.litros, venta.importe, venta.forma_pago ?? null]
      );
      if (resultado.affectedRows > 0) insertadas++; else duplicadas++;
    }

    const listaErrores = errores.length
      ? `<ul class="errores">${errores.slice(0, 20).map((e) => `<li>${escaparHTML(e)}</li>`).join('')}${errores.length > 20 ? `<li>… y ${errores.length - 20} más</li>` : ''}</ul>`
      : '';
    const clase = ventas.length || !errores.length ? 'ok' : 'error';
    await paginaVentas(res, `<div class="msj ${clase}">
      <strong>${escaparHTML(estacion.nombre)}</strong>: ${insertadas} ventas nuevas, ${duplicadas} duplicadas omitidas, ${errores.length} filas con error.${listaErrores}</div>`);
  } catch (err) { next(err); }
});

// Pantallas del motor de boletos (paso 5): parámetros y boletos.
router.use(require('./admin-parametros'));
router.use(require('./admin-boletos'));
router.use(require('./admin-whatsapp'));

function formatearFecha(valor) {
  if (!valor) return '—';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  const dosDigitos = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())} ${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`;
}

// Manejo de errores del panel
router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Error en panel:', err.message);
  res.status(500).send(paginaAdmin('Error', '<h1>Ocurrió un error</h1><p>Revisa los registros del servidor.</p>'));
});

module.exports = router;
