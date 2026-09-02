// Pantalla "Parámetros": ver y editar las claves de `configuracion` con
// validación de tipos y confirmación antes de guardar. Se monta dentro de
// /admin (la autenticación vive en rutas/admin.js).

const express = require('express');
const { DEFINICIONES, validarValor, leerConfiguracionCruda, guardarValor } = require('../lib/configuracion');
const { registrarAjuste } = require('../servicios/usuarios');
const { escaparHTML, paginaAdmin } = require('../lib/html');

const router = express.Router();

async function render(res, avisoHTML = '') {
  const filas = await leerConfiguracionCruda();
  const cuerpo = filas.map((fila) => {
    const definicion = DEFINICIONES[fila.clave];
    const editable = Boolean(definicion);
    return `<tr>
      <td><code>${escaparHTML(fila.clave)}</code><br><small style="color:var(--gris)">${escaparHTML(fila.descripcion ?? '')}</small></td>
      <td>${definicion ? escaparHTML(definicion.tipo) : '—'}</td>
      <td>${editable ? `
        <form method="post" action="/admin/parametros" class="linea" style="margin:0"
              onsubmit="return confirm('¿Guardar ${escaparHTML(fila.clave)} = ' + this.valor.value + '?')">
          <input type="hidden" name="clave" value="${escaparHTML(fila.clave)}">
          <input type="text" name="valor" value="${escaparHTML(fila.valor)}" style="min-width:260px">
          <button type="submit">Guardar</button>
        </form>` : escaparHTML(fila.valor)}</td>
    </tr>`;
  }).join('');
  res.send(paginaAdmin('Parámetros', `
    <h1>Parámetros del sorteo</h1>
    <p>Valores aprobados en el SPEC v0.2 (sección 14). Los cambios aplican de inmediato a las siguientes emisiones.</p>
    ${avisoHTML}
    <table><tr><th>Clave</th><th>Tipo</th><th>Valor</th></tr>${cuerpo}</table>`));
}

router.get('/parametros', async (req, res, next) => {
  try { await render(res); } catch (err) { next(err); }
});

router.post('/parametros', async (req, res, next) => {
  try {
    const { clave, valor } = req.body || {};
    const validacion = validarValor(String(clave ?? ''), valor);
    if (!validacion.ok) {
      return render(res, `<p class="msj error"><strong>${escaparHTML(clave)}</strong>: ${escaparHTML(validacion.error)}</p>`);
    }
    await guardarValor(clave, validacion.valor);
    await registrarAjuste(req.actor, 'PARAMETRO', `${clave} = ${validacion.valor}`);
    await render(res, `<p class="msj ok"><strong>${escaparHTML(clave)}</strong> guardado: <code>${escaparHTML(validacion.valor)}</code></p>`);
  } catch (err) { next(err); }
});

module.exports = router;
