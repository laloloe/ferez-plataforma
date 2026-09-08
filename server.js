require('dotenv').config({ quiet: true });

const express = require('express');
const fs = require('fs');
const path = require('path');
const modo = require('./servicios/modo-pruebas');
const { configurada } = require('./lib/db');
const { ejecutarMigraciones } = require('./lib/migraciones');
const rutaRegistro = require('./rutas/registro');
const rutaAdmin = require('./rutas/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Detrás del proxy de Railway: req.ip debe ser la IP real del visitante
// (el límite por hora de /constancia depende de ella).
app.set('trust proxy', 1);

// rawBody se conserva para validar la firma del webhook de WhatsApp.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false }));

// ---------- Modo pruebas público (ORDEN 9) ----------
// La landing y /registro se sirven con lógica: mientras numero_permiso esté
// vacía, la landing pierde los bloques <!--sorteo-->…<!--/sorteo--> (las
// ligas al sorteo) y /registro lleva la franja MODO PRUEBAS.

const cachePaginas = {};
function leerPagina(nombre) {
  if (!cachePaginas[nombre]) {
    cachePaginas[nombre] = fs.readFileSync(path.join(__dirname, 'public', nombre), 'utf8');
  }
  return cachePaginas[nombre];
}

async function servirLanding(req, res) {
  let html = leerPagina('index.html');
  if (await modo.enModoPruebasSeguro()) {
    html = html.replace(/<!--sorteo-->[\s\S]*?<!--\/sorteo-->/g, '');
  }
  res.type('html').send(html);
}

// La landing se sirve SIEMPRE por aquí (index:false abajo evita que el
// estático la entregue sin filtrar).
app.get(['/', '/index.html'], (req, res, next) => {
  servirLanding(req, res).catch(next);
});

// Archivos estáticos (logos, fotos, aviso)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Páginas públicas
app.get('/registro', async (req, res, next) => {
  try {
    let html = leerPagina('registro.html');
    if (await modo.enModoPruebasSeguro()) {
      html = html.replace(/<body([^>]*)>/, (todo, atributos) => `<body${atributos}>${modo.franjaHTML()}`);
    }
    res.type('html').send(html);
  } catch (err) { next(err); }
});
app.get('/aviso-privacidad', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'aviso-privacidad.html'));
});

// Verificación de salud del servicio
app.get('/salud', (req, res) => {
  res.json({
    ok: true,
    servicio: 'ferez-plataforma',
    baseDeDatos: configurada() ? 'configurada' : 'sin configurar',
    fecha: new Date().toISOString(),
  });
});

// Punto de entrada para facturación (pendiente de definir con CTN/ATIO)
app.post('/api/facturacion', (req, res) => {
  res.status(501).json({ ok: false, mensaje: 'Módulo de facturación pendiente de integración.' });
});

app.use(rutaRegistro);
app.use(require('./rutas/padron'));
app.use(require('./rutas/constancia'));
app.use(require('./rutas/webhook-whatsapp'));
app.use('/admin', rutaAdmin);

// Cualquier otra ruta devuelve la landing (con el mismo filtro de modo pruebas)
app.get('*', (req, res, next) => {
  servirLanding(req, res).catch(next);
});

async function iniciar() {
  try {
    await ejecutarMigraciones();
  } catch (err) {
    // El servidor arranca aunque la base de datos falle; las rutas que la
    // necesitan responden 503 y el resto del sitio sigue en pie.
    console.error('No se pudieron aplicar las migraciones:', err.message);
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ferez plataforma escuchando en el puerto ${PORT}`);
  });
}

if (require.main === module) iniciar();

module.exports = { app };
