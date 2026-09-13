// Pruebas de la ORDEN 15: titularidad de boletos en ventas a crédito.
// Motor: titular y autorizados emiten; otros no. Pantalla /admin/credito:
// alta de cuenta (creando al titular como participante) y autorizados.

process.env.ADMIN_USUARIO = process.env.ADMIN_USUARIO || 'provisional';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'clave-entorno-larga';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const motor = require('../servicios/motor-boletos');
const { app } = require('../server');

const hayBD = configurada();
let servidor;
let base;
let cookieAdmin;
let estacionId;
let cuentaId;

const TITULAR = '+526254440001';
const CHOFER_AUTORIZADO = '+526254440002';
const CHOFER_AJENO = '+526254440003';

async function pedir(ruta, { metodo = 'GET', cuerpo, cookie } = {}) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    redirect: 'manual',
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(cuerpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: cuerpo ? new URLSearchParams(cuerpo).toString() : undefined,
  });
  const galletas = respuesta.headers.getSetCookie?.() ?? [];
  return {
    status: respuesta.status,
    cookie: galletas.length ? galletas[0].split(';')[0] : null,
    texto: await respuesta.text(),
  };
}

async function sembrarVentaCredito(folio, codigo = 'C-26', nombre = 'TRANSPORTES EL 26') {
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, importe, forma_pago,
                         tipo_pago, cliente_codigo, cliente_nombre, origen)
     VALUES (?, ?, NOW(), 'Diesel', 1400, 'credito', 'Crédito', ?, ?, 'controlgas')`,
    [estacionId, folio, codigo, nombre]);
}

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['sellos', 'boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes',
    'mensajes_whatsapp', 'usuarios', 'credito_autorizados', 'cuentas_credito']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  await consultar("UPDATE configuracion SET valor = 'true' WHERE clave = 'credito_requiere_titular'");
  const [estacion] = await consultar("SELECT id FROM estaciones WHERE nombre = 'Rubio'");
  estacionId = estacion.id;

  for (const [telefono, nombre] of [[TITULAR, 'Titular Flotilla Pérez'],
    [CHOFER_AUTORIZADO, 'Chofer Autorizado López'], [CHOFER_AJENO, 'Chofer Ajeno García']]) {
    await consultar(
      `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
       VALUES (?, ?, 1, NOW())`, [telefono, nombre]);
  }
  const cuenta = await consultar(
    "INSERT INTO cuentas_credito (codigo, nombre, telefono_titular, creada_por) VALUES ('C-26', 'TRANSPORTES EL 26', ?, 'prueba')",
    [TITULAR]);
  cuentaId = cuenta.insertId;
  await consultar(
    "INSERT INTO credito_autorizados (cuenta_id, telefono, referencia_carta, dado_de_alta_por) VALUES (?, ?, 'carta 14-oct-2026, archivada en oficina', 'prueba')",
    [cuentaId, CHOFER_AUTORIZADO]);

  servidor = app.listen(0);
  await new Promise((resolver) => servidor.on('listening', resolver));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (hayBD) {
    await consultar("UPDATE configuracion SET valor = 'true' WHERE clave = 'credito_requiere_titular'");
    await obtenerPool().end();
  }
  if (servidor) servidor.close();
});

test('titular de la cuenta reclama su folio de crédito: emite y guarda la cuenta', { skip: !hayBD }, async () => {
  await sembrarVentaCredito('CRED-1');
  const r = await motor.reclamarFolio({ telefono: TITULAR, folio: 'CRED-1', estacionId, actor: 'prueba' });
  assert.equal(r.ok, true);
  const [boleto] = await consultar(
    "SELECT cuenta_credito_id FROM boletos WHERE folio_boleto = ?", [r.boletos[0]]);
  assert.equal(boleto.cuenta_credito_id, cuentaId, 'el boleto recuerda su cuenta');
});

test('chofer autorizado con carta: emite', { skip: !hayBD }, async () => {
  await sembrarVentaCredito('CRED-2');
  const r = await motor.reclamarFolio({ telefono: CHOFER_AUTORIZADO, folio: 'CRED-2', estacionId, actor: 'prueba' });
  assert.equal(r.ok, true);
});

test('chofer no autorizado: CREDITO_NO_AUTORIZADO, con cuenta y teléfono en bitácora', { skip: !hayBD }, async () => {
  await sembrarVentaCredito('CRED-3');
  const r = await motor.reclamarFolio({ telefono: CHOFER_AJENO, folio: 'CRED-3', estacionId, actor: 'prueba' });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'CREDITO_NO_AUTORIZADO');
  assert.equal(r.mensaje.includes('corresponden al titular'), true, 'texto del bot');
  const [asiento] = await consultar(
    "SELECT detalle FROM bitacora_boletos WHERE resultado = 'CREDITO_NO_AUTORIZADO' ORDER BY id DESC LIMIT 1");
  assert.equal(asiento.detalle.includes('C-26'), true, 'código de cuenta en bitácora');
  assert.equal(asiento.detalle.includes(CHOFER_AJENO), true, 'teléfono en bitácora');
});

test('cuenta desconocida: rechazo con la bandera en true, emite con la bandera en false', { skip: !hayBD }, async () => {
  await sembrarVentaCredito('CRED-4', 'C-99', 'FLETES DESCONOCIDOS');
  const rechazado = await motor.reclamarFolio({ telefono: CHOFER_AJENO, folio: 'CRED-4', estacionId, actor: 'prueba' });
  assert.equal(rechazado.codigo, 'CREDITO_SIN_CUENTA');
  assert.equal(rechazado.mensaje.includes('registrar la cuenta'), true);
  const [asiento] = await consultar(
    "SELECT detalle FROM bitacora_boletos WHERE resultado = 'CREDITO_SIN_CUENTA' ORDER BY id DESC LIMIT 1");
  assert.equal(asiento.detalle.includes('C-99'), true);

  await consultar("UPDATE configuracion SET valor = 'false' WHERE clave = 'credito_requiere_titular'");
  const emitido = await motor.reclamarFolio({ telefono: CHOFER_AJENO, folio: 'CRED-4', estacionId, actor: 'prueba' });
  assert.equal(emitido.ok, true, 'comportamiento anterior con la bandera apagada');
  const [boleto] = await consultar(
    'SELECT cuenta_credito_id FROM boletos WHERE folio_boleto = ?', [emitido.boletos[0]]);
  assert.equal(boleto.cuenta_credito_id, null, 'sin cuenta asociada');
  await consultar("UPDATE configuracion SET valor = 'true' WHERE clave = 'credito_requiere_titular'");
});

test('contado intacto: cualquier registrado reclama sin regla de crédito', { skip: !hayBD }, async () => {
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, importe, forma_pago, origen)
     VALUES (?, 'CONT-1', NOW(), 'Magna', 700, 'contado', 'controlgas')`, [estacionId]);
  const r = await motor.reclamarFolio({ telefono: CHOFER_AJENO, folio: 'CONT-1', estacionId, actor: 'prueba' });
  assert.equal(r.ok, true);
});

