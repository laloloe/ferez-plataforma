const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Archivos estáticos (landing)
app.use(express.static(path.join(__dirname, 'public')));

// Verificación de salud del servicio
app.get('/salud', (req, res) => {
  res.json({ ok: true, servicio: 'ferez-plataforma', fecha: new Date().toISOString() });
});

// Punto de entrada para facturación (pendiente de definir con CTN/ATIO)
app.post('/api/facturacion', (req, res) => {
  res.status(501).json({ ok: false, mensaje: 'Módulo de facturación pendiente de integración.' });
});

// Cualquier otra ruta devuelve la landing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Ferez plataforma escuchando en el puerto ${PORT}`);
});
