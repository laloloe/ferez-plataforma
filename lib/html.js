// Utilería mínima para las páginas del panel de administración.

function escaparHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Secciones del panel, en el orden del menú. La sección activa se marca en
// el cliente comparando con location.pathname.
const SECCIONES = [
  ['/admin', 'Inicio'],
  ['/admin/clientes', 'Participantes'],
  ['/admin/ventas', 'Ventas'],
  ['/admin/captura', 'Captura'],
  ['/admin/credito', 'Crédito'],
  ['/admin/boletos', 'Boletos'],
  ['/admin/parametros', 'Parámetros'],
  ['/admin/bitacora', 'Bitácora'],
  ['/admin/whatsapp', 'WhatsApp'],
  ['/admin/remitentes', 'Remitentes'],
  ['/admin/sellado', 'Sellado'],
  ['/admin/usuarios', 'Usuarios'],
];

function paginaAdmin(titulo, cuerpo) {
  const ligas = SECCIONES.map(([href, nombre]) => `<a href="${href}">${nombre}</a>`).join('\n      ');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escaparHTML(titulo)} — Panel Ferez</title>
<style>
:root{--verde:#20C800;--verde-prof:#18A000;--negro:#000;--papel:#F2F4F1;--linea:#E3E7E1;--gris:#53565A;--tinta:#2C2F2B}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Barlow',Arial,sans-serif;background:var(--papel);color:var(--tinta);font-size:16px;line-height:1.6}

/* ---------- Barra del panel ---------- */
.barra{background:var(--negro);color:#fff;position:sticky;top:0;z-index:50}
.barra-linea{display:flex;align-items:center;gap:18px;height:56px;padding:0 18px}
.barra b{letter-spacing:.06em;flex-shrink:0}
.menu{display:flex;align-items:center;gap:18px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.menu::-webkit-scrollbar{display:none}
.menu a{color:#C9CEC6;text-decoration:none;font-weight:600;font-size:14px;flex-shrink:0;padding:6px 0;
  border-bottom:2px solid transparent}
.menu a:hover{color:#fff}
.menu a.actual{color:var(--verde);border-bottom-color:var(--verde)}
.menu form{flex-shrink:0;margin-left:auto}
.menu form button{background:none;border:1px solid #3A3F38;color:#C9CEC6;padding:6px 12px;border-radius:6px;
  cursor:pointer;font-weight:600;font-size:13px}
.menu-boton{display:none;margin-left:auto;background:none;border:1.5px solid #3A3F38;color:#fff;
  font-family:inherit;font-weight:700;font-size:13px;letter-spacing:.08em;padding:9px 14px;border-radius:7px;cursor:pointer}
.menu-boton[aria-expanded="true"]{border-color:var(--verde);color:var(--verde)}

@media (max-width:900px){
  /* Menú tipo sándwich: lista vertical a pantalla completa, cómoda al pulgar. */
  .menu-boton{display:block}
  .menu{display:none;position:absolute;left:0;right:0;top:56px;background:var(--negro);
    flex-direction:column;align-items:stretch;gap:0;padding:6px 0 10px;overflow:visible;
    border-bottom:3px solid var(--verde);box-shadow:0 14px 30px rgba(0,0,0,.35)}
  .menu.abierto{display:flex}
  .menu a{font-size:16px;padding:13px 22px;border-bottom:1px solid #1C1F1D}
  .menu a.actual{color:var(--verde);border-left:4px solid var(--verde);padding-left:18px;border-bottom-color:#1C1F1D}
  .menu form{margin:10px 18px 4px}
  .menu form button{width:100%;padding:12px;font-size:15px}
}

/* ---------- Contenido ---------- */
main{max-width:1080px;margin:0 auto;padding:32px 24px}
h1{font-size:24px;margin-bottom:18px;color:var(--negro)}
h2{font-size:18px;margin:26px 0 10px;color:var(--negro)}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--linea);border-radius:8px;overflow:hidden}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--linea);font-size:14.5px}
th{background:#fff;font-weight:700;color:var(--negro)}
tr:last-child td{border-bottom:0}
.tarjetas{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:26px}
.tarjeta{background:#fff;border:1px solid var(--linea);border-radius:10px;padding:18px;border-top:4px solid var(--verde)}
.tarjeta b{display:block;font-size:28px;color:var(--negro)}
.tarjeta span{font-size:13.5px;color:var(--gris)}
form.linea{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin:14px 0 20px}
label{display:block;font-size:13.5px;font-weight:600;margin-bottom:4px}
input,select{padding:9px 11px;font-family:inherit;font-size:15px;border:1.5px solid var(--linea);border-radius:7px;background:#fff}
button{background:var(--verde);color:var(--negro);font-weight:700;font-size:14.5px;padding:10px 18px;border:0;border-radius:7px;cursor:pointer}
button:hover{background:#2ADF06}
.msj{padding:12px 15px;border-radius:8px;margin:14px 0;font-size:15px}
.msj.ok{background:#E4F8DE;border:1.5px solid var(--verde-prof);color:#0E5A00}
.msj.error{background:#FBE9E7;border:1.5px solid #C62828;color:#8E1B12}
.vacio{color:var(--gris);font-style:italic;padding:16px 0}
ul.errores{margin:8px 0 0 20px;font-size:14px;color:#8E1B12}

@media (max-width:720px){
  main{padding:20px 14px}
  /* Formularios de captura a una columna, campos y botones a todo lo ancho. */
  form.linea{flex-direction:column;align-items:stretch}
  form.linea>div{width:100%}
  form.linea input,form.linea select{width:100%;padding:12px 13px;font-size:16px}
  form.linea>button{width:100%;padding:13px;font-size:16px}
  /* Las tablas anchas se deslizan en su propio marco; la página nunca se
     desborda horizontalmente. */
  table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
}
</style>
</head>
<body>
<header class="barra">
  <div class="barra-linea">
    <b>PANEL FEREZ</b>
    <button class="menu-boton" id="menuBoton" type="button" aria-expanded="false" aria-controls="menuPanel">MENÚ</button>
    <nav class="menu" id="menuPanel" aria-label="Secciones del panel">
      ${ligas}
      <form method="post" action="/admin/salir">
        <button type="submit">Salir</button>
      </form>
    </nav>
  </div>
</header>
<main>
${cuerpo}
</main>
<script>
(function(){
  var boton = document.getElementById('menuBoton');
  var menu = document.getElementById('menuPanel');
  boton.addEventListener('click', function(){
    var abierto = menu.classList.toggle('abierto');
    boton.setAttribute('aria-expanded', abierto ? 'true' : 'false');
  });
  // Marca la sección actual (la coincidencia más específica gana).
  var ruta = location.pathname.replace(/\\/$/, '') || '/admin';
  var actual = null;
  menu.querySelectorAll('a').forEach(function(liga){
    var href = liga.getAttribute('href');
    if (ruta === href || (href !== '/admin' && ruta.indexOf(href + '/') === 0) ||
        (href !== '/admin' && ruta.indexOf(href + '?') === 0)) {
      if (!actual || href.length > actual.getAttribute('href').length) actual = liga;
    }
  });
  if (!actual && ruta.indexOf('/admin') === 0) actual = menu.querySelector('a[href="/admin"]');
  if (actual) actual.classList.add('actual');
})();
</script>
</body>
</html>`;
}

module.exports = { escaparHTML, paginaAdmin };
