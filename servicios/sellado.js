// Sellado del padrón (ORDEN 5 — SPEC 9-bis.2).
//
// CSV canónico: exactamente las columnas públicas, un renglón por boleto
// (anulados incluidos), ordenado por número, UTF-8, LF, sin BOM. La forma es
// fija para que el SHA-256 sea reproducible. Los artefactos del sellado real
// se guardan en la tabla `sellos` y se sirven tal cual: nunca se regeneran.

const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { consultar } = require('../lib/db');
const { leerConfiguracion } = require('../lib/configuracion');
const reglas = require('./reglas-boletos');
const { MOTIVO_PUBLICO_ANULADO } = require('./padron');

const ENCABEZADO_CSV = 'boleto,fecha_emision,estacion,origen,estado';

function escaparCampoCSV(valor) {
  const texto = String(valor ?? '');
  return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

// CSV canónico del padrón completo. Devuelve un Buffer UTF-8 (LF, sin BOM).
async function generarCSVCanonico() {
  const filas = await consultar(
    `SELECT b.folio_boleto, DATE_FORMAT(b.fecha_emision, '%Y-%m-%d %H:%i:%s') AS fecha,
            b.origen, b.estado, e.nombre AS estacion
     FROM boletos b LEFT JOIN estaciones e ON e.id = b.estacion_id
     ORDER BY b.numero`);
  const lineas = [ENCABEZADO_CSV];
  for (const fila of filas) {
    lineas.push([
      fila.folio_boleto,
      fila.fecha,
      fila.origen === 'compra' ? 'Oficina' : (fila.estacion ?? '—'),
      fila.origen === 'compra' ? 'Oficina' : 'Carga',
      fila.estado === 'anulado' ? MOTIVO_PUBLICO_ANULADO : 'Vigente',
    ].map(escaparCampoCSV).join(','));
  }
  return Buffer.from(lineas.join('\n') + '\n', 'utf8');
}

async function calcularResumen() {
  const porEstacion = await consultar(
    `SELECT COALESCE(e.nombre, 'Oficina') AS nombre, COUNT(*) AS total
     FROM boletos b LEFT JOIN estaciones e ON e.id = b.estacion_id
     GROUP BY nombre ORDER BY nombre`);
  const porOrigen = await consultar(
    `SELECT IF(origen = 'compra', 'Oficina', 'Carga') AS nombre, COUNT(*) AS total
     FROM boletos GROUP BY nombre ORDER BY nombre`);
  const porEstado = await consultar(
    `SELECT IF(estado = 'vigente', 'Vigentes', 'Anulados') AS nombre, COUNT(*) AS total
     FROM boletos GROUP BY nombre ORDER BY nombre`);
  const [{ total }] = await consultar('SELECT COUNT(*) AS total FROM boletos');
  const aNumeros = (filas) => filas.map((f) => ({ nombre: f.nombre, total: Number(f.total) }));
  return {
    porEstacion: aNumeros(porEstacion),
    porOrigen: aNumeros(porOrigen),
    porEstado: aNumeros(porEstado),
    total: Number(total),
  };
}

// Acta PDF (1-3 páginas). Sin datos personales. compress:false para poder
// verificar en pruebas que no contiene teléfonos ni nombres.
function generarActaPDF({ esPrueba, fechaLocal, zonaHoraria, resumen, sha256 }) {
  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 60, compress: false });
    const pedazos = [];
    doc.on('data', (pedazo) => pedazos.push(pedazo));
    doc.on('end', () => resolver(Buffer.concat(pedazos)));
    doc.on('error', rechazar);

    const marcaDeAgua = () => {
      if (!esPrueba) return;
      doc.save();
      doc.rotate(-35, { origin: [306, 396] });
      doc.font('Helvetica-Bold').fontSize(52).fillColor('#D0D0D0').opacity(0.5);
      doc.text('PRUEBA — SIN VALIDEZ', 0, 360, { align: 'center', width: 612 });
      doc.restore();
      doc.opacity(1).fillColor('#000000');
    };
    marcaDeAgua();
    doc.on('pageAdded', marcaDeAgua);

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#000000')
      .text(esPrueba ? 'SIMULACRO DE ACTA — SIN VALIDEZ' : 'Acta de sellado del padrón', { align: 'center' });
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(15).text('Sorteo Ferez 2027', { align: 'center' });
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(11)
      .text(`Fecha y hora del sellado: ${fechaLocal} (hora local, ${zonaHoraria})`, { align: 'center' });
    doc.moveDown(1.2);

    const tabla = (titulo, filas) => {
      doc.font('Helvetica-Bold').fontSize(12).text(titulo);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(11);
      for (const fila of filas) {
        doc.text(`${fila.nombre}: ${fila.total.toLocaleString('es-MX')} boletos`, { indent: 16 });
      }
      doc.moveDown(0.8);
    };
    tabla('Boletos por estación', resumen.porEstacion);
    tabla('Boletos por origen', resumen.porOrigen);
    tabla('Boletos por estado', resumen.porEstado);

    doc.font('Helvetica-Bold').fontSize(14)
      .text(`Total general: ${resumen.total.toLocaleString('es-MX')} boletos`);
    doc.moveDown(1.2);

    doc.font('Helvetica-Bold').fontSize(12).text('Huella digital SHA-256 del padrón (archivo CSV):');
    doc.moveDown(0.4);
    doc.font('Courier-Bold').fontSize(15).text(sha256.slice(0, 32), { align: 'center' });
    doc.font('Courier-Bold').fontSize(15).text(sha256.slice(32), { align: 'center' });
    doc.moveDown(1);

    doc.font('Helvetica').fontSize(10.5).text(
      'Cómo verificarlo: descargue el archivo CSV del padrón y calcule su huella SHA-256 ' +
      '(en Windows: certutil -hashfile archivo SHA256; en Mac o Linux: shasum -a 256 archivo). ' +
      'Si la huella coincide con la impresa en esta acta, la lista no fue alterada.');
    doc.end();
  });
}

