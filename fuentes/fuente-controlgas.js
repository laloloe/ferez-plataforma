// FuenteControlGAS (ORDEN 7): lee el export real "Control de Despachos" de
// ControlGAS (Excel .xlsx, un día por archivo).
//
// Estructura del archivo (tal cual lo genera ControlGAS):
//   fila 3: título "Control de Despachos - DD/MM/AAAA"
//   fila 5: razón social de la estación
//   fila 7: ENCABEZADOS (Fecha, Turno, Hora, Despacho, Posición, Producto,
//           Cantidad, Precio, Importe, Despachador, Nota, Factura, UUID,
//           Fecha Factura, Cliente, Código, Tipo, Vehículo, Placas, Datos)
//   fila 8+: datos
//   fila final: "TOTALES" en la columna Fecha — se ignora.
//
// Reglas de fila:
//   - Despacho vacío o Importe = 0 → se omite (no es venta) y se cuenta.
//   - Producto fuera de combustibles → se importa igual (el folio debe
//     existir para que el bot responda "producto no participante"); se
//     cuenta como no participante en el reporte.
//   - Tipo "Crédito"/"Contado" (vacío = contado). Datos, Cliente y Código
//     se guardan cuando existen (regla de flotillas). Nota es informativa.
//   - Vales: si Tipo o Datos contienen alguna palabra de la clave
//     `palabras_pago_excluido`, la forma de pago queda marcada 'vales'.
//   - Fecha de la venta = Fecha + Hora (Turno NO es la fecha).
//   - El folio se guarda en su forma canónica (normalizarFolio).

const XLSX = require('xlsx');
const { FuenteDeVentas } = require('./fuente-de-ventas');
const { normalizarFolio, normalizarTexto } = require('../servicios/reglas-boletos');

const ENCABEZADOS_REQUERIDOS = ['fecha', 'hora', 'despacho', 'producto', 'importe'];

// Serial de fecha de Excel → Date (época 1899-12-30).
function fechaDesdeSerial(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const utc = new Date(ms);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(),
    utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds());
}

