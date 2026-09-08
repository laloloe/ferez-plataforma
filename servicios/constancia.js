// Constancia electrónica del boleto (ORDEN 8 — Reglamento art. 3, fr. III:
// los derechos y leyendas del boleto pueden estar "contenidos en el sistema
// en donde se resguarden los registros").
//
// La constancia SOLO se muestra si número de boleto y teléfono del titular
// coinciden; en cualquier otro caso la respuesta es genérica y no revela si
// el boleto existe. Todo lo que sale hacia la página pública va enmascarado
// igual que el padrón: primer nombre + inicial, jamás el teléfono.

const PDFDocument = require('pdfkit');
const { consultar } = require('../lib/db');
const { normalizarTelefono } = require('../lib/telefono');
const { enmascararNombre, MOTIVO_PUBLICO_ANULADO } = require('./padron');

const LIMITE_INTENTOS_HORA = 10;

const DENOMINACION =
  'SORTEO FEREZ 2027, organizado por Estación de Servicio Feres, S.A. de C.V. ' +
  'y Servicio Gasolinero del Campo, S.A. de C.V.';

// Leyendas exigidas por el Reglamento, con los datos variables desde configuracion.
function leyendas(config) {
  const monto = Number(config.monto_por_boleto) || 700;
  const telefono = String(config.telefono_aclaraciones ?? '').trim();
  return {
    condicion:
      `Condición de participación: un boleto por cada $${monto.toLocaleString('es-MX')} de combustible ` +
      'en una misma operación, acumulable, sin costo adicional para el participante.',
    fijas: [
      'La participación en el sorteo es de acceso libre y gratuito.',
      'Conserva esta constancia: es el registro electrónico de tu boleto.',
      'Los premios caducan a los 20 días hábiles siguientes a la celebración del sorteo.',
      'En caso de robo o extravío del comprobante, presenta la denuncia correspondiente ante el Ministerio Público.',
      'Los premios se entregan conforme a las bases publicadas en ferez.mx/bases.',
      `Aclaraciones: ${telefono || 'en tu estación Ferez participante'}.`,
      'Quejas: Dirección General de Juegos y Sorteos de la Secretaría de Gobernación, ' +
        'Versalles 49, Col. Juárez, Ciudad de México, tel. 55 5209 8800.',
    ],
  };
}

function permisoEnTramite(config) {
  return !String(config.numero_permiso ?? '').trim();
}

function textoPermiso(config) {
  return permisoEnTramite(config)
    ? 'Permiso ante la Secretaría de Gobernación: EN TRÁMITE — DOCUMENTO SIN VALIDEZ.'
    : `Permiso otorgado por la Secretaría de Gobernación con el número ${String(config.numero_permiso).trim()}.`;
}

// "SF27-000123", "sf27000123" o "123" → 123. null si no es reconocible.
function interpretarBoleto(texto) {
  const limpio = String(texto ?? '').trim();
  const coincidencia = limpio.match(/^(?:[A-Za-z]{2}\d{2}-?)?(\d{1,10})$/);
  return coincidencia ? Number(coincidencia[1]) : null;
}

// ---------- Límite de intentos y bitácora ----------

async function intentosUltimaHora(telefono, ip) {
  const [{ total }] = await consultar(
    `SELECT COUNT(*) AS total FROM bitacora_boletos
     WHERE tipo = 'constancia' AND fecha > DATE_SUB(NOW(), INTERVAL 1 HOUR)
       AND (telefono = ? OR detalle LIKE ?)`,
    [telefono ?? '', `%[IP ${ip}]%`]);
  return Number(total);
}

