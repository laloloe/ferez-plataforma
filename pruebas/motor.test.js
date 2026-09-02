// Pruebas de integración del motor de boletos: idempotencia y numeración
// consecutiva bajo concurrencia. Requieren una base de datos configurada
// (variables DB_* o DATABASE_URL); sin ella se omiten con aviso.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const motor = require('../servicios/motor-boletos');

const hayBD = configurada();
if (!hayBD) {
  console.log('AVISO: pruebas de motor omitidas — no hay base de datos configurada (DB_* o DATABASE_URL).');
}

const TELEFONO = '+526251112233';
let estacionId;

async function crearVenta(folio, extras = {}) {
  const {
    importe = 700, producto = 'Magna', formaPago = null,
    fechaHora = new Date(), estacion = estacionId,
  } = extras;
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, litros, importe, forma_pago, origen)
     VALUES (?, ?, ?, ?, 40, ?, ?, 'manual')`,
    [estacion, folio, fechaHora, producto, importe, formaPago]);
}

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['sellos', 'boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  const [estacion] = await consultar("SELECT id FROM estaciones WHERE nombre = 'Rubio'");
  estacionId = estacion.id;
  await consultar(
    `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
     VALUES (?, 'Cliente De Prueba', 1, NOW())`, [TELEFONO]);
});

after(async () => {
  if (hayBD) await obtenerPool().end();
});

test('reclamo válido: $1,400 emite 2 boletos consecutivos', { skip: !hayBD }, async () => {
  await crearVenta('T-100', { importe: 1400 });
  const r = await motor.reclamarFolio({ telefono: TELEFONO, folio: 'T-100', estacionId, actor: 'prueba' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.boletos, ['SF27-000001', 'SF27-000002']);
});

test('idempotencia: el mismo folio dos veces = un solo juego de boletos', { skip: !hayBD }, async () => {
  const r = await motor.reclamarFolio({ telefono: TELEFONO, folio: 'T-100', estacionId, actor: 'prueba' });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'FOLIO_YA_RECLAMADO');
  const [{ total }] = await consultar("SELECT COUNT(*) AS total FROM boletos WHERE venta_id IS NOT NULL");
  assert.equal(Number(total), 2); // siguen siendo solo los 2 del primer reclamo
});

test('rechazos: importe insuficiente, vales, producto excluido, plazo, inexistente, no registrado', { skip: !hayBD }, async () => {
  await crearVenta('T-200', { importe: 500 });
  await crearVenta('T-201', { importe: 900, formaPago: 'Vales' });
  await crearVenta('T-202', { importe: 900, producto: 'Aceite 20W-50' });
  await crearVenta('T-203', { importe: 900, fechaHora: new Date(Date.now() - 10 * 86400000) });

  const casos = [
    ['T-200', 'IMPORTE_INSUFICIENTE'],
    ['T-201', 'FORMA_PAGO_EXCLUIDA'],
    ['T-202', 'PRODUCTO_NO_PARTICIPANTE'],
    ['T-203', 'FUERA_DE_PLAZO'],
    ['NO-EXISTE', 'FOLIO_INEXISTENTE'],
  ];
  for (const [folio, codigo] of casos) {
    const r = await motor.reclamarFolio({ telefono: TELEFONO, folio, estacionId, actor: 'prueba' });
    assert.equal(r.ok, false, folio);
    assert.equal(r.codigo, codigo, folio);
  }

  const noRegistrado = await motor.reclamarFolio({ telefono: '+526259998877', folio: 'T-200', estacionId, actor: 'prueba' });
  assert.equal(noRegistrado.codigo, 'CLIENTE_NO_REGISTRADO');
});

test('cierre del padrón: no se emite nada después del cierre', { skip: !hayBD }, async () => {
  await consultar("UPDATE configuracion SET valor = '2020-01-01 00:00' WHERE clave = 'cierre_padron'");
  try {
    await crearVenta('T-300', { importe: 900 });
    const r = await motor.reclamarFolio({ telefono: TELEFONO, folio: 'T-300', estacionId, actor: 'prueba' });
    assert.equal(r.codigo, 'PADRON_CERRADO');
    const oficina = await motor.emitirBoletoOficina({ nombre: 'Alguien', telefono: '+526250000001', recibo: 'R-CERRADO', actor: 'prueba' });
    assert.equal(oficina.codigo, 'PADRON_CERRADO');
  } finally {
    await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  }
});

test('boleto de oficina: misma numeración, recibo duplicado rechazado', { skip: !hayBD }, async () => {
  const r = await motor.emitirBoletoOficina({ nombre: 'Ana Oficina', telefono: '+526250000002', recibo: 'R-001', actor: 'prueba' });
  assert.equal(r.ok, true);
  assert.equal(r.boletos.length, 1);
  assert.match(r.boletos[0], /^SF27-\d{6}$/);

  const duplicado = await motor.emitirBoletoOficina({ nombre: 'Ana Oficina', telefono: '+526250000002', recibo: 'R-001', actor: 'prueba' });
  assert.equal(duplicado.codigo, 'RECIBO_DUPLICADO');
});

test('concurrencia: emisiones simultáneas sin huecos ni duplicados', { skip: !hayBD }, async () => {
  const reclamos = [];
  for (let i = 1; i <= 12; i++) {
    await crearVenta(`C-${i}`, { importe: 700 });
    reclamos.push(() => motor.reclamarFolio({ telefono: TELEFONO, folio: `C-${i}`, estacionId, actor: 'prueba' }));
  }
  const oficinas = [];
  for (let i = 1; i <= 4; i++) {
    oficinas.push(() => motor.emitirBoletoOficina({ nombre: `Compra ${i}`, telefono: `+52625000010${i}`, recibo: `R-C${i}`, actor: 'prueba' }));
  }
  const resultados = await Promise.all([...reclamos, ...oficinas].map((fn) => fn()));
  for (const r of resultados) assert.equal(r.ok, true, JSON.stringify(r));

  const numeros = (await consultar('SELECT numero FROM boletos ORDER BY numero')).map((f) => Number(f.numero));
  const [{ siguiente }] = await consultar('SELECT siguiente FROM contador_boletos WHERE id = 1');
  assert.equal(new Set(numeros).size, numeros.length, 'sin duplicados');
  for (let i = 1; i < numeros.length; i++) {
    assert.equal(numeros[i], numeros[i - 1] + 1, 'sin huecos');
  }
  assert.equal(numeros[0], 1);
  assert.equal(Number(siguiente), numeros[numeros.length - 1] + 1);
});

test('venta cancelada: sus boletos pasan a ANULADO sin liberar números', { skip: !hayBD }, async () => {
  const [venta] = await consultar("SELECT id FROM ventas WHERE folio = 'T-100'");
  const r = await motor.marcarVenta({ ventaId: venta.id, estado: 'cancelada', actor: 'prueba' });
  assert.equal(r.ok, true);
  assert.equal(r.anulados, 2);

  const anulados = await consultar("SELECT estado, motivo_anulacion, numero FROM boletos WHERE venta_id = ?", [venta.id]);
  for (const boleto of anulados) {
    assert.equal(boleto.estado, 'anulado');
    assert.equal(boleto.motivo_anulacion, 'Venta cancelada');
    assert.notEqual(boleto.numero, null); // el número no se libera
  }
  // Reclamarla de nuevo tampoco procede
  const reintento = await motor.reclamarFolio({ telefono: TELEFONO, folio: 'T-100', estacionId, actor: 'prueba' });
  assert.equal(reintento.codigo, 'VENTA_CANCELADA');
});
