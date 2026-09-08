// Página pública /constancia (ORDEN 8): constancia electrónica del boleto.
// Solo boleto + teléfono correctos muestran la constancia; los fallos
// devuelven un mensaje genérico que no revela si el boleto existe.
// Mientras numero_permiso esté vacío, la constancia lleva la marca
// "EN TRÁMITE — DOCUMENTO SIN VALIDEZ" y el sitio no enlaza esta página.

const express = require('express');
const { configurada } = require('../lib/db');
const { leerConfiguracion } = require('../lib/configuracion');
const constancia = require('../servicios/constancia');
const { escaparHTML } = require('../lib/html');

const router = express.Router();

function formatearFecha(valor) {
  if (!valor) return '—';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}/${fecha.getFullYear()} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

function pagina(cuerpo) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Constancia electrónica del boleto — Gasolineras Ferez</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#1E2124">
<link rel="icon" type="image/png" href="/logos/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --verde:#12852A; --verde-prof:#0D6B20; --grafito:#1E2124; --blanco:#FFFFFF;
  --gris:#53565A; --papel:#F2F4F1; --linea:#E3E7E1; --tinta:#2C2F2B;
  --display:'Archivo Black',system-ui,sans-serif;
  --body:'Barlow',Arial,sans-serif;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--body);background:var(--papel);color:var(--tinta);font-size:17px;line-height:1.6}
