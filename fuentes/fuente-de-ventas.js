// Interfaz abstracta de fuentes de ventas (SPEC sección 6).
//
// El resto del sistema no debe saber de dónde vienen las ventas: cambiar de
// fuente (manual → ControlGAS) no debe requerir tocar la lógica de boletos.
//
// Toda fuente entrega ventas normalizadas con esta forma:
//   { folio, fecha_hora (Date), producto, litros, importe }
//
// Implementaciones:
//   - FuenteManual (fuente-manual.js) — CSV cargado desde el panel. Funciona hoy.
//   - FuenteControlGAS — pendiente de respuesta de CTN sobre el mecanismo
//     (API, lectura de base de datos o exportación automática).

class FuenteDeVentas {
  /**
   * @returns {Promise<{ventas: Array<object>, errores: Array<string>}>}
   */
  async obtenerVentas() {
    throw new Error('obtenerVentas() debe implementarse en la fuente concreta');
  }
}

module.exports = { FuenteDeVentas };
