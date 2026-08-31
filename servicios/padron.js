// Padrón público de boletos (SPEC sección 9-bis — ORDEN 2).
//
// Todo lo que sale de este módulo es SEGURO PARA PUBLICAR: el titular va
// enmascarado (primer nombre + inicial del apellido) y el teléfono jamás se
// incluye, ni parcial. El motivo real de una anulación queda solo en /admin:
// al público siempre se muestra el motivo genérico.

const { consultar } = require('../lib/db');
const { normalizarTelefono } = require('../lib/telefono');

const MOTIVO_PUBLICO_ANULADO = 'Anulado conforme a las bases';
const TAMANO_PAGINA = 50;

// "Eduardo Loewen García" → "Eduardo L."
function enmascararNombre(nombre) {
  const partes = String(nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return 'Participante';
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[1][0].toUpperCase()}.`;
}

// Interpreta lo que el visitante escribió en el buscador.
//   - Número de boleto: SF27-000123, sf27000123, 000123 o 123 (≤ 6 dígitos)
//   - Teléfono completo a 10 dígitos (se aceptan +52/52 por delante)
//   - Cualquier otra cosa (teléfonos parciales incluidos) es inválida.
function interpretarBusqueda(texto) {
  const limpio = String(texto ?? '').trim();
  if (!limpio) return { tipo: 'vacia' };

  const boleto = limpio.match(/^([A-Za-z]{2}\d{2})-?(\d{1,10})$/);
  if (boleto) return { tipo: 'boleto', prefijo: boleto[1].toUpperCase(), numero: Number(boleto[2]) };

  const soloDigitos = limpio.replace(/[\s\-().]/g, '');
  if (/^\+?\d+$/.test(soloDigitos)) {
    const telefono = normalizarTelefono(limpio);
    if (telefono) return { tipo: 'telefono', telefono };
    const digitos = soloDigitos.replace(/^\+/, '');
    if (digitos.length <= 6) return { tipo: 'boleto', prefijo: null, numero: Number(digitos) };
    return { tipo: 'invalida' }; // teléfono parcial u otro número irreconocible
  }
  return { tipo: 'invalida' };
}

// Da forma pública a una fila de boleto. Nunca incluye teléfono ni
// apellido completo; el motivo de anulación siempre es el genérico.
function haciaPublico(fila, conTitular = false) {
  const publico = {
    boleto: fila.folio_boleto,
    numero: Number(fila.numero),
    fecha_emision: fila.fecha_emision,
    estacion: fila.origen === 'compra' ? 'Oficina' : (fila.estacion ?? '—'),
    origen: fila.origen === 'compra' ? 'Oficina' : 'Carga',
    estado: fila.estado === 'anulado' ? MOTIVO_PUBLICO_ANULADO : 'Vigente',
  };
  if (conTitular) publico.titular = enmascararNombre(fila.cliente);
  return publico;
}

const CAMPOS = `b.folio_boleto, b.numero, b.fecha_emision, b.estado, b.origen,
                e.nombre AS estacion, c.nombre AS cliente`;
const DESDE = `FROM boletos b
               JOIN clientes c ON c.id = b.cliente_id
               LEFT JOIN estaciones e ON e.id = b.estacion_id`;

async function buscarPorBoleto(numero) {
  const filas = await consultar(`SELECT ${CAMPOS} ${DESDE} WHERE b.numero = ?`, [numero]);
  return filas.map((f) => haciaPublico(f, true));
}

async function buscarPorTelefono(telefono) {
  const filas = await consultar(
    `SELECT ${CAMPOS} ${DESDE} WHERE c.telefono = ? ORDER BY b.numero`, [telefono]);
  return filas.map((f) => haciaPublico(f, true));
}

// Lista pública completa, paginada y ordenada por número. Sin titular:
// solo número, fecha, estación, origen y estado (base del sellado).
async function listarPadron(pagina = 1) {
  const [{ total }] = await consultar('SELECT COUNT(*) AS total FROM boletos');
  const totalPaginas = Math.max(1, Math.ceil(Number(total) / TAMANO_PAGINA));
  const paginaActual = Math.min(Math.max(1, Math.floor(pagina) || 1), totalPaginas);
  const desplazamiento = (paginaActual - 1) * TAMANO_PAGINA;
  const filas = await consultar(
    `SELECT ${CAMPOS} ${DESDE} ORDER BY b.numero LIMIT ${TAMANO_PAGINA} OFFSET ${desplazamiento}`);
  return {
    total: Number(total),
    pagina: paginaActual,
    totalPaginas,
    boletos: filas.map((f) => haciaPublico(f, false)),
  };
}

// Contador de boletos vigentes con cache de 60 segundos.
let cacheContador = { valor: null, expira: 0 };

async function contadorVigentes(ttlMs = 60000, ahora = Date.now()) {
  if (cacheContador.valor !== null && ahora < cacheContador.expira) return cacheContador.valor;
  const [{ vigentes }] = await consultar("SELECT COUNT(*) AS vigentes FROM boletos WHERE estado = 'vigente'");
  cacheContador = { valor: Number(vigentes), expira: ahora + ttlMs };
  return cacheContador.valor;
}

function reiniciarCacheContador() {
  cacheContador = { valor: null, expira: 0 };
}

module.exports = {
  MOTIVO_PUBLICO_ANULADO,
  TAMANO_PAGINA,
  enmascararNombre,
  interpretarBusqueda,
  haciaPublico,
  buscarPorBoleto,
  buscarPorTelefono,
  listarPadron,
  contadorVigentes,
  reiniciarCacheContador,
};
