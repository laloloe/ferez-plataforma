// Pruebas de la ORDEN 7: normalizador de folio, FuenteControlGAS sobre un
// fixture SINTÉTICO (generado aquí mismo, sin datos reales de clientes),
// importación sin duplicados y reclamo por bot de un folio en formato de
// ticket impreso.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const { normalizarFolio } = require('../servicios/reglas-boletos');
const { FuenteControlGAS } = require('../fuentes/fuente-controlgas');
const { importarVentas } = require('../servicios/importar-ventas');
const bot = require('../servicios/bot-whatsapp');

const hayBD = configurada();

// ---------- Normalizador (sin BD): las cinco variantes documentadas ----------

test('normalizarFolio: las cinco variantes del mismo despacho dan la forma canónica', () => {
  // 1) Forma canónica (columna Despacho sin sufijo).
  assert.equal(normalizarFolio('3093404'), '3093404');
  // 2) Export de ControlGAS: folio con sufijo "-0".
  assert.equal(normalizarFolio('3093404-0'), '3093404');
  // 3) Ticket impreso: paréntesis + ceros a la izquierda + dígito final agregado.
  assert.equal(normalizarFolio('(00030934040)'), '3093404');
  // 4) Ticket dictado sin paréntesis (conserva los ceros a la izquierda).
  assert.equal(normalizarFolio('00030934040'), '3093404');
  // 5) Folio con espacios intermedios (como lo teclea el cliente).
  assert.equal(normalizarFolio('309 3404'), '3093404');
});

test('normalizarFolio: no destruye folios no numéricos ni casos raros', () => {
  assert.equal(normalizarFolio('T-100'), 'T-100');
  assert.equal(normalizarFolio('OAS-1'), 'OAS-1');
  assert.equal(normalizarFolio(''), '');
  assert.equal(normalizarFolio(null), '');
  assert.equal(normalizarFolio('7'), '7'); // sin ceros ni paréntesis: se respeta
});

test('el bot clasifica un folio en formato de ticket y lo normaliza', () => {
  assert.deepEqual(bot.clasificarTexto('(00030934040)'), { tipo: 'folio', folio: '3093404' });
  assert.deepEqual(bot.clasificarTexto(' 3093404-0 '), { tipo: 'folio', folio: '3093404' });
});

// ---------- Fixture sintético del export "Control de Despachos" ----------

const ENCABEZADOS = ['Fecha', 'Turno', 'Hora', 'Despacho', 'Posición', 'Producto',
  'Cantidad', 'Precio', 'Importe', 'Despachador', 'Nota', 'Factura', 'UUID',
  'Fecha Factura', 'Cliente', 'Código', 'Tipo', 'Vehículo', 'Placas', 'Datos'];

