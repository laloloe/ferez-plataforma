require('dotenv').config();

const express = require('express');
const path = require('path');
const { configurada } = require('./lib/db');
const { ejecutarMigraciones } = require('./lib/migraciones');
const rutaRegistro = require('./rutas/registro');
const rutaAdmin = require('./rutas/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// rawBody se conserva para validar la firma del webhook de WhatsApp.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false }));

// Archivos estáticos (landing)
app.use(express.static(path.join(__dirname, 'public')));

// Páginas públicas
app.get('/registro', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'registro.html'));
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
app.use(require('./rutas/webhook-whatsapp'));
app.use('/admin', rutaAdmin);

// Cualquier otra ruta devuelve la landing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
