// Reglas puras del motor de boletos (SPEC v0.2, sección 14).
// Sin acceso a base de datos: todo recibe sus datos por parámetro,
// para poder probarse de forma unitaria.

function normalizarTexto(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Boletos que genera una venta según su importe.
// acumulaMultiplos: piso(importe / monto); $1,400 con monto 700 = 2 boletos.
// Nunca se suman importes de ventas distintas: cada venta se evalúa sola.
function calcularCantidadBoletos({ importe, montoPorBoleto, acumulaMultiplos }) {
  if (!Number.isFinite(importe) || importe <= 0 || !Number.isFinite(montoPorBoleto) || montoPorBoleto <= 0) return 0;
  if (acumulaMultiplos) return Math.floor(importe / montoPorBoleto);
  return importe >= montoPorBoleto ? 1 : 0;
}

// Fecha y hora "ahora" en la zona horaria dada, como 'AAAA-MM-DD HH:MM'.
function ahoraLocal(zonaHoraria, ahora = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: zonaHoraria,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(ahora).replace('T', ' ').slice(0, 16);
}

// El padrón está cerrado cuando la hora local alcanza cierre_padron.
function padronCerrado({ cierrePadron, zonaHoraria }, ahora = new Date()) {
  return ahoraLocal(zonaHoraria, ahora) >= cierrePadron;
}

// Plazo de reclamo en días naturales: la venta del día D se puede reclamar
// hasta el final del día D + dias (fechas comparadas en la zona local; las
// ventas se registran en hora local de la estación).
function diasTranscurridos(fechaVenta, zonaHoraria, ahora = new Date()) {
  const fecha = fechaVenta instanceof Date ? fechaVenta : new Date(String(fechaVenta).replace(' ', 'T'));
  const diaVenta = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  const diaHoy = ahoraLocal(zonaHoraria, ahora).slice(0, 10);
  return Math.round((Date.parse(diaHoy + 'T00:00:00Z') - Date.parse(diaVenta + 'T00:00:00Z')) / 86400000);
}

function fueraDePlazo(fechaVenta, { diasParaReclamar, zonaHoraria }, ahora = new Date()) {
  return diasTranscurridos(fechaVenta, zonaHoraria, ahora) > diasParaReclamar;
}

function formaPagoExcluida(formaPago, formasExcluidas) {
  if (!formaPago) return false; // sin forma de pago registrada: participa
  const forma = normalizarTexto(formaPago);
  return formasExcluidas.map(normalizarTexto).includes(forma);
}

// Sin producto registrado se considera combustible: las importaciones de
// ventas son cargas. Con producto, debe estar en la lista de participantes.
function productoParticipante(producto, productosParticipantes) {
  if (!producto) return true;
  const normalizado = normalizarTexto(producto);
  return productosParticipantes.map(normalizarTexto).includes(normalizado);
}

// 'SF27-######' + 12 → 'SF27-000012'. Los # marcan los dígitos del consecutivo.
function formatearFolioBoleto(formato, numero) {
  const coincidencia = formato.match(/#+/);
  if (!coincidencia) return formato + String(numero);
  return formato.replace(/#+/, String(numero).padStart(coincidencia[0].length, '0'));
}

module.exports = {
  normalizarTexto,
  calcularCantidadBoletos,
  ahoraLocal,
  padronCerrado,
  diasTranscurridos,
  fueraDePlazo,
  formaPagoExcluida,
  productoParticipante,
  formatearFolioBoleto,
};