a{color:var(--verde-prof)}
.nav{background:var(--grafito);border-bottom:3px solid var(--verde)}
.nav .wrap{max-width:760px;margin:0 auto;padding:0 20px;display:flex;align-items:center;height:64px}
.brand{text-decoration:none}
main{max-width:760px;margin:0 auto;padding:32px 20px 64px;position:relative}
h1{font-family:var(--display);font-weight:400;font-size:clamp(22px,5vw,30px);color:var(--grafito);margin-bottom:8px}
h2{font-family:var(--display);font-weight:400;font-size:19px;margin:30px 0 10px;color:var(--grafito)}
.intro{color:var(--gris);max-width:640px}
form.consulta{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin:22px 0}
form.consulta label{display:block;font-size:14px;font-weight:600;margin-bottom:4px}
form.consulta input{padding:13px 15px;font-family:var(--body);font-size:17px;border:1.5px solid var(--linea);border-radius:8px;background:var(--blanco);min-width:230px}
form.consulta input:focus{border-color:var(--verde);outline:none}
form.consulta button{background:var(--verde);color:var(--blanco);font-weight:700;font-size:16px;font-family:var(--body);padding:13px 22px;border:0;border-radius:8px;cursor:pointer}
form.consulta button:hover{background:var(--verde-prof)}
.msj{padding:12px 15px;border-radius:8px;margin:14px 0;font-size:15px;background:#FBE9E7;border:1.5px solid #C62828;color:#8E1B12}
.constancia{background:var(--blanco);border:1px solid var(--linea);border-radius:12px;padding:26px 28px;margin:20px 0;position:relative;overflow:hidden}
.constancia .denominacion{font-weight:700;color:var(--grafito)}
.constancia .permiso{margin:12px 0;padding:10px 14px;border-radius:8px;background:#EEF7EF;border:1.5px solid var(--verde-prof);font-weight:600}
.constancia .permiso.tramite{background:#FBE9E7;border-color:#C62828;color:#8E1B12}
table.datos{width:100%;border-collapse:collapse;margin:14px 0}
table.datos th,table.datos td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--linea);font-size:15px}
table.datos th{width:44%;color:var(--grafito)}
ul.leyendas{margin:8px 0 0 20px;font-size:14.5px}
ul.leyendas li{margin-bottom:6px}
.marca-agua{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:2}
.marca-agua span{transform:rotate(-28deg);font-family:var(--display);font-size:clamp(24px,6vw,52px);color:rgba(198,40,40,.14);text-align:center;line-height:1.3}
.acciones{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.acciones a,.acciones button{display:inline-block;background:var(--verde);color:var(--blanco);font-weight:700;text-decoration:none;font-size:15px;font-family:var(--body);padding:12px 20px;border:0;border-radius:8px;cursor:pointer}
.acciones a:hover,.acciones button:hover{background:var(--verde-prof)}
.nota{font-size:14px;color:var(--gris);margin-top:8px}
footer{background:var(--grafito);color:#C9CEC6;text-align:center;padding:22px 20px;font-size:14px}
footer a{color:#C9CEC6}
@media print{
  .nav,footer,.no-imprimir{display:none !important}
  body{background:#fff}
  main{padding:0}
  .constancia{border:1px solid #999;border-radius:0}
}
</style>
</head>
<body>
<header class="nav"><div class="wrap"><a class="brand" href="/" aria-label="Gasolineras Ferez, inicio"><img src="/logos/ferez-blanco.png" alt="FEREZ" style="height:40px;width:auto;display:block"></a></div></header>
<main>
${cuerpo}
</main>
<footer>Estación de Servicio Ferez, S.A. de C.V. · <a href="/aviso-privacidad">Aviso de privacidad</a></footer>
</body>
</html>`;
}

const MENSAJE_GENERICO =
  'No pudimos validar la constancia con los datos proporcionados. Revisa que el número de ' +
  'boleto esté completo (por ejemplo SF27-000123) y que el teléfono sea el mismo con el que ' +
  'te registraste, e inténtalo de nuevo.';
const MENSAJE_LIMITE =
  'Has hecho demasiadas consultas en poco tiempo. Espera una hora e inténtalo de nuevo.';

function formularioHTML(boletoPrellenado = '') {
  return `
    <h1>Constancia electrónica del boleto</h1>
    <p class="intro">Consulta el registro electrónico de tu boleto del Sorteo Ferez 2027,
    con todos sus datos y leyendas. Escribe tu número de boleto y el teléfono a 10 dígitos
    con el que te registraste.</p>
    <form class="consulta no-imprimir" method="post" action="/constancia">
      <div><label for="boleto">Número de boleto</label>
        <input id="boleto" type="text" name="boleto" value="${escaparHTML(boletoPrellenado)}"
               placeholder="SF27-000123" required maxlength="20"></div>
      <div><label for="telefono">Teléfono del titular</label>
        <input id="telefono" type="tel" name="telefono" placeholder="10 dígitos" required
               maxlength="16" autocomplete="off"></div>
      <button type="submit">Consultar</button>
    </form>
    <p class="nota no-imprimir">Por tu privacidad, la constancia solo se muestra si ambos
    datos coinciden. Ningún teléfono se publica.</p>`;
}

function constanciaHTML(datos, config) {
  const { condicion, fijas } = constancia.leyendas(config);
  const enTramite = constancia.permisoEnTramite(config);
  return `
    <section class="constancia">
      ${enTramite ? '<div class="marca-agua" aria-hidden="true"><span>EN TRÁMITE<br>DOCUMENTO SIN VALIDEZ</span></div>' : ''}
      <p class="denominacion">${escaparHTML(constancia.DENOMINACION)}</p>
      <p class="permiso${enTramite ? ' tramite' : ''}">${escaparHTML(constancia.textoPermiso(config))}</p>
      <table class="datos">
        <tr><th>Número de boleto</th><td><strong>${escaparHTML(datos.boleto)}</strong></td></tr>
        <tr><th>Folio de la operación</th><td>${escaparHTML(datos.folio_operacion)}</td></tr>
        <tr><th>Fecha y hora de emisión</th><td>${formatearFecha(datos.fecha_emision)}</td></tr>
        <tr><th>Estación</th><td>${escaparHTML(datos.estacion)}</td></tr>
        <tr><th>Origen</th><td>${escaparHTML(datos.origen)}</td></tr>
        <tr><th>Estado</th><td>${escaparHTML(datos.estado)}</td></tr>
        <tr><th>Monto elegible de la operación</th><td>${datos.monto != null ? '$' + datos.monto.toLocaleString('es-MX', { minimumFractionDigits: 2 }) : '—'}</td></tr>
        <tr><th>Titular</th><td>${escaparHTML(datos.titular)}</td></tr>
        <tr><th>Vigencia de la promoción</th><td>${escaparHTML(config.vigencia_promocion ?? '—')}</td></tr>
        <tr><th>Fecha del sorteo</th><td>${escaparHTML(config.fecha_sorteo ?? '—')}</td></tr>
      </table>
      <p>${escaparHTML(condicion)}</p>
      <h2>Leyendas</h2>
      <ul class="leyendas">${fijas.map((l) => `<li>${escaparHTML(l)}</li>`).join('')}</ul>
      <p class="nota">Consulta el padrón público en <a href="/boletos">ferez.mx/boletos</a>
      y las bases en <a href="/bases">ferez.mx/bases</a>.</p>
    </section>
    <div class="acciones no-imprimir">
      <button type="button" onclick="window.print()">Imprimir constancia</button>
      <a href="/constancia">Consultar otro boleto</a>
    </div>`;
}

router.get('/constancia', async (req, res, next) => {
  try {
    if (!configurada()) {
      return res.status(503).send(pagina('<h1>Constancia no disponible</h1><p>Inténtalo más tarde.</p>'));
    }
    res.send(pagina(formularioHTML(String(req.query.boleto ?? ''))));
  } catch (err) { next(err); }
});

router.post('/constancia', async (req, res, next) => {
  try {
    if (!configurada()) {
      return res.status(503).send(pagina('<h1>Constancia no disponible</h1><p>Inténtalo más tarde.</p>'));
    }
    const boleto = String(req.body.boleto ?? '').trim();
    const resultado = await constancia.consultarConstancia({
      boleto,
      telefono: req.body.telefono,
      ip: req.ip,
    });
    if (!resultado.ok) {
      const mensaje = resultado.codigo === 'LIMITE_EXCEDIDO' ? MENSAJE_LIMITE : MENSAJE_GENERICO;
      return res.send(pagina(`${formularioHTML(boleto)}<p class="msj">${escaparHTML(mensaje)}</p>`));
    }
    const config = await leerConfiguracion();
    res.send(pagina(`
      <h1 class="no-imprimir">Constancia electrónica del boleto</h1>
      ${constanciaHTML(resultado.constancia, config)}`));
  } catch (err) { next(err); }
});

module.exports = router;