function interpretarFecha(celda) {
  if (celda instanceof Date) return { anio: celda.getFullYear(), mes: celda.getMonth(), dia: celda.getDate() };
  if (typeof celda === 'number') { const f = fechaDesdeSerial(celda); return { anio: f.getFullYear(), mes: f.getMonth(), dia: f.getDate() }; }
  const m = String(celda ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return { anio: Number(m[3]), mes: Number(m[2]) - 1, dia: Number(m[1]) };
}

function interpretarHora(celda) {
  if (celda instanceof Date) return { h: celda.getHours(), m: celda.getMinutes(), s: celda.getSeconds() };
  if (typeof celda === 'number') { // fracción de día
    const segundos = Math.round((celda % 1) * 86400);
    return { h: Math.floor(segundos / 3600), m: Math.floor((segundos % 3600) / 60), s: segundos % 60 };
  }
  const m = String(celda ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return { h: 0, m: 0, s: 0 };
  return { h: Number(m[1]), m: Number(m[2]), s: Number(m[3] ?? 0) };
}

function interpretarNumero(celda) {
  if (typeof celda === 'number') return celda;
  const limpio = String(celda ?? '').replace(/[$\s,]/g, '');
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : null;
}

class FuenteControlGAS extends FuenteDeVentas {
  /**
   * @param contenido Buffer del .xlsx
   * @param opciones  { productosParticipantes: [...], palabrasPagoExcluido: [...] }
   */
  constructor(contenido, opciones = {}) {
    super();
    this.contenido = contenido;
    this.productosParticipantes = (opciones.productosParticipantes ?? []).map(normalizarTexto);
    this.palabrasPagoExcluido = (opciones.palabrasPagoExcluido ?? ['vale']).map(normalizarTexto);
  }

  async obtenerVentas() {
    let hoja;
    try {
      const libro = XLSX.read(this.contenido, { type: 'buffer', cellDates: true });
      hoja = libro.Sheets[libro.SheetNames[0]];
    } catch (err) {
      return { ventas: [], errores: [`El archivo no se pudo leer como Excel: ${err.message}`], omitidas: 0, noParticipantes: 0 };
    }
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null, raw: true });

    // Encabezados en la fila 7 (índice 6); si el layout cambiara, se buscan.
    let filaEncabezados = 6;
    const esFilaDeEncabezados = (fila) => {
      const nombres = (fila ?? []).map((c) => normalizarTexto(c));
      return ENCABEZADOS_REQUERIDOS.every((requerido) => nombres.includes(requerido));
    };
    if (!esFilaDeEncabezados(filas[filaEncabezados])) {
      filaEncabezados = filas.findIndex(esFilaDeEncabezados);
      if (filaEncabezados < 0) {
        return { ventas: [], errores: ['No se encontró la fila de encabezados (Fecha, Hora, Despacho, Producto, Importe). ¿Es el export "Control de Despachos"?'], omitidas: 0, noParticipantes: 0 };
      }
    }
    const columnas = {};
    (filas[filaEncabezados] ?? []).forEach((celda, indice) => {
      const nombre = normalizarTexto(celda);
      if (nombre) columnas[nombre] = indice;
    });
    const valor = (fila, nombre) => (columnas[nombre] === undefined ? null : fila[columnas[nombre]]);

    const ventas = [];
    const errores = [];
    let omitidas = 0;
    let noParticipantes = 0;

    for (let i = filaEncabezados + 1; i < filas.length; i++) {
      const fila = filas[i];
      if (!fila || fila.every((c) => c === null || c === '')) continue;
      const numeroFila = i + 1;

      // Fila final de TOTALES: se ignora.
      if (normalizarTexto(valor(fila, 'fecha')) === 'totales') continue;

      const folio = normalizarFolio(valor(fila, 'despacho'));
      const importe = interpretarNumero(valor(fila, 'importe'));
      if (!folio || !importe) { omitidas++; continue; } // sin despacho o importe 0: no es venta

      const fecha = interpretarFecha(valor(fila, 'fecha'));
      if (!fecha) { errores.push(`Fila ${numeroFila}: fecha no reconocida ("${valor(fila, 'fecha')}").`); continue; }
      const hora = interpretarHora(valor(fila, 'hora'));
      const fechaHora = new Date(fecha.anio, fecha.mes, fecha.dia, hora.h, hora.m, hora.s);

      const producto = String(valor(fila, 'producto') ?? '').trim() || null;
      const participante = producto
        ? this.productosParticipantes.includes(normalizarTexto(producto))
        : true;
      if (!participante) noParticipantes++;

      const tipo = String(valor(fila, 'tipo') ?? '').trim() || 'Contado';
      const datos = String(valor(fila, 'datos') ?? '').trim() || null;
      const textoPago = `${normalizarTexto(tipo)} ${normalizarTexto(datos)}`;
      const esVales = this.palabrasPagoExcluido.some((palabra) => palabra && textoPago.includes(palabra));
      const formaPago = esVales ? 'vales' : normalizarTexto(tipo).includes('credito') ? 'credito' : 'contado';

      ventas.push({
        fila: numeroFila,
        folio,
        fecha_hora: fechaHora,
        producto,
        litros: interpretarNumero(valor(fila, 'cantidad')),
        importe,
        forma_pago: formaPago,
        tipo_pago: tipo,
        datos_pago: datos,
        cliente_nombre: String(valor(fila, 'cliente') ?? '').trim() || null,
        cliente_codigo: String(valor(fila, 'codigo') ?? '').trim() || null,
        nota: String(valor(fila, 'nota') ?? '').trim() || null,
        participante,
      });
    }
    return { ventas, errores, omitidas, noParticipantes };
  }
}

module.exports = { FuenteControlGAS };
