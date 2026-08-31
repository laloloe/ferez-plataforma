// Pruebas del padrón público: enmascarado, modos de búsqueda, contador con
// cache y visibilidad de anulados. Las de datos requieren base configurada.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const motor = require('../servicios/motor-boletos');
const padron = require('../servicios/padron');

const hayBD = configurada();

// ---------- Unitarias (sin BD) ----------

test('enmascarado: primer nombre + inicial del apellido; nunca apellido completo', () => {
  assert.equal(padron.enmascararNombre('Eduardo Loewen'), 'Eduardo L.');
  assert.equal(padron.enmascararNombre('José Luis Pérez García'), 'José L.');
  assert.equal(padron.enmascararNombre('  ana   torres '), 'ana T.');
  assert.equal(padron.enmascararNombre('Madonna'), 'Madonna');
  assert.equal(padron.enmascararNombre(''), 'Participante');
});

test('búsqueda: número de boleto en sus variantes', () => {
  assert.deepEqual(padron.interpretarBusqueda('SF27-000123'), { tipo: 'boleto', prefijo: 'SF27', numero: 123 });
  assert.deepEqual(padron.interpretarBusqueda('sf27000123'), { tipo: 'boleto', prefijo: 'SF27', numero: 123 });
  assert.equal(padron.interpretarBusqueda('123').tipo, 'boleto');
  assert.equal(padron.interpretarBusqueda('000123').tipo, 'boleto');
});

test('búsqueda: teléfono completo a 10 dígitos; parciales no buscan', () => {
  assert.deepEqual(padron.interpretarBusqueda('625 123 4567'), { tipo: 'telefono', telefono: '+526251234567' });
  assert.equal(padron.interpretarBusqueda('+52 625 123 4567').tipo, 'telefono');
  assert.equal(padron.interpretarBusqueda('6251234').tipo, 'invalida');   // 7 dígitos: parcial
  assert.equal(padron.interpretarBusqueda('625123456').tipo, 'invalida'); // 9 dígitos: parcial
  assert.equal(padron.interpretarBusqueda('hola mundo').tipo, 'invalida');
  assert.equal(padron.interpretarBusqueda('').tipo, 'vacia');
});

test('haciaPublico nunca incluye teléfono y el anulado lleva motivo genérico', () => {
  const fila = {
    folio_boleto: 'SF27-000009', numero: 9, fecha_emision: new Date(),
    estado: 'anulado', origen: 'reclamo', estacion: 'Rubio',
    cliente: 'Eduardo Loewen', telefono: '+526251234567',
  };
  const publico = padron.haciaPublico(fila, true);
  assert.equal('telefono' in publico, false);
  assert.equal(publico.titular, 'Eduardo L.');
  assert.equal(publico.estado, padron.MOTIVO_PUBLICO_ANULADO);
  const serializado = JSON.stringify(publico);
  assert.equal(serializado.includes('6251234567'), false);
  assert.equal(serializado.includes('Loewen'), false);
});

// ---------- De datos (con BD) ----------

const TELEFONO = '+526257778899';
let estacionId;

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  const [estacion] = await consultar("SELECT id FROM estaciones WHERE nombre = 'Rubio'");
  estacionId = estacion.id;
  await consultar(
    `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
     VALUES (?, 'Prueba Padrón López', 1, NOW())`, [TELEFONO]);
  padron.reiniciarCacheContador();
});

after(async () => {
  if (hayBD) await obtenerPool().end();
});

test('remate: estaciones con código CTN y razón social', { skip: !hayBD }, async () => {
  const estaciones = await consultar('SELECT nombre, codigo_ctn, razon_social FROM estaciones ORDER BY id');
  const porNombre = Object.fromEntries(estaciones.map((e) => [e.nombre, e]));
  assert.equal(porNombre['Km 12.9 Corredor Comercial'].codigo_ctn, 'E06874');
  assert.equal(porNombre['Km 12.9 Corredor Comercial'].razon_social, 'Servicio Gasolinero del Campo, S.A. de C.V.');
  assert.equal(porNombre['Rubio'].codigo_ctn, 'E01369');
  assert.equal(porNombre['Rubio'].razon_social, 'Estación de Servicio Feres, S.A. de C.V.');
  assert.equal(porNombre['Oasis'].codigo_ctn, null);
  assert.equal(porNombre['Oasis'].razon_social, 'Estación de Servicio Feres, S.A. de C.V.');
});