// Ejecuta un sellado. tipo: 'simulacro' (repetible, no congela nada) o
// 'real' (una sola vez, solo con el padrón cerrado).
async function ejecutarSellado(tipo, actor) {
  const config = await leerConfiguracion();
  const zonaHoraria = config.zona_horaria || 'America/Chihuahua';

  if (tipo === 'real') {
    const cerrado = reglas.padronCerrado({ cierrePadron: config.cierre_padron, zonaHoraria });
    if (!cerrado) {
      return { ok: false, mensaje: `El padrón aún no está cerrado (cierre: ${config.cierre_padron}). El sellado real solo procede con el padrón cerrado.` };
    }
    if (await selloReal()) {
      return { ok: false, mensaje: 'El sellado real ya se ejecutó. Es único y no se repite.' };
    }
  }

  const fechaLocal = reglas.ahoraLocal(zonaHoraria);
  const csv = await generarCSVCanonico();
  const sha256 = crypto.createHash('sha256').update(csv).digest('hex');
  const resumen = await calcularResumen();
  const acta = await generarActaPDF({
    esPrueba: tipo === 'simulacro', fechaLocal, zonaHoraria, resumen, sha256,
  });

  let selloId;
  try {
    const filas = await consultar(
      `INSERT INTO sellos (tipo, es_real, fecha_local, actor, sha256, total, resumen, csv, acta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tipo, tipo === 'real' ? 1 : null, fechaLocal, actor, sha256, resumen.total,
       JSON.stringify(resumen), csv, acta]);
    selloId = filas.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return { ok: false, mensaje: 'El sellado real ya se ejecutó. Es único y no se repite.' };
    }
    throw err;
  }

  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, resultado, detalle, boletos_generados)
     VALUES (?, 'sellado', 'OK', ?, 0)`,
    [actor, `${tipo === 'real' ? 'SELLADO REAL' : 'Simulacro de sellado'} #${selloId}: ${resumen.total} boletos, SHA-256 ${sha256}`]);

  return { ok: true, id: selloId, sha256, total: resumen.total, fechaLocal, tipo };
}

// El sellado real es irreversible: una vez visto, se cachea.
let cacheSelloReal = null;

async function selloReal() {
  if (cacheSelloReal) return cacheSelloReal;
  const [sello] = await consultar(
    `SELECT id, fecha_local, actor, sha256, total, resumen FROM sellos WHERE es_real = 1`);
  if (sello) cacheSelloReal = { ...sello, resumen: JSON.parse(sello.resumen) };
  return cacheSelloReal;
}

async function haySelloReal() {
  return Boolean(await selloReal());
}

async function archivosDeSello(id) {
  const [sello] = await consultar('SELECT tipo, sha256, csv, acta FROM sellos WHERE id = ?', [id]);
  return sello ?? null;
}

async function listarSellos() {
  return consultar(
    'SELECT id, tipo, fecha_local, actor, sha256, total FROM sellos ORDER BY id DESC LIMIT 50');
}

// Solo para pruebas: olvida el cache del sello real.
function _limpiarCacheSelloReal() {
  cacheSelloReal = null;
}

module.exports = {
  ENCABEZADO_CSV,
  generarCSVCanonico,
  calcularResumen,
  ejecutarSellado,
  selloReal,
  haySelloReal,
  archivosDeSello,
  listarSellos,
  _limpiarCacheSelloReal,
};
