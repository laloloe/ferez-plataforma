// Reinicio de arranque (ORDEN 9): borra los datos de prueba para arrancar
// la captación real limpio, con el siguiente boleto en SF27-000001.
//
// Disponible SOLO mientras numero_permiso esté vacía Y no exista sellado
// real. Conserva usuarios, estaciones y configuracion; deja un asiento
// permanente en bitácora (tipo 'ajuste') con quién, cuándo y cuántos
// registros se eliminaron.

const { consultar } = require('../lib/db');
const { leerConfiguracion } = require('../lib/configuracion');
const sellado = require('./sellado');
const { reiniciarCacheContador } = require('./padron');

// Orden de borrado: primero las tablas que referencian a otras.
const ORDEN_TABLAS = ['boletos', 'emisiones', 'mensajes_whatsapp', 'estado_bot', 'ventas', 'clientes'];

// Asientos de negocio que se limpian; 'acceso' y 'ajuste' (sistema) se conservan.
const TIPOS_BITACORA_NEGOCIO = ['reclamo', 'compra', 'anulacion', 'captura', 'sellado', 'constancia'];

async function reinicioDisponible() {
  const config = await leerConfiguracion();
  if (String(config.numero_permiso ?? '').trim()) return false;
  if (await sellado.haySelloReal()) return false;
  return true;
}

async function reiniciarArranque(actor) {
  if (!(await reinicioDisponible())) {
    return {
      ok: false,
      mensaje: 'El reinicio de arranque solo está disponible sin número de permiso capturado y sin sellado real.',
    };
  }

  const conteos = {};
  for (const tabla of ORDEN_TABLAS) {
    const [{ total }] = await consultar(`SELECT COUNT(*) AS total FROM ${tabla}`);
    conteos[tabla] = Number(total);
  }
  const [{ total: simulacros }] = await consultar('SELECT COUNT(*) AS total FROM sellos WHERE es_real IS NULL');
  const marcadores = TIPOS_BITACORA_NEGOCIO.map(() => '?').join(', ');
  const [{ total: asientos }] = await consultar(
    `SELECT COUNT(*) AS total FROM bitacora_boletos WHERE tipo IN (${marcadores})`, TIPOS_BITACORA_NEGOCIO);

  for (const tabla of ORDEN_TABLAS) await consultar(`DELETE FROM ${tabla}`);
  await consultar('DELETE FROM sellos WHERE es_real IS NULL');
  await consultar(`DELETE FROM bitacora_boletos WHERE tipo IN (${marcadores})`, TIPOS_BITACORA_NEGOCIO);
  await consultar('UPDATE contador_boletos SET siguiente = 1 WHERE id = 1');
  reiniciarCacheContador();

  const resumen = { ...conteos, sellos_simulacro: Number(simulacros), bitacora_negocio: Number(asientos) };
  const detalle = 'REINICIO DE ARRANQUE — registros eliminados: ' +
    Object.entries(resumen).map(([tabla, total]) => `${tabla}=${total}`).join(', ') +
    '. Usuarios, estaciones y configuración conservados; consecutivo reiniciado a 1.';
  await consultar(
    `INSERT INTO bitacora_boletos (actor, tipo, resultado, detalle, boletos_generados)
     VALUES (?, 'ajuste', 'REINICIO', ?, 0)`,
    [actor, detalle.slice(0, 400)]);

  return { ok: true, conteos: resumen };
}

module.exports = { reinicioDisponible, reiniciarArranque };
