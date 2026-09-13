// Página pública del padrón: /boletos (SPEC 9-bis, ORDEN 2).
// Sin sesión, sin datos personales: titular enmascarado, teléfono jamás.

const express = require('express');
const { configurada } = require('../lib/db');
const { leerConfiguracion } = require('../lib/configuracion');
const reglas = require('../servicios/reglas-boletos');
const padron = require('../servicios/padron');
const sellado = require('../servicios/sellado');
const modo = require('../servicios/modo-pruebas');
const { escaparHTML } = require('../lib/html');
const { formatearFecha } = require('../lib/fechas'); // hora local (ORDEN 11)

const router = express.Router();


function pagina(cuerpo, { franja = '', titulo = 'Padrón de boletos — Gasolineras Ferez' } = {}) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escaparHTML(titulo)}</title>
<meta name="description" content="Padrón público del sorteo de Gasolineras Ferez: consulta tu boleto y revisa la lista completa.">
<meta name="theme-color" content="#1E2124">
<link rel="icon" type="image/png" href="/logos/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --verde:#12852A; --verde-prof:#0D6B20; --grafito:#1E2124; --blanco:#FFFFFF;
  --gris:#53565A; --papel:#F2F4F1; --linea:#E3E7E1; --linea-osc:#32363A;
  --tinta:#2C2F2B;
  --display:'Archivo Black',system-ui,sans-serif;
  --body:'Barlow',Arial,sans-serif;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--body);background:var(--papel);color:var(--tinta);font-size:17px;line-height:1.6}
