// Registro de participantes (SPEC sección 9 y 10).
// El teléfono es la identidad principal; se guarda normalizado a E.164.

const express = require('express');
const { configurada, consultar } = require('../lib/db');
const { normalizarTelefono } = require('../lib/telefono');

const router = express.Router();

router.post('/api/registro', async (req, res) => {
  if (!configurada()) {
    return res.status(503).json({ ok: false, mensaje: 'El registro no está disponible por el momento. Intenta más tarde.' });
  }

  const { nombre, telefono, acepto_aviso } = req.body || {};

  const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : '';
  if (nombreLimpio.length < 2 || nombreLimpio.length > 150) {
    return res.status(400).json({ ok: false, campo: 'nombre', mensaje: 'Escribe tu nombre completo.' });
  }

  const telefonoNormalizado = normalizarTelefono(String(telefono || ''));
  if (!telefonoNormalizado) {
    return res.status(400).json({ ok: false, campo: 'telefono', mensaje: 'Escribe un teléfono celular válido de 10 dígitos.' });
  }

  if (acepto_aviso !== true && acepto_aviso !== 'true' && acepto_aviso !== 'on') {
    return res.status(400).json({ ok: false, campo: 'acepto_aviso', mensaje: 'Necesitas aceptar el aviso de privacidad para participar.' });
  }

  try {
    await consultar(
      `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
       VALUES (?, ?, 1, NOW())`,
      [telefonoNormalizado, nombreLimpio]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, campo: 'telefono', mensaje: 'Este teléfono ya está registrado. Ya puedes participar.' });
    }
    console.error('Error en registro:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Ocurrió un error. Intenta de nuevo en un momento.' });
  }

  return res.status(201).json({ ok: true, mensaje: '¡Listo! Tu registro quedó completo.' });
});

module.exports = router;