test('búsqueda por boleto y por teléfono con titular enmascarado', { skip: !hayBD }, async () => {
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, producto, litros, importe, origen)
     VALUES (?, 'P-1', NOW(), 'Magna', 40, 1400, 'manual')`, [estacionId]);
  const emision = await motor.reclamarFolio({ telefono: TELEFONO, folio: 'P-1', estacionId, actor: 'prueba' });
  assert.equal(emision.ok, true);

  const porBoleto = await padron.buscarPorBoleto(1);
  assert.equal(porBoleto.length, 1);
  assert.equal(porBoleto[0].titular, 'Prueba P.');
  assert.equal('telefono' in porBoleto[0], false);
  assert.equal(porBoleto[0].estacion, 'Rubio');
  assert.equal(porBoleto[0].origen, 'Carga');

  const porTelefono = await padron.buscarPorTelefono(TELEFONO);
  assert.equal(porTelefono.length, 2);
  assert.equal(JSON.stringify(porTelefono).includes('7778899'), false);
});

test('contador coincide con la BD y el cache expira', { skip: !hayBD }, async () => {
  padron.reiniciarCacheContador();
  const [{ vigentes }] = await consultar("SELECT COUNT(*) AS vigentes FROM boletos WHERE estado = 'vigente'");
  const inicial = await padron.contadorVigentes(120);
  assert.equal(inicial, Number(vigentes));

  const oficina = await motor.emitirBoletoOficina({ nombre: 'Otro Comprador', telefono: '+526250004455', recibo: 'R-PAD-1', actor: 'prueba' });
  assert.equal(oficina.ok, true);
  assert.equal(await padron.contadorVigentes(120), inicial, 'dentro del TTL sirve el valor cacheado');
  await new Promise((resolver) => setTimeout(resolver, 150));
  assert.equal(await padron.contadorVigentes(120), inicial + 1, 'expirado el TTL vuelve a leer la BD');
});

test('anulado visible en lista y búsqueda con motivo genérico', { skip: !hayBD }, async () => {
  const anulacion = await motor.anularBoleto({ folioBoleto: 'SF27-000001', motivo: 'Error de captura interno', actor: 'prueba' });
  assert.equal(anulacion.ok, true);

  const [resultado] = await padron.buscarPorBoleto(1);
  assert.equal(resultado.estado, padron.MOTIVO_PUBLICO_ANULADO);
  assert.equal(JSON.stringify(resultado).includes('Error de captura'), false, 'el motivo real no sale al público');

  const lista = await padron.listarPadron(1);
  const enLista = lista.boletos.find((b) => b.numero === 1);
  assert.notEqual(enLista, undefined, 'el anulado sigue en la lista');
  assert.equal(enLista.estado, padron.MOTIVO_PUBLICO_ANULADO);
});

test('lista paginada ordenada por número, sin titulares', { skip: !hayBD }, async () => {
  for (let i = 1; i <= 60; i++) {
    const r = await motor.emitirBoletoOficina({
      nombre: `Comprador Apellido ${i}`, telefono: `+52625100${String(i).padStart(4, '0')}`,
      recibo: `R-PAG-${i}`, actor: 'prueba',
    });
    assert.equal(r.ok, true);
  }
  const primera = await padron.listarPadron(1);
  assert.equal(primera.boletos.length, padron.TAMANO_PAGINA);
  assert.equal(primera.boletos[0].numero, 1);
  assert.equal(primera.totalPaginas >= 2, true);
  for (let i = 1; i < primera.boletos.length; i++) {
    assert.equal(primera.boletos[i].numero > primera.boletos[i - 1].numero, true, 'orden ascendente');
  }
  assert.equal(JSON.stringify(primera).includes('titular'), false, 'la lista pública no lleva titulares');
  assert.equal(JSON.stringify(primera).includes('Apellido'), false);

  const segunda = await padron.listarPadron(2);
  assert.equal(segunda.boletos[0].numero, padron.TAMANO_PAGINA + 1, 'la paginación continúa sin saltos');
  const fueraDeRango = await padron.listarPadron(999);
  assert.equal(fueraDeRango.pagina, fueraDeRango.totalPaginas, 'página fuera de rango se acota');
});