async function registrarIntento({ telefono, ip, boleto, resultado }) {
  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, telefono, folio_venta, resultado, detalle)
     VALUES ('publico:constancia', 'constancia', ?, ?, ?, ?)`,
    [telefono ?? null, String(boleto ?? '').slice(0, 50) || null, resultado,
     `[IP ${ip}] consulta de constancia`]);
}

// ---------- Consulta ----------

async function consultarConstancia({ boleto, telefono, ip }) {
  const telefonoE164 = normalizarTelefono(String(telefono ?? ''));
  const ipTexto = String(ip ?? 'desconocida');

  if (await intentosUltimaHora(telefonoE164, ipTexto) >= LIMITE_INTENTOS_HORA) {
    await registrarIntento({ telefono: telefonoE164, ip: ipTexto, boleto, resultado: 'LIMITE_EXCEDIDO' });
    return { ok: false, codigo: 'LIMITE_EXCEDIDO' };
  }

  const numero = interpretarBoleto(boleto);
  let fila = null;
  if (numero !== null && telefonoE164) {
    [fila] = await consultar(
      `SELECT b.folio_boleto, b.numero, b.fecha_emision, b.estado, b.origen,
              c.nombre AS cliente, c.telefono,
              e.nombre AS estacion, v.folio AS folio_venta, v.importe
       FROM boletos b
       JOIN clientes c ON c.id = b.cliente_id
       LEFT JOIN estaciones e ON e.id = b.estacion_id
       LEFT JOIN ventas v ON v.id = b.venta_id
       WHERE b.numero = ?`, [numero]);
  }
  if (!fila || fila.telefono !== telefonoE164) {
    await registrarIntento({ telefono: telefonoE164, ip: ipTexto, boleto, resultado: 'NO_COINCIDE' });
    return { ok: false, codigo: 'NO_COINCIDE' };
  }

  await registrarIntento({ telefono: telefonoE164, ip: ipTexto, boleto: fila.folio_boleto, resultado: 'OK' });
  return {
    ok: true,
    constancia: {
      boleto: fila.folio_boleto,
      folio_operacion: fila.folio_venta ?? '—',
      fecha_emision: fila.fecha_emision,
      estacion: fila.origen === 'compra' ? 'Oficina' : (fila.estacion ?? '—'),
      origen: fila.origen === 'compra' ? 'Oficina' : 'Carga',
      estado: fila.estado === 'anulado' ? MOTIVO_PUBLICO_ANULADO : 'Vigente',
      monto: fila.importe != null ? Number(fila.importe) : null,
      titular: enmascararNombre(fila.cliente),
    },
  };
}

// ---------- Muestra en PDF para el expediente ante la SEGOB ----------

// Constancia de un boleto FICTICIO con todas las leyendas y el número de
// permiso en blanco. compress:false para poder verificar el texto en pruebas.
function generarMuestraPDF(config) {
  const { condicion, fijas } = leyendas(config);
  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 60, compress: false });
    const pedazos = [];
    doc.on('data', (pedazo) => pedazos.push(pedazo));
    doc.on('end', () => resolver(Buffer.concat(pedazos)));
    doc.on('error', rechazar);

    const marcaDeAgua = () => {
      doc.save();
      doc.rotate(-35, { origin: [306, 396] });
      doc.font('Helvetica-Bold').fontSize(80).fillColor('#D0D0D0').opacity(0.45);
      doc.text('MUESTRA', 0, 356, { align: 'center', width: 612 });
      doc.restore();
      doc.opacity(1).fillColor('#000000');
    };
    marcaDeAgua();
    doc.on('pageAdded', marcaDeAgua);

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#000000')
      .text('CONSTANCIA ELECTRÓNICA DE BOLETO — MUESTRA', { align: 'center' });
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(12).text(DENOMINACION, { align: 'center' });
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(11).text(
      'Permiso otorgado por la Secretaría de Gobernación con el número: ______________________',
      { align: 'center' });
    doc.moveDown(1);

    const dato = (etiqueta, valor) => {
      doc.font('Helvetica-Bold').fontSize(11).text(`${etiqueta}: `, { continued: true });
      doc.font('Helvetica').text(valor);
    };
    dato('Número de boleto', 'SF27-000000 (ejemplo)');
    dato('Folio de la operación', '0000000 (ejemplo)');
    dato('Fecha y hora de emisión', '01/01/2027 12:00 (ejemplo)');
    dato('Estación', 'Estación Ferez participante (ejemplo)');
    dato('Origen', 'Carga de combustible');
    dato('Estado', 'Vigente');
    dato('Monto elegible de la operación', '$700.00 (ejemplo)');
    dato('Titular', 'Nombre A. (primer nombre e inicial del apellido)');
    doc.moveDown(0.8);

    dato('Vigencia de la promoción', String(config.vigencia_promocion ?? ''));
    dato('Fecha del sorteo', String(config.fecha_sorteo ?? ''));
    doc.moveDown(0.8);

    doc.font('Helvetica').fontSize(11).text(condicion);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('Leyendas');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10.5);
    for (const leyenda of fijas) doc.text(`— ${leyenda}`, { indent: 10 });
    doc.moveDown(0.8);

    doc.font('Helvetica').fontSize(10).fillColor('#444444').text(
      'Documento de muestra para el expediente de solicitud de permiso: los datos del boleto ' +
      'son ficticios y el número de permiso se integrará una vez otorgado. La constancia real ' +
      'de cada boleto se consulta en ferez.mx/constancia con el número de boleto y el teléfono ' +
      'del titular.');
    doc.end();
  });
}

module.exports = {
  DENOMINACION,
  LIMITE_INTENTOS_HORA,
  leyendas,
  permisoEnTramite,
  textoPermiso,
  interpretarBoleto,
  consultarConstancia,
  generarMuestraPDF,
};