// Fecha del día (DD/MM/AAAA) para que el plazo de 7 días nunca venza en pruebas.
function fechaDeHoy() {
  const hoy = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(hoy.getDate())}/${dos(hoy.getMonth() + 1)}/${hoy.getFullYear()}`;
}

function fila(datos) {
  const base = new Array(ENCABEZADOS.length).fill(null);
  for (const [nombre, valor] of Object.entries(datos)) base[ENCABEZADOS.indexOf(nombre)] = valor;
  return base;
}

// Réplica exacta de la estructura real: título en fila 3, razón social en
// fila 5, encabezados en fila 7, datos desde la 8, TOTALES al final.
// Todos los nombres y códigos son inventados.
function generarFixture() {
  const f = fechaDeHoy();
  const filas = [
    [], [],
    [`Control de Despachos - ${f}`],
    [],
    ['ESTACION SINTETICA DE PRUEBAS, S.A. DE C.V.'],
    [],
    ENCABEZADOS,
    fila({ Fecha: f, Turno: 1, Hora: '08:15:00', Despacho: '3093404-0', 'Posición': 3,
      Producto: 'MAGNA', Cantidad: 40, Precio: 35, Importe: 1400,
      Despachador: 'DESPACHADOR UNO', Nota: 'NOTA-COMPARTIDA' }),
    fila({ Fecha: f, Turno: 1, Hora: '09:20:11', Despacho: '3093405-0', 'Posición': 5,
      Producto: 'DIESEL', Cantidad: 30, Precio: 30, Importe: 900,
      Despachador: 'DESPACHADOR DOS', Nota: 'NOTA-COMPARTIDA', Tipo: 'Crédito',
      Cliente: 'TRANSPORTES SINTETICOS, S.A.', 'Código': 'C-0088',
      'Vehículo': 'TRACTOCAMION', Placas: 'XX-000-YY', Datos: 'CREDITO' }),
    fila({ Fecha: f, Turno: 1, Hora: '10:05:00', Despacho: '3093406-0', 'Posición': 2,
      Producto: 'ACEITE SINTETICO 1L', Cantidad: 1, Precio: 250, Importe: 250,
      Despachador: 'DESPACHADOR UNO' }),
    // Despacho vacío: prueba de bomba / fila administrativa → se omite.
    fila({ Fecha: f, Turno: 1, Hora: '10:30:00', 'Posición': 4,
      Producto: 'MAGNA', Cantidad: 5, Precio: 20, Importe: 100 }),
    // Importe en cero → se omite.
    fila({ Fecha: f, Turno: 1, Hora: '11:00:00', Despacho: '3093407-0', 'Posición': 1,
      Producto: 'MAGNA', Cantidad: 0, Precio: 0, Importe: 0 }),
    fila({ Fecha: f, Turno: 2, Hora: '14:45:30', Despacho: '3093408-0', 'Posición': 6,
      Producto: 'PREMIUM', Cantidad: 20, Precio: 35, Importe: 700,
      Despachador: 'DESPACHADOR TRES', Tipo: 'Contado', Datos: 'PAGO CON VALE SINTETICO' }),
    fila({ Fecha: 'TOTALES', Cantidad: 91, Importe: 3250 }),
  ];
  const hoja = XLSX.utils.aoa_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Control de Despachos');
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
}

const OPCIONES_FUENTE = {
  productosParticipantes: ['magna', 'premium', 'diesel'],
  palabrasPagoExcluido: ['vale'],
};

test('FuenteControlGAS: lee el fixture con la estructura real y aplica las reglas de fila', async () => {
  const fuente = new FuenteControlGAS(generarFixture(), OPCIONES_FUENTE);
  const { ventas, errores, omitidas, noParticipantes } = await fuente.obtenerVentas();

  assert.deepEqual(errores, []);
  assert.equal(omitidas, 2, 'despacho vacío + importe 0');
  assert.equal(noParticipantes, 1, 'el aceite se importa pero no participa');
  assert.deepEqual(ventas.map((v) => v.folio), ['3093404', '3093405', '3093406', '3093408']);

  const [magna, diesel, aceite, premium] = ventas;
  assert.equal(magna.forma_pago, 'contado'); // Tipo vacío = contado
  assert.equal(magna.tipo_pago, 'Contado');
  assert.equal(magna.nota, 'NOTA-COMPARTIDA');
  assert.equal(magna.importe, 1400);
  assert.equal(magna.litros, 40);
  assert.equal(magna.participante, true);
  // Fecha de la venta = Fecha + Hora (no el turno).
  assert.equal(magna.fecha_hora.getHours(), 8);
  assert.equal(magna.fecha_hora.getMinutes(), 15);
  assert.equal(magna.fecha_hora.getDate(), new Date().getDate());

  assert.equal(diesel.forma_pago, 'credito');
  assert.equal(diesel.cliente_nombre, 'TRANSPORTES SINTETICOS, S.A.');
  assert.equal(diesel.cliente_codigo, 'C-0088');
  assert.equal(diesel.nota, 'NOTA-COMPARTIDA');

  assert.equal(aceite.participante, false);
  assert.equal(aceite.forma_pago, 'contado');

  // "VALE" en Datos marca la venta como pago excluido aunque Tipo diga Contado.
  assert.equal(premium.forma_pago, 'vales');
  assert.equal(premium.datos_pago, 'PAGO CON VALE SINTETICO');
});

test('FuenteControlGAS: archivo sin encabezados reconocibles produce error claro', async () => {
  const hoja = XLSX.utils.aoa_to_sheet([['cualquier', 'cosa'], [1, 2]]);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Hoja1');
  const fuente = new FuenteControlGAS(XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }), OPCIONES_FUENTE);
  const { ventas, errores } = await fuente.obtenerVentas();
  assert.equal(ventas.length, 0);
  assert.equal(errores.length, 1);
  assert.equal(errores[0].includes('encabezados'), true);
});

// ---------- Con base de datos: importación e integración con el bot ----------

const TELEFONO = '+526257778899';
let estacionId;
let contadorMensajes = 0;

function cargaUtil(de, texto, id) {
  return {
    entry: [{ changes: [{ value: { messages: [{ id, from: de, type: 'text', text: { body: texto } }] } }] }],
  };
}

function enviadorFalso(registro) {
  return async (telefono, texto) => {
    registro.push({ telefono, texto });
    return { ok: true, id: `wamid.cg.salida.${++contadorMensajes}` };
  };
}

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['sellos', 'boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes', 'mensajes_whatsapp']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  await consultar("UPDATE configuracion SET valor = '2027-12-16 12:00' WHERE clave = 'cierre_padron'");
  const [estacion] = await consultar("SELECT id FROM estaciones WHERE nombre = 'Rubio'");
  estacionId = estacion.id;
  await consultar(
    `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
     VALUES (?, 'Cliente ControlGAS Pérez', 1, NOW())`, [TELEFONO]);
});

after(async () => {
  if (hayBD) await obtenerPool().end();
});

test('importar el fixture dos veces produce cero duplicados', { skip: !hayBD }, async () => {
  const fuente = new FuenteControlGAS(generarFixture(), OPCIONES_FUENTE);
  const { ventas } = await fuente.obtenerVentas();

  const primera = await importarVentas({ estacionId, ventas, origen: 'controlgas', actor: 'prueba' });
  assert.equal(primera.insertadas, 4);
  assert.equal(primera.duplicadas, 0);

  const segunda = await importarVentas({ estacionId, ventas, origen: 'controlgas', actor: 'prueba' });
  assert.equal(segunda.insertadas, 0);
  assert.equal(segunda.duplicadas, 4);

  const [{ total }] = await consultar(
    "SELECT COUNT(*) AS total FROM ventas WHERE origen = 'controlgas'");
  assert.equal(Number(total), 4);

  // Los campos de flotillas quedaron guardados.
  const [credito] = await consultar("SELECT * FROM ventas WHERE folio = '3093405'");
  assert.equal(credito.cliente_nombre, 'TRANSPORTES SINTETICOS, S.A.');
  assert.equal(credito.cliente_codigo, 'C-0088');
  assert.equal(credito.tipo_pago, 'Crédito');
  assert.equal(credito.nota, 'NOTA-COMPARTIDA');
});

test('bot: el folio tal como sale impreso en el ticket "(0003...0)" genera boletos', { skip: !hayBD }, async () => {
  const enviados = [];
  await bot.procesarWebhook(cargaUtil('526257778899', '(00030934040)', 'wamid.cg.ticket.1'),
    { enviar: enviadorFalso(enviados) });
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].texto.includes('3093404'), true);
  assert.equal(enviados[0].texto.includes('Rubio'), true);
  assert.equal(enviados[0].texto.includes('SF27-'), true, 'debe emitir boletos');
  const [{ total }] = await consultar(
    "SELECT COUNT(*) AS total FROM boletos b JOIN emisiones e ON e.id = b.emision_id JOIN ventas v ON v.id = e.venta_id WHERE v.folio = '3093404'");
  assert.equal(Number(total), 2, '$1400 a $700 por boleto = 2 boletos');
});

test('bot: la venta pagada con vales se rechaza como forma de pago excluida', { skip: !hayBD }, async () => {
  const enviados = [];
  await bot.procesarWebhook(cargaUtil('526257778899', '3093408-0', 'wamid.cg.vales.1'),
    { enviar: enviadorFalso(enviados) });
  assert.equal(enviados.length, 1);
  const [registro] = await consultar(
    "SELECT resultado FROM mensajes_whatsapp WHERE wa_message_id = 'wamid.cg.vales.1'");
  assert.equal(registro.resultado, 'FORMA_PAGO_EXCLUIDA');
});

test('bot: el producto no participante se rechaza aunque el folio exista', { skip: !hayBD }, async () => {
  const enviados = [];
  await bot.procesarWebhook(cargaUtil('526257778899', '3093406', 'wamid.cg.aceite.1'),
    { enviar: enviadorFalso(enviados) });
  assert.equal(enviados.length, 1);
  const [registro] = await consultar(
    "SELECT resultado FROM mensajes_whatsapp WHERE wa_message_id = 'wamid.cg.aceite.1'");
  assert.equal(registro.resultado, 'PRODUCTO_NO_PARTICIPANTE');
});

test('la migración 010 dejó normalizados los folios preexistentes', { skip: !hayBD }, async () => {
  // Se insertan folios en formato viejo y se aplican las mismas sentencias de
  // la migración (sobre una BD ya migrada no vuelve a correr sola).
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, importe, origen)
     VALUES (?, '5550001-0', NOW(), 700, 'manual'), (?, '00055500020', NOW(), 700, 'manual')`,
    [estacionId, estacionId]);
  await consultar("UPDATE IGNORE ventas SET folio = SUBSTRING_INDEX(folio, '-', 1) WHERE folio REGEXP '^[0-9]+-[0-9]+$'");
  await consultar(
    `UPDATE IGNORE ventas
     SET folio = SUBSTRING(TRIM(LEADING '0' FROM folio), 1, CHAR_LENGTH(TRIM(LEADING '0' FROM folio)) - 1)
     WHERE folio REGEXP '^0[0-9]+$' AND CHAR_LENGTH(TRIM(LEADING '0' FROM folio)) > 1`);
  const folios = await consultar(
    "SELECT folio FROM ventas WHERE folio IN ('5550001', '5550002') ORDER BY folio");
  assert.deepEqual(folios.map((f) => f.folio), ['5550001', '5550002']);
});
