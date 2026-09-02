// Gestión de usuarios del panel (solo administrador; el candado de rol vive
// en rutas/admin.js). Alta con contraseña temporal, desactivación (nunca
// borrado, por la bitácora) y cambio de rol.

const express = require('express');
const usuarios = require('../servicios/usuarios');
const { escaparHTML, paginaAdmin } = require('../lib/html');

const router = express.Router();

function formatearFecha(valor) {
  if (!valor) return '—';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  const dos = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

async function render(req, res, avisoHTML = '') {
  const lista = await usuarios.listarUsuarios();
  const filas = lista.map((usuario) => `<tr>
    <td>${escaparHTML(usuario.correo)}</td>
    <td>${escaparHTML(usuario.nombre)}</td>
    <td>
      <form method="post" action="/admin/usuarios/rol" style="margin:0"
            onsubmit="return confirm('¿Cambiar el rol de ${escaparHTML(usuario.correo)}?')">
        <input type="hidden" name="usuario_id" value="${usuario.id}">
        <select name="rol" onchange="this.form.requestSubmit()">
          <option value="operador" ${usuario.rol === 'operador' ? 'selected' : ''}>operador</option>
          <option value="administrador" ${usuario.rol === 'administrador' ? 'selected' : ''}>administrador</option>
        </select>
      </form>
    </td>
    <td>${usuario.activo ? 'Activo' : 'Desactivado'}${usuario.debe_cambiar ? '<br><small>contraseña temporal</small>' : ''}
      ${usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date() ? '<br><small style="color:#8E1B12">bloqueado</small>' : ''}</td>
    <td>${formatearFecha(usuario.fecha_ultimo_acceso)}</td>
    <td>
      <form method="post" action="/admin/usuarios/estado" style="margin:0"
            onsubmit="return confirm('¿${usuario.activo ? 'Desactivar' : 'Reactivar'} a ${escaparHTML(usuario.correo)}?')">
        <input type="hidden" name="usuario_id" value="${usuario.id}">
        <input type="hidden" name="activo" value="${usuario.activo ? '0' : '1'}">
        <button type="submit">${usuario.activo ? 'Desactivar' : 'Reactivar'}</button>
      </form>
    </td>
  </tr>`).join('');

  res.send(paginaAdmin('Usuarios', `
    <h1>Usuarios del panel</h1>
    ${req.usuario.provisional ? '<p class="msj ok">Estás con la credencial provisional de entorno. Crea el primer administrador: en cuanto exista, el acceso provisional se deshabilita solo.</p>' : ''}
    ${avisoHTML}
    <h2>Alta de usuario</h2>
    <p>El usuario entra con la contraseña temporal y el sistema le obliga a cambiarla en su primer acceso.</p>
    <form class="linea" method="post" action="/admin/usuarios/alta">
      <div><label>Correo</label><input type="text" name="correo" required></div>
      <div><label>Nombre</label><input type="text" name="nombre" required></div>
      <div><label>Rol</label><select name="rol">
        <option value="operador">operador</option>
        <option value="administrador">administrador</option></select></div>
      <div><label>Contraseña temporal (mín. ${usuarios.MIN_CONTRASENA})</label>
      <input type="text" name="contrasena" required minlength="${usuarios.MIN_CONTRASENA}"></div>
      <button type="submit">Crear</button>
    </form>
    <h2>Usuarios</h2>
    ${filas
      ? `<table><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th></th></tr>${filas}</table>`
      : '<p class="vacio">Aún no hay usuarios. Crea el primer administrador.</p>'}`));
}

router.get('/usuarios', async (req, res, next) => {
  try { await render(req, res); } catch (err) { next(err); }
});

router.post('/usuarios/alta', async (req, res, next) => {
  try {
    const resultado = await usuarios.crearUsuario({
      correo: req.body.correo, nombre: req.body.nombre,
      contrasenaTemporal: req.body.contrasena, rol: req.body.rol, actor: req.actor,
    });
    await render(req, res, resultado.ok
      ? `<p class="msj ok">Usuario <strong>${escaparHTML(resultado.correo)}</strong> creado. Entrega la contraseña temporal en persona; deberá cambiarla al entrar.</p>`
      : `<p class="msj error">${escaparHTML(resultado.mensaje)}</p>`);
  } catch (err) { next(err); }
});

router.post('/usuarios/estado', async (req, res, next) => {
  try {
    if (Number(req.body.usuario_id) === req.usuario.id && req.body.activo === '0') {
      return render(req, res, '<p class="msj error">No puedes desactivarte a ti mismo.</p>');
    }
    const resultado = await usuarios.cambiarEstado({
      usuarioId: Number(req.body.usuario_id), activo: req.body.activo === '1', actor: req.actor,
    });
    await render(req, res, resultado.ok
      ? '<p class="msj ok">Estado actualizado.</p>'
      : `<p class="msj error">${escaparHTML(resultado.mensaje)}</p>`);
  } catch (err) { next(err); }
});

router.post('/usuarios/rol', async (req, res, next) => {
  try {
    if (Number(req.body.usuario_id) === req.usuario.id && req.body.rol !== 'administrador') {
      return render(req, res, '<p class="msj error">No puedes quitarte a ti mismo el rol de administrador.</p>');
    }
    const resultado = await usuarios.cambiarRol({
      usuarioId: Number(req.body.usuario_id), rol: req.body.rol, actor: req.actor,
    });
    await render(req, res, resultado.ok
      ? '<p class="msj ok">Rol actualizado.</p>'
      : `<p class="msj error">${escaparHTML(resultado.mensaje)}</p>`);
  } catch (err) { next(err); }
});

module.exports = router;
