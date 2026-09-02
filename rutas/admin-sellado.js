// Pantalla "Sellado" (ORDEN 5): simulacro repetible y sellado real único
// con doble confirmación (palabra escrita + diálogo). Se monta dentro de
// /admin (la autenticación vive en rutas/admin.js).

const express = require('express');
const { leerConfiguracion } = require('../lib/configuracion');
const reglas = require('../servicios/reglas-boletos');
const sellado = require('../servicios/sellado');
const { escaparHTML, paginaAdmin } = require('../lib/html');

const router = express.Router();

async function render(res, avisoHTML = '') {
  const config = await leerConfiguracion();
  const zonaHoraria = config.zona_horaria || 'America/Chihuahua';
  const cerrado = reglas.padronCerrado({ cierrePadron: config.cierre_padron, zonaHoraria });
  const real = await sellado.selloReal();
  const sellos = await sellado.listarSellos();

  const filas = sellos.map((sello) => `<tr>
    <td>${sello.id}</td>
    <td>${sello.tipo === 'real' ? '<strong>REAL</strong>' : 'Simulacro'}</td>
    <td>${escaparHTML(sello.fecha_local)}</td>
    <td>${escaparHTML(sello.actor)}</td>
    <td>${sello.total}</td>
    <td><code style="font-size:11px">${escaparHTML(sello.sha256)}</code></td>
    <td><a href="/admin/sellado/descarga?id=${sello.id}&archivo=csv">CSV</a> ·
        <a href="/admin/sellado/descarga?id=${sello.id}&archivo=acta">Acta</a></td>
  </tr>`).join('');

  res.send(paginaAdmin('Sellado', `
    <h1>Sellado del padrón</h1>
    <div class="tarjetas">
      <div class="tarjeta"><b>${escaparHTML(config.cierre_padron)}</b><span>cierre del padrón (${escaparHTML(zonaHoraria)})</span></div>
      <div class="tarjeta"><b>${cerrado ? 'CERRADO' : 'ABIERTO'}</b><span>estado del padrón</span></div>
      <div class="tarjeta"><b>${real ? 'EJECUTADO' : 'Pendiente'}</b><span>sellado real</span></div>
    </div>
    ${avisoHTML}
    ${real ? `<p class="msj ok">Sellado real #${real.id} ejecutado el ${escaparHTML(real.fecha_local)} por ${escaparHTML(real.actor)}.
      SHA-256: <code>${escaparHTML(real.sha256)}</code>. El padrón es final: emisiones y anulaciones están bloqueadas.
      Público en <a href="/boletos/sellado">/boletos/sellado</a>.</p>` : ''}

    <h2>Simulacro de sellado</h2>
    <p>Genera CSV y acta marcados "PRUEBA — SIN VALIDEZ". No congela nada y puede repetirse cuantas veces se quiera.</p>
    <form class="linea" method="post" action="/admin/sellado/simulacro">
      <button type="submit">Ejecutar simulacro</button>
    </form>

    ${real ? '' : `
    <h2>Sellado real</h2>
    <p><strong>Único e irreversible.</strong> Solo procede con el padrón cerrado. Congela el padrón:
    después no se emite ni se anula nada.</p>
    <form class="linea" method="post" action="/admin/sellado/real"
          onsubmit="return confirm('SEGUNDA CONFIRMACIÓN: el sellado real es único e irreversible. ¿Ejecutarlo ahora?')">
      <div><label>Escribe SELLAR para confirmar</label>
      <input type="text" name="confirmacion" autocomplete="off" placeholder="SELLAR" required></div>
      <button type="submit">Ejecutar sellado real</button>
    </form>`}

    <h2>Historial</h2>
    ${filas
      ? `<table><tr><th>#</th><th>Tipo</th><th>Fecha local</th><th>Ejecutó</th><th>Boletos</th><th>SHA-256</th><th>Archivos</th></tr>${filas}</table>`
      : '<p class="vacio">Aún no se ha ejecutado ningún sellado.</p>'}`));
}

router.get('/sellado', async (req, res, next) => {
  try { await render(res); } catch (err) { next(err); }
});

router.post('/sellado/simulacro', async (req, res, next) => {
  try {
    const resultado = await sellado.ejecutarSellado('simulacro', `admin:${req.actor}`);
    await render(res, `<p class="msj ok">Simulacro #${resultado.id} generado: ${resultado.total} boletos,
      SHA-256 <code>${escaparHTML(resultado.sha256)}</code>.
      <a href="/admin/sellado/descarga?id=${resultado.id}&archivo=csv">Descargar CSV</a> ·
      <a href="/admin/sellado/descarga?id=${resultado.id}&archivo=acta">Descargar acta</a></p>`);
  } catch (err) { next(err); }
});

router.post('/sellado/real', async (req, res, next) => {
  try {
    if (String(req.body.confirmacion ?? '').trim().toUpperCase() !== 'SELLAR') {
      return render(res, '<p class="msj error">Confirmación incorrecta: escribe SELLAR para ejecutar el sellado real.</p>');
    }
    const resultado = await sellado.ejecutarSellado('real', `admin:${req.actor}`);
    if (!resultado.ok && resultado.mensaje) {
      return render(res, `<p class="msj error">${escaparHTML(resultado.mensaje)}</p>`);
    }
    await render(res, `<p class="msj ok"><strong>Sellado real ejecutado.</strong> ${resultado.total} boletos,
      SHA-256 <code>${escaparHTML(resultado.sha256)}</code>. El padrón es final.</p>`);
  } catch (err) { next(err); }
});

router.get('/sellado/descarga', async (req, res, next) => {
  try {
    const sello = await sellado.archivosDeSello(Number(req.query.id));
    if (!sello) return res.status(404).send('Sellado no encontrado');
    const marca = sello.tipo === 'real' ? 'sf27' : `simulacro-${req.query.id}`;
    if (req.query.archivo === 'acta') {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="acta-${marca}.pdf"`);
      return res.send(sello.acta);
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="padron-${marca}.csv"`);
    res.send(sello.csv);
  } catch (err) { next(err); }
});

module.exports = router;