test('la baja de un autorizado surte efecto en el siguiente reclamo', { skip: !hayBD }, async () => {
  await consultar('DELETE FROM credito_autorizados WHERE cuenta_id = ? AND telefono = ?', [cuentaId, CHOFER_AUTORIZADO]);
  await sembrarVentaCredito('CRED-5');
  const r = await motor.reclamarFolio({ telefono: CHOFER_AUTORIZADO, folio: 'CRED-5', estacionId, actor: 'prueba' });
  assert.equal(r.codigo, 'CREDITO_NO_AUTORIZADO', 'ya no está autorizado');
  const titular = await motor.reclamarFolio({ telefono: TITULAR, folio: 'CRED-5', estacionId, actor: 'prueba' });
  assert.equal(titular.ok, true, 'el titular sigue pudiendo');
});

test('pantalla /admin/credito: alta de cuenta creando al titular, autorizados y pendientes', { skip: !hayBD }, async () => {
  const acceso = await pedir('/admin/acceso', {
    metodo: 'POST',
    cuerpo: { correo: process.env.ADMIN_USUARIO, contrasena: process.env.ADMIN_PASSWORD },
  });
  cookieAdmin = acceso.cookie;
  assert.equal(Boolean(cookieAdmin), true);

  // Código visto en ventas sin cuenta (C-99 de CRED-4) aparece como pendiente.
  const pantalla = await pedir('/admin/credito', { cookie: cookieAdmin });
  assert.equal(pantalla.texto.includes('C-99'), true, 'código pendiente listado');
  assert.equal(pantalla.texto.includes('FLETES DESCONOCIDOS'), true, 'con su nombre del export');

  // Alta con titular NO registrado: lo crea como participante.
  const alta = await pedir('/admin/credito', {
    metodo: 'POST', cookie: cookieAdmin,
    cuerpo: { codigo: 'C-99', nombre: 'FLETES DESCONOCIDOS', telefono: '6254449999', crear_participante: '1' },
  });
  assert.equal(alta.texto.includes('registrada'), true);
  const [titularNuevo] = await consultar("SELECT nombre FROM clientes WHERE telefono = '+526254449999'");
  assert.equal(Boolean(titularNuevo), true, 'participante creado desde la pantalla');

  // Autorizar y dar de baja un chofer, con bitácora.
  const [cuentaNueva] = await consultar("SELECT id FROM cuentas_credito WHERE codigo = 'C-99'");
  const autorizar = await pedir('/admin/credito/autorizados', {
    metodo: 'POST', cookie: cookieAdmin,
    cuerpo: { cuenta_id: cuentaNueva.id, telefono: '6254448888', referencia: 'carta 01-sep-2026' },
  });
  assert.equal(autorizar.texto.includes('autorizado'), true);
  const [aut] = await consultar('SELECT id FROM credito_autorizados WHERE cuenta_id = ?', [cuentaNueva.id]);
  const baja = await pedir('/admin/credito/autorizados/baja', {
    metodo: 'POST', cookie: cookieAdmin,
    cuerpo: { id: aut.id, cuenta_id: cuentaNueva.id },
  });
  assert.equal(baja.texto.includes('dado de baja'), true);
  const [{ total }] = await consultar(
    "SELECT COUNT(*) AS total FROM bitacora_boletos WHERE tipo = 'ajuste' AND resultado = 'CREDITO'");
  assert.equal(Number(total) >= 4, true, 'alta de cuenta, participante, autorización y baja en bitácora');
});
