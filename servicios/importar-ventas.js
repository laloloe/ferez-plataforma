// Inserción de ventas importadas (CSV manual o export de ControlGAS) con
// deduplicación por estación + folio y asiento resumen en bitácora.

const { consultar } = require('../lib/db');

async function importarVentas({ estacionId, ventas, origen, actor }) {
  let insertadas = 0;
  const duplicadas = [];
  for (const venta of ventas) {
    const resultado = await consultar(
      `INSERT IGNORE INTO ventas
         (estacion_id, folio, fecha_hora, producto, litros, importe, forma_pago,
          tipo_pago, datos_pago, cliente_nombre, cliente_codigo, nota, origen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [estacionId, venta.folio, venta.fecha_hora, venta.producto ?? null,
       venta.litros ?? null, venta.importe ?? null, venta.forma_pago ?? null,
       venta.tipo_pago ?? null, venta.datos_pago ?? null, venta.cliente_nombre ?? null,
       venta.cliente_codigo ?? null, venta.nota ?? null, origen]);
    if (resultado.affectedRows > 0) insertadas++;
    else duplicadas.push(venta);
  }
  return { insertadas, duplicadas: duplicadas.length, filasDuplicadas: duplicadas };
}

async function registrarImportacion({ actor, estacionId, detalle }) {
  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, estacion_id, resultado, detalle)
     VALUES (?, 'captura', ?, 'IMPORTACION', ?)`,
    [actor, estacionId, detalle]);
}

module.exports = { importarVentas, registrarImportacion };