a{color:var(--verde-prof)}
.nav{background:var(--grafito);border-bottom:3px solid var(--verde)}
.nav .wrap{max-width:960px;margin:0 auto;padding:0 20px;display:flex;align-items:center;height:64px}
.brand{font-family:var(--display);font-size:18px;letter-spacing:.06em;color:var(--blanco);text-decoration:none}
.portada{background:var(--grafito);color:var(--blanco);padding:40px 20px 44px;text-align:center}
.portada h1{font-family:var(--display);font-weight:400;font-size:clamp(22px,5vw,32px);margin-bottom:6px}
.portada p{color:#C9CEC6;max-width:560px;margin:0 auto}
.contador{font-family:var(--display);font-weight:400;font-size:clamp(52px,14vw,96px);line-height:1.1;color:var(--verde);letter-spacing:.02em}
.contador-nota{font-family:var(--body);font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:13px;color:#C9CEC6;margin-top:2px}
.cerrado{background:#3A2C08;border:1.5px solid #B8860B;color:#F5DFA6;border-radius:10px;padding:12px 16px;max-width:560px;margin:18px auto 0;font-size:15px}
.sellado-banner{background:#0D3D18;border:1.5px solid var(--verde);color:#D9F2DE;border-radius:10px;padding:12px 16px;max-width:560px;margin:18px auto 0;font-size:15px}
.sellado-banner a{color:#9FE8B0;font-weight:700}
.hash{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:clamp(13px,2.6vw,17px);word-break:break-all;background:var(--grafito);color:#9FE8B0;border-radius:10px;padding:16px 18px;text-align:center}
.descargas{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.descargas a{display:inline-block;background:var(--verde);color:var(--blanco);font-weight:700;text-decoration:none;padding:13px 22px;border-radius:8px}
.descargas a:hover{background:var(--verde-prof)}
.verificar{background:var(--blanco);border:1px solid var(--linea);border-radius:10px;padding:16px 18px;overflow-x:auto}
.verificar code{display:block;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;margin:6px 0;white-space:nowrap}
main{max-width:960px;margin:0 auto;padding:32px 20px 64px}
h2{font-family:var(--display);font-weight:400;font-size:20px;margin:34px 0 12px;color:var(--grafito)}
.buscador{display:flex;gap:10px;flex-wrap:wrap}
.buscador input{flex:1;min-width:220px;padding:13px 15px;font-family:var(--body);font-size:17px;border:1.5px solid var(--linea);border-radius:8px;background:var(--blanco)}
.buscador input:focus{border-color:var(--verde);outline:none}
.buscador button{background:var(--verde);color:var(--blanco);font-weight:700;font-size:16px;font-family:var(--body);padding:13px 22px;border:0;border-radius:8px;cursor:pointer}
.buscador button:hover{background:var(--verde-prof)}
.ayuda{font-size:14px;color:var(--gris);margin-top:8px}
.msj{padding:12px 15px;border-radius:8px;margin:14px 0;font-size:15px;background:#FBE9E7;border:1.5px solid #C62828;color:#8E1B12}
.tabla-marco{overflow-x:auto;background:var(--blanco);border:1px solid var(--linea);border-radius:10px}
table{width:100%;border-collapse:collapse;min-width:520px}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--linea);font-size:15px;white-space:nowrap}
th{font-weight:700;color:var(--grafito);background:var(--papel)}
tr:last-child td{border-bottom:0}
td.num{font-weight:700;color:var(--verde-prof)}
.anulado{color:#8E1B12}
.pie-lista{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:14px;font-size:15px}
.pie-lista a{font-weight:700;text-decoration:none}
.vacio{color:var(--gris);font-style:italic;padding:14px 0}
.nota-legal{margin-top:36px;font-size:14px;color:var(--gris);border-top:1px solid var(--linea);padding-top:16px}
footer{background:var(--grafito);color:#C9CEC6;text-align:center;padding:22px 20px;font-size:14px}
footer a{color:#C9CEC6}
</style>
</head>
<body>
${franja}<header class="nav"><div class="wrap"><a class="brand" href="/" aria-label="Gasolineras Ferez, inicio"><img src="/logos/ferez-blanco.png" alt="FEREZ" style="height:40px;width:auto;display:block"></a></div></header>
${cuerpo}
<footer>Servicio Gasolinero Del Campo, S.A. de C.V. · <a href="/aviso-privacidad">Aviso de privacidad</a></footer>
</body>
</html>`;
}

function tablaBoletos(boletos, conTitular) {
  const encabezados = `<tr><th>Boleto</th>${conTitular ? '<th>Titular</th>' : ''}<th>Emisión</th><th>Estación</th><th>Origen</th><th>Estado</th></tr>`;
  const filas = boletos.map((b) => `<tr>
    <td class="num">${escaparHTML(b.boleto)}</td>
    ${conTitular ? `<td>${escaparHTML(b.titular)}</td>` : ''}
    <td>${formatearFecha(b.fecha_emision)}</td>
    <td>${escaparHTML(b.estacion)}</td>
    <td>${escaparHTML(b.origen)}</td>
    <td${b.estado === 'Vigente' ? '' : ' class="anulado"'}>${escaparHTML(b.estado)}</td>
  </tr>`).join('');
  return `<div class="tabla-marco"><table>${encabezados}${filas}</table></div>`;
}

// Página sobria mientras no hay permiso de SEGOB: sin contador, sin lista,
// sin buscador y sin mencionar el sorteo.
const PROXIMAMENTE = `
  <section class="portada">
    <h1>Próximamente</h1>
    <p>Estamos preparando esta sección. Vuelve a visitarnos pronto.</p>
  </section>
  <main><p class="vacio"><a href="/">Volver al inicio</a></p></main>`;
const TITULO_PROXIMAMENTE = 'Próximamente — Gasolineras Ferez';

// Devuelve la franja MODO PRUEBAS si el visitante puede ver el sorteo (modo
// exhibición para todos, o sesión del panel), '' si el sorteo ya es público
// limpio, o null si la petición debe ver "Próximamente" (ORDEN 9 y 12).
async function franjaOModoPruebas(req) {
  const estado = await modo.estadoPublicoSeguro();
  if (estado === 'publico') return '';
  if (estado === 'exhibicion') return modo.franjaHTML();
  if (await modo.sesionDePanel(req)) return modo.franjaHTML();
  return null;
}

router.get('/boletos', async (req, res, next) => {
  try {
    const franja = await franjaOModoPruebas(req);
    if (franja === null) {
      return res.send(pagina(PROXIMAMENTE, { titulo: TITULO_PROXIMAMENTE }));
    }
    if (!configurada()) {
      return res.status(503).send(pagina(`<main>
        <h2>Padrón en preparación</h2>
        <p>El padrón público estará disponible muy pronto. Vuelve a intentarlo más tarde.</p></main>`));
    }

    // Padrón privado (ORDEN 14): el contador y la lista completa revelan la
    // venta diaria; solo sesiones del panel los ven. El público verifica
    // boletos uno por uno.
    const sesionPanel = await modo.sesionDePanel(req);
    const config = await leerConfiguracion();
    const cerrado = reglas.padronCerrado({
      cierrePadron: config.cierre_padron,
      zonaHoraria: config.zona_horaria || 'America/Chihuahua',
    });
    const selloRealInfo = await sellado.selloReal();

    // Búsqueda (pública: resultados individuales enmascarados)
    const textoBusqueda = String(req.query.buscar ?? '').trim();
    let resultadoHTML = '';
    if (textoBusqueda) {
      const busqueda = padron.interpretarBusqueda(textoBusqueda);
      let encontrados = null;
      if (busqueda.tipo === 'boleto') {
        encontrados = await padron.buscarPorBoleto(busqueda.numero);
      } else if (busqueda.tipo === 'telefono') {
        encontrados = await padron.buscarPorTelefono(busqueda.telefono);
      } else {
        resultadoHTML = `<p class="msj">No reconocimos lo que escribiste. Busca con tu número de boleto completo
          (por ejemplo SF27-000123) o con tu teléfono completo a 10 dígitos.</p>`;
      }
      if (encontrados) {
        resultadoHTML = encontrados.length
          ? `<h2>Resultado de tu búsqueda</h2>${tablaBoletos(encontrados, true)}`
          : `<h2>Resultado de tu búsqueda</h2><p class="vacio">No encontramos boletos con ese dato. Revisa que esté completo y correcto.</p>`;
      }
    }

    const avisos = `
        ${cerrado ? `<div class="cerrado">El padrón cerró el ${escaparHTML(config.cierre_padron)} (hora local).
          Ya no se emiten boletos nuevos; la lista queda tal como se selló.</div>` : ''}
        ${selloRealInfo ? `<div class="sellado-banner">El padrón fue sellado el ${escaparHTML(selloRealInfo.fecha_local)}.
          <a href="/boletos/sellado">Conoce aquí el sellado y su huella digital</a>.</div>` : ''}`;

    // Portada: contador solo con sesión del panel.
    let portada;
    if (sesionPanel) {
      const vigentes = await padron.contadorVigentes();
      portada = `
      <section class="portada">
        <h1>Padrón del sorteo</h1>
        <div class="contador">${vigentes.toLocaleString('es-MX')}</div>
        <div class="contador-nota">boletos participando</div>
        <p>Vista de operación (sesión del panel): el público solo ve el buscador individual.</p>
        ${avisos}
      </section>`;
    } else {
      portada = `
      <section class="portada">
        <h1>Verifica tu boleto</h1>
        <p>Cada boleto es verificable aquí en todo momento. El padrón completo se sella y
        deposita ante notario público e inspector de la Secretaría de Gobernación antes
        del sorteo.</p>
        ${avisos}
      </section>`;
    }

    // Lista completa: SOLO con sesión del panel.
    let listaHTML = '';
    if (sesionPanel) {
      const r = await padron.listarPadron(Number(req.query.pagina) || 1);
      const enlacePagina = (n, etiqueta) =>
        `<a href="/boletos?pagina=${n}${textoBusqueda ? `&buscar=${encodeURIComponent(textoBusqueda)}` : ''}#lista">${etiqueta}</a>`;
      listaHTML = `
        <h2 id="lista">Lista completa (${r.total.toLocaleString('es-MX')} boletos)</h2>
        ${r.boletos.length ? tablaBoletos(r.boletos, false) : '<p class="vacio">Aún no hay boletos emitidos.</p>'}
        <div class="pie-lista">
          <span>${r.pagina > 1 ? enlacePagina(r.pagina - 1, '← Anterior') : ''}</span>
          <span>Página ${r.pagina} de ${r.totalPaginas}</span>
          <span>${r.pagina < r.totalPaginas ? enlacePagina(r.pagina + 1, 'Siguiente →') : ''}</span>
        </div>`;
    }

    res.send(pagina(`
      ${portada}
      <main>
        <h2>Busca tu boleto</h2>
        <form class="buscador" method="get" action="/boletos#resultado">
          <input type="text" name="buscar" value="${escaparHTML(textoBusqueda)}"
                 placeholder="SF27-000123 o teléfono a 10 dígitos" aria-label="Número de boleto o teléfono">
          <button type="submit">Buscar</button>
        </form>
        <p class="ayuda">Por privacidad, el titular se muestra solo como primer nombre e inicial del apellido,
        y ningún teléfono se publica.</p>
        ${String(config.numero_permiso ?? '').trim()
          ? `<p class="ayuda">¿Eres el titular? Consulta la <a href="/constancia">constancia electrónica
            de tu boleto</a> con todas las leyendas del permiso.</p>`
          : ''}
        <div id="resultado">${resultadoHTML}</div>
        ${listaHTML}
        <p class="nota-legal">Los boletos anulados se muestran con la leyenda
        "${escaparHTML(padron.MOTIVO_PUBLICO_ANULADO)}" y su número no se reutiliza. El padrón completo se
        sella y deposita ante notario público e inspector de la Secretaría de Gobernación; el sorteo se
        realiza de forma física y presencial ante notario.</p>
      </main>`, { franja }));
  } catch (err) { next(err); }
});

// ---------- Bases del sorteo (placeholder, ORDEN 13) ----------

router.get('/bases', async (req, res, next) => {
  try {
    const franja = await franjaOModoPruebas(req);
    if (franja === null) {
      return res.send(pagina(PROXIMAMENTE, { titulo: TITULO_PROXIMAMENTE }));
    }
    res.send(pagina(`
      <section class="portada">
        <h1>Bases del Sorteo Ferez 2027</h1>
        <p>Participación gratuita con tu carga de combustible.</p>
      </section>
      <main>
        <p>Las bases completas del Sorteo Ferez 2027 se publicarán aquí al inicio de la promoción.</p>
        <p class="nota-legal">Mientras tanto, puedes revisar el <a href="/boletos">padrón público</a>
        y la <a href="/boletos/sellado">verificación y sellado</a> de la lista de boletos.</p>
      </main>`, { franja, titulo: 'Bases del sorteo — Gasolineras Ferez' }));
  } catch (err) { next(err); }
});

// ---------- Sellado del padrón (público) ----------

router.get('/boletos/sellado', async (req, res, next) => {
  try {
    const franja = await franjaOModoPruebas(req);
    if (franja === null) {
      return res.send(pagina(PROXIMAMENTE, { titulo: TITULO_PROXIMAMENTE }));
    }
    if (!configurada()) {
      return res.status(503).send(pagina('<main><h2>Página no disponible por el momento</h2></main>'));
    }
    const sesionPanel = await modo.sesionDePanel(req);
    const sello = await sellado.selloReal();

    if (!sello) {
      const config = await leerConfiguracion();
      return res.send(pagina(`
        <section class="portada">
          <h1>Sellado del padrón</h1>
          <p>Antes del sorteo, el padrón se congela y se deposita ante notario.</p>
        </section>
        <main>
          <h2>Cómo funciona</h2>
          <p>Al cerrar el padrón (${escaparHTML(config.cierre_padron)}, hora local) la lista completa de
          boletos se congela y se calcula su huella digital (SHA-256), que quedará publicada aquí.</p>
          <p>El padrón íntegro se deposita ante notario público y ante el inspector de la Secretaría de
          Gobernación. Cualquier participante puede verificar su boleto en esta página en todo momento,
          y cotejar el padrón depositado en la notaría. El sorteo se realiza de forma física y presencial
          ante notario.</p>
          <p><a href="/boletos">Verificar mi boleto</a></p>
        </main>`, { franja }));
    }

    // Con sellado real: la huella es pública; el archivo, solo para el panel.
    const descargasHTML = sesionPanel ? `
        <h2>Archivos del sellado (sesión del panel)</h2>
        <p>Sellado con ${Number(sello.total).toLocaleString('es-MX')} boletos
        ${sello.notario ? `— depósito: ${escaparHTML(sello.notario)}${sello.acta_notarial ? `, acta ${escaparHTML(sello.acta_notarial)}` : ''}` : ''}.</p>
        <div class="descargas">
          <a href="/boletos/sellado/padron-sf27.csv">Descargar padrón (CSV)</a>
          <a href="/boletos/sellado/acta-sf27.pdf">Descargar acta (PDF)</a>
        </div>
        <h2>Cómo verificar la descarga</h2>
        <div class="verificar">
          <strong>Windows (Símbolo del sistema):</strong>
          <code>certutil -hashfile padron-sf27.csv SHA256</code>
          <strong>Mac o Linux (Terminal):</strong>
          <code>shasum -a 256 padron-sf27.csv</code>
        </div>` : '';

    res.send(pagina(`
      <section class="portada">
        <h1>Padrón sellado</h1>
        <p>El padrón quedó sellado el ${escaparHTML(sello.fecha_local)} (hora local) y depositado
        ante notario público e inspector de la Secretaría de Gobernación. La lista es final.</p>
      </section>
      <main>
        <h2>Huella digital (SHA-256)</h2>
        <p class="hash">${escaparHTML(sello.sha256)}</p>
        <p>Esta huella identifica de forma única la lista sellada: el padrón depositado en la notaría
        produce exactamente esta misma huella. Puedes acudir a la notaría a cotejarla y verificar ahí
        el padrón íntegro; tu boleto, además, es <a href="/boletos">verificable aquí en todo momento</a>.</p>
        ${descargasHTML}
        <p class="nota-legal">El sorteo se realiza de forma física y presencial ante notario.</p>
        <p><a href="/boletos">Volver a la verificación de boletos</a></p>
      </main>`, { franja }));
  } catch (err) { next(err); }
});

// Los artefactos del sellado real se sirven tal cual se generaron,
// SOLO a sesiones del panel (ORDEN 14: el padrón completo no es público).
async function servirArchivoSellado(req, res, archivo) {
  if (!(await modo.sesionDePanel(req))) {
    return res.status(404).send('No disponible.');
  }
  const info = await sellado.selloReal();
  if (!info) return res.status(404).send('El padrón aún no ha sido sellado.');
  const files = await sellado.archivosDeSello(info.id);
  if (archivo === 'acta') {
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'attachment; filename="acta-sf27.pdf"');
    return res.send(files.acta);
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="padron-sf27.csv"');
  res.send(files.csv);
}

router.get('/boletos/sellado/padron-sf27.csv', async (req, res, next) => {
  try { await servirArchivoSellado(req, res, 'csv'); } catch (err) { next(err); }
});
router.get('/boletos/sellado/acta-sf27.pdf', async (req, res, next) => {
  try { await servirArchivoSellado(req, res, 'acta'); } catch (err) { next(err); }
});

module.exports = router;
