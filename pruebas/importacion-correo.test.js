// Pruebas de la ORDEN 10: importación automática por correo. La conexión
// IMAP es inyectable, así que todo el flujo se prueba sin buzón real, con
// correos MIME construidos aquí mismo y el fixture sintético de la ORDEN 7.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const { leerConfiguracion } = require('../lib/configuracion');
const correo = require('../servicios/importacion-correo');

const hayBD = configurada();
let rubioId;
let campoId;

// ---------- Fixture .xlsx sintético (estructura de ControlGAS) ----------

const ENCABEZADOS = ['Fecha', 'Turno', 'Hora', 'Despacho', 'Posición', 'Producto',
  'Cantidad', 'Precio', 'Importe', 'Despachador', 'Nota', 'Factura', 'UUID',
  'Fecha Factura', 'Cliente', 'Código', 'Tipo', 'Vehículo', 'Placas', 'Datos'];

function fechaDeHoy() {
  const hoy = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(hoy.getDate())}/${dos(hoy.getMonth() + 1)}/${hoy.getFullYear()}`;
}

function fixtureXLSX(folios) {
  const f = fechaDeHoy();
  const fila = (folio, hora) => {
    const base = new Array(ENCABEZADOS.length).fill(null);
    base[0] = f; base[1] = 1; base[2] = hora; base[3] = `${folio}-0`;
    base[5] = 'MAGNA'; base[6] = 40; base[7] = 35; base[8] = 1400;
    return base;
  };
  const filas = [[], [], [`Control de Despachos - ${f}`], [], ['ESTACION SINTETICA, S.A. DE C.V.'], [],
    ENCABEZADOS, ...folios.map((folio, i) => fila(folio, `0${8 + i}:15:00`)), [ 'TOTALES' ]];
  const hoja = XLSX.utils.aoa_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Control de Despachos');
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
}

// ---------- Correos MIME y conexión falsa ----------

function correoMIME({ de, id, adjuntos = [] }) {
  const partes = [
    `Message-ID: <${id}>`,
    `From: Estacion <${de}>`,
    'To: buzon-importa@ferez.mx',
    'Subject: Despachos del dia',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="FRONTERA"',
    '',
    '--FRONTERA',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Adjunto el archivo del dia.',
  ];
  for (const adjunto of adjuntos) {
    partes.push('--FRONTERA',
      `Content-Type: application/octet-stream; name="${adjunto.nombre}"`,
      `Content-Disposition: attachment; filename="${adjunto.nombre}"`,
      'Content-Transfer-Encoding: base64',
      '',
      adjunto.contenido.toString('base64'));
  }
  partes.push('--FRONTERA--', '');
  return Buffer.from(partes.join('\r\n'));
}

function conexionFalsa(correos) {
  const acciones = { leidos: [], revisiones: [], cerrada: false };
  return {
    acciones,
    async listarNoLeidos() {
      return correos.filter((c) => !acciones.leidos.includes(c.uid)).map((c) => ({ uid: c.uid }));
    },
    async obtenerFuente(uid) { return correos.find((c) => c.uid === uid).crudo; },
    async marcarLeido(uid) { acciones.leidos.push(uid); },
    async marcarParaRevision(uid) { acciones.revisiones.push(uid); },
    async cerrar() { acciones.cerrada = true; },
  };
}

async function contarVentas() {
  const [{ total }] = await consultar("SELECT COUNT(*) AS total FROM ventas WHERE origen = 'controlgas'");
  return Number(total);
}

// ---------- Preparación ----------

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  for (const tabla of ['sellos', 'boletos', 'emisiones', 'bitacora_boletos', 'ventas', 'clientes',
    'mensajes_whatsapp', 'archivos_importados', 'correos_importados', 'remitentes_autorizados']) {
    await consultar(`DELETE FROM ${tabla}`);
  }
  await consultar('UPDATE importacion_correo_estado SET ultima_revision = NULL, detalle = NULL WHERE id = 1');
  // Sin alertas de faltante mientras se prueba el buzón.
  await consultar("UPDATE configuracion SET valor = '23:59' WHERE clave = 'hora_limite_archivo'");
  const estaciones = await consultar('SELECT id, nombre FROM estaciones');
  rubioId = estaciones.find((e) => e.nombre === 'Rubio').id;
  campoId = estaciones.find((e) => e.nombre === 'Km 12.9 Corredor Comercial').id;
  await consultar(
    "INSERT INTO remitentes_autorizados (correo, estacion_id, dado_de_alta_por) VALUES ('rubio@test.com', ?, 'prueba')",
    [rubioId]);
});

after(async () => {
  if (hayBD) await obtenerPool().end();
});

// ---------- Pruebas ----------

test('remitente autorizado: importa a SU estación y guarda el archivo con SHA-256', { skip: !hayBD }, async () => {
  const archivo = fixtureXLSX(['7010001', '7010002']);
  const conexion = conexionFalsa([
    { uid: 1, crudo: correoMIME({ de: 'rubio@test.com', id: 'c1@test', adjuntos: [{ nombre: 'dia.xlsx', contenido: archivo }] }) },
  ]);
  const r = await correo.revisarBuzon({ conexion });
  assert.equal(r.ok, true);
  assert.equal(r.procesados, 1);
  assert.equal(await contarVentas(), 2);
  const [venta] = await consultar("SELECT estacion_id FROM ventas WHERE folio = '7010001'");
  assert.equal(venta.estacion_id, rubioId, 'la estación la decide la lista blanca');

  const [guardado] = await consultar('SELECT * FROM archivos_importados');
  assert.equal(guardado.nombre_archivo, 'dia.xlsx');
  assert.equal(guardado.sha256, require('crypto').createHash('sha256').update(archivo).digest('hex'));
  assert.equal(Buffer.compare(guardado.contenido, archivo), 0, 'el original queda íntegro');
  assert.equal(guardado.reporte.includes('2 aceptadas'), true);

  const [registro] = await consultar("SELECT resultado FROM correos_importados WHERE message_id = '<c1@test>'");
  assert.equal(registro.resultado, 'procesado');
  assert.deepEqual(conexion.acciones.leidos, [1]);
  const [estado] = await consultar('SELECT ultima_revision FROM importacion_correo_estado WHERE id = 1');
  assert.equal(Boolean(estado.ultima_revision), true, 'última revisión registrada');
});

test('el mismo correo dos veces = una sola importación', { skip: !hayBD }, async () => {
  const archivo = fixtureXLSX(['7010001', '7010002']);
  const conexion = conexionFalsa([
    { uid: 9, crudo: correoMIME({ de: 'rubio@test.com', id: 'c1@test', adjuntos: [{ nombre: 'dia.xlsx', contenido: archivo }] }) },
  ]);
  const r = await correo.revisarBuzon({ conexion });
  assert.equal(r.yaProcesados, 1);
  assert.equal(r.procesados, 0);
  assert.equal(await contarVentas(), 2, 'no importó de nuevo');
  const [{ total }] = await consultar("SELECT COUNT(*) AS total FROM correos_importados WHERE message_id = '<c1@test>'");
  assert.equal(Number(total), 1);
});

test('mismo archivo reenviado (correo nuevo) = todo duplicado, cero insertadas', { skip: !hayBD }, async () => {
  const archivo = fixtureXLSX(['7010001', '7010002']);
  const conexion = conexionFalsa([
    { uid: 2, crudo: correoMIME({ de: 'rubio@test.com', id: 'c2@test', adjuntos: [{ nombre: 'dia-otra-vez.xlsx', contenido: archivo }] }) },
  ]);
  const r = await correo.revisarBuzon({ conexion });
  assert.equal(r.procesados, 1);
  assert.equal(await contarVentas(), 2, 'cero ventas nuevas');
  const [registro] = await consultar("SELECT detalle FROM correos_importados WHERE message_id = '<c2@test>'");
  assert.equal(registro.detalle.includes('0 aceptadas'), true);
  assert.equal(registro.detalle.includes('2 duplicadas'), true);
});

test('remitente desconocido: se rechaza en silencio y queda en bitácora', { skip: !hayBD }, async () => {
  const conexion = conexionFalsa([
    { uid: 3, crudo: correoMIME({ de: 'intruso@malo.com', id: 'c3@test', adjuntos: [{ nombre: 'x.xlsx', contenido: fixtureXLSX(['9990001']) }] }) },
  ]);
  const r = await correo.revisarBuzon({ conexion });
  assert.equal(r.rechazados, 1);
  assert.deepEqual(conexion.acciones.leidos, [3], 'marcado leído');
  const [{ total }] = await consultar("SELECT COUNT(*) AS total FROM ventas WHERE folio = '9990001'");
  assert.equal(Number(total), 0, 'nada se importó');
  const [asiento] = await consultar(
    "SELECT detalle FROM bitacora_boletos WHERE tipo = 'correo' AND resultado = 'CORREO_RECHAZADO'");
  assert.equal(asiento.detalle.includes('intruso@malo.com'), true);
  assert.equal(asiento.detalle.includes('sin respuesta'), true);
});

test('adjunto que no es Excel se ignora; una falla no detiene el resto', { skip: !hayBD }, async () => {
  const corrupto = Buffer.concat([Buffer.from('PK'), Buffer.from('esto no es un zip de verdad')]);
  const bueno = fixtureXLSX(['7020001']);
  const conexion = conexionFalsa([
    { uid: 4, crudo: correoMIME({ de: 'rubio@test.com', id: 'c4@test', adjuntos: [
      { nombre: 'notas.txt', contenido: Buffer.from('solo texto') },
      { nombre: 'roto.xlsx', contenido: corrupto },
      { nombre: 'bueno.xlsx', contenido: bueno },
    ] }) },
  ]);
  const r = await correo.revisarBuzon({ conexion });
  assert.equal(r.errores, 1, 'el correo queda con error por el adjunto roto');
  const [{ total }] = await consultar("SELECT COUNT(*) AS total FROM ventas WHERE folio = '7020001'");
  assert.equal(Number(total), 1, 'el adjunto bueno sí se importó');
  assert.deepEqual(conexion.acciones.revisiones, [4], 'correo marcado para revisión');
  const [registro] = await consultar("SELECT resultado, detalle FROM correos_importados WHERE message_id = '<c4@test>'");
  assert.equal(registro.resultado, 'error');
  assert.equal(registro.detalle.includes('ignorados'), true, 'el .txt se contó como ignorado');
  const [asientoError] = await consultar(
    "SELECT detalle FROM bitacora_boletos WHERE tipo = 'correo' AND resultado = 'CORREO_ERROR'");
  assert.equal(asientoError.detalle.includes('roto.xlsx'), true);
});

test('sin variables de entorno todo queda apagado y nada truena', { skip: !hayBD }, async () => {
  const anteriores = { ...process.env };
  delete process.env.IMPORT_MAIL_HOST;
  delete process.env.IMPORT_MAIL_USER;
  delete process.env.IMPORT_MAIL_PASSWORD;
  try {
    assert.equal(correo.configurado(), false);
    const r = await correo.revisarBuzon();
    assert.equal(r.ok, false);
    assert.equal(r.apagado, true);
    assert.equal(correo.iniciarRevisionPeriodica(), false);
  } finally {
    Object.assign(process.env, anteriores);
  }
});

test('la contraseña del buzón jamás llega a bitácora ni a los registros', { skip: !hayBD }, async () => {
  process.env.IMPORT_MAIL_HOST = 'imap.test';
  process.env.IMPORT_MAIL_USER = 'buzon@test';
  process.env.IMPORT_MAIL_PASSWORD = 'SUPERSECRETA-XYZ-999';
  try {
    const conexion = {
      async listarNoLeidos() { throw new Error('fallo de red simulado'); },
      async cerrar() {},
    };
    const r = await correo.revisarBuzon({ conexion });
    assert.equal(r.ok, false);
    assert.equal(r.mensaje.includes('SUPERSECRETA'), false);
    for (const tabla of ['bitacora_boletos', 'correos_importados', 'importacion_correo_estado']) {
      const filas = await consultar(`SELECT COUNT(*) AS total FROM ${tabla} WHERE detalle LIKE '%SUPERSECRETA%'`);
      assert.equal(Number(filas[0].total), 0, `sin contraseña en ${tabla}`);
    }
  } finally {
    delete process.env.IMPORT_MAIL_HOST;
    delete process.env.IMPORT_MAIL_USER;
    delete process.env.IMPORT_MAIL_PASSWORD;
  }
});

test('alerta de archivo faltante: aparece, se asienta una vez al día y desaparece', { skip: !hayBD }, async () => {
  await consultar("UPDATE configuracion SET valor = '00:00' WHERE clave = 'hora_limite_archivo'");
  await consultar('UPDATE estaciones SET espera_archivo_diario = 1 WHERE id IN (?, ?)', [rubioId, campoId]);
  const config = await leerConfiguracion();
  const zona = config.zona_horaria || 'America/Chihuahua';
  const ayer = new Intl.DateTimeFormat('sv-SE', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - 86400000));

  // Rubio sí tiene ventas de ayer; Campo no.
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, importe, origen) VALUES (?, 'AYER-1', ?, 700, 'controlgas')`,
    [rubioId, `${ayer} 12:00:00`]);

  let faltantes = await correo.estacionesConArchivoFaltante(config);
  assert.deepEqual(faltantes.map((e) => e.nombre), ['Km 12.9 Corredor Comercial']);

  await correo.revisarArchivosFaltantes(config);
  await correo.revisarArchivosFaltantes(config); // segunda pasada: no duplica
  const [{ total }] = await consultar(
    "SELECT COUNT(*) AS total FROM bitacora_boletos WHERE tipo = 'correo' AND resultado = 'ARCHIVO_FALTANTE'");
  assert.equal(Number(total), 1, 'una sola vez al día');

  // Con el archivo de Campo importado, la alerta desaparece.
  await consultar(
    `INSERT INTO ventas (estacion_id, folio, fecha_hora, importe, origen) VALUES (?, 'AYER-2', ?, 700, 'controlgas')`,
    [campoId, `${ayer} 13:00:00`]);
  faltantes = await correo.estacionesConArchivoFaltante(config);
  assert.deepEqual(faltantes, []);

  // Antes de la hora límite tampoco hay alerta.
  await consultar("UPDATE configuracion SET valor = '23:59' WHERE clave = 'hora_limite_archivo'");
  faltantes = await correo.estacionesConArchivoFaltante(await leerConfiguracion());
  assert.deepEqual(faltantes, []);
});

test('el resumen del panel refleja archivos, estado y problemas', { skip: !hayBD }, async () => {
  const { estado, ultimos, problemas } = await correo.resumenPanel();
  assert.equal(Boolean(estado.ultima_revision), true);
  assert.equal(ultimos.some((a) => a.estacion === 'Rubio'), true, 'último archivo de Rubio presente');
  assert.equal(problemas.some((p) => p.resultado === 'rechazado'), true);
  assert.equal(problemas.some((p) => p.resultado === 'error'), true);
});
