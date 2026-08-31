// Utilería mínima para las páginas del panel de administración.

function escaparHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paginaAdmin(titulo, cuerpo) {
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
.nav{background:var(--negro);color:#fff;padding:0 24px;display:flex;align-items:center;gap:24px;height:56px}
.nav b{letter-spacing:.06em}
.nav a{color:#C9CEC6;text-decoration:none;font-weight:600;font-size:14px}
.nav a:hover{color:#fff}
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
</style>
</head>
<body>
<nav class="nav">
  <b>PANEL FEREZ</b>
  <a href="/admin">Inicio</a>
  <a href="/admin/clientes">Participantes</a>
  <a href="/admin/ventas">Ventas</a>
  <a href="/admin/boletos">Boletos</a>
  <a href="/admin/parametros">Parámetros</a>
</nav>
<main>
${cuerpo}
</main>
</body>
</html>`;
}

module.exports = { escaparHTML, paginaAdmin };
