// Página pública del padrón: /boletos (SPEC 9-bis, ORDEN 2).
// Sin sesión, sin datos personales: titular enmascarado, teléfono jamás.

const express = require('express');
const { configurada } = require('../lib/db');
const { leerConfiguracion } = require('../lib/configuracion');
const reglas = require('../servicios/reglas-boletos');
const padron = require('../servicios/padron');
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
<title>Padrón de boletos — Gasolineras Ferez</title>
<meta name="description" content="Padrón público del sorteo de Gasolineras Ferez: consulta tu boleto y revisa la lista completa.">
<meta name="theme-color" content="#1E2124">
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
<header class="nav"><div class="wrap"><a class="brand" href="/">GASOLINERAS FEREZ</a></div></header>
${cuerpo}
<footer>Estación de Servicio Ferez, S.A. de C.V. · <a href="/aviso-privacidad">Aviso de privacidad</a></footer>
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

router.get('/boletos', async (req, res, next) => {
  try {
    if (!configurada()) {
      return res.status(503).send(pagina(`<main>
        <h2>Padrón en preparación</h2>
        <p>El padrón público estará disponible muy pronto. Vuelve a intentarlo más tarde.</p></main>`));
    }

    const config = await leerConfiguracion();
    const cerrado = reglas.padronCerrado({
      cierrePadron: config.cierre_padron,
      zonaHoraria: config.zona_horaria || 'America/Chihuahua',
    });
    const vigentes = await padron.contadorVigentes();

    // Búsqueda
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

    // Lista completa paginada
    const { total, paginaActual, totalPaginas, boletos } = await (async () => {
      const r = await padron.listarPadron(Number(req.query.pagina) || 1);
      return { total: r.total, paginaActual: r.pagina, totalPaginas: r.totalPaginas, boletos: r.boletos };
    })();

    const enlacePagina = (n, etiqueta) =>
      `<a href="/boletos?pagina=${n}${textoBusqueda ? `&buscar=${encodeURIComponent(textoBusqueda)}` : ''}#lista">${etiqueta}</a>`;

    res.send(pagina(`
      <section class="portada">
        <h1>Padrón público del sorteo</h1>
        <div class="contador">${vigentes.toLocaleString('es-MX')}</div>
        <div class="contador-nota">boletos participando</div>
        <p>Cada carga que alcanza el monto genera boletos. Aquí está la lista completa:
        puedes contar, comparar y encontrar el tuyo.</p>
        ${cerrado ? `<div class="cerrado">El padrón cerró el ${escaparHTML(config.cierre_padron)} (hora local).
          Ya no se emiten boletos nuevos; la lista queda tal como se selló.</div>` : ''}
      </section>
      <main>
        <h2>Busca tu boleto</h2>
        <form class="buscador" method="get" action="/boletos#resultado">
          <input type="text" name="buscar" value="${escaparHTML(textoBusqueda)}"
                 placeholder="SF27-000123 o teléfono a 10 dígitos" aria-label="Número de boleto o teléfono">
          <button type="submit">Buscar</button>
        </form>
        <p class="ayuda">Por privacidad, el titular se muestra solo como primer nombre e inicial del apellido,
        y ningún teléfono se publica.</p>
        <div id="resultado">${resultadoHTML}</div>

        <h2 id="lista">Lista completa (${total.toLocaleString('es-MX')} boletos)</h2>
        ${boletos.length ? tablaBoletos(boletos, false) : '<p class="vacio">Aún no hay boletos emitidos.</p>'}
        <div class="pie-lista">
          <span>${paginaActual > 1 ? enlacePagina(paginaActual - 1, '← Anterior') : ''}</span>
          <span>Página ${paginaActual} de ${totalPaginas}</span>
          <span>${paginaActual < totalPaginas ? enlacePagina(paginaActual + 1, 'Siguiente →') : ''}</span>
        </div>

        <p class="nota-legal">Los boletos anulados permanecen en la lista con la leyenda
        "${escaparHTML(padron.MOTIVO_PUBLICO_ANULADO)}" y su número no se reutiliza. El sorteo se realiza de forma
        física y presencial ante notario; esta plataforma únicamente emite boletos y resguarda el padrón.</p>
      </main>`));
  } catch (err) { next(err); }
});

module.exports = router;
