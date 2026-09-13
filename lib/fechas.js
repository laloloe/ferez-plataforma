// Utilería central de fechas (ORDEN 11).
//
// REGLA ÚNICA: la base de datos guarda UTC; TODO lo que se presenta al
// humano y TODA regla de negocio con fechas usa la clave zona_horaria de
// configuracion (America/Chihuahua), sin depender de la zona del servidor.
//
// La zona se lee de la BD con un cache de 60 s y arranca en el default de
// producción, así el formateo es síncrono (apto para plantillas) y sigue
// funcionando aunque la BD esté caída.

const { configurada, consultar } = require('./db');

const ZONA_DEFAULT = 'America/Chihuahua';
let zonaCache = ZONA_DEFAULT;
let zonaExpira = 0;
let zonaFijada = null; // solo pruebas

function zonaHoraria() {
  if (zonaFijada) return zonaFijada;
  if (configurada() && Date.now() >= zonaExpira) {
    zonaExpira = Date.now() + 60000;
    consultar("SELECT valor FROM configuracion WHERE clave = 'zona_horaria'")
      .then(([fila]) => { if (fila && fila.valor) zonaCache = fila.valor; })
      .catch(() => { /* con la BD caída se queda el default */ });
  }
  return zonaCache;
}

// Un valor de BD (Date de mysql2 o texto 'AAAA-MM-DD HH:MM[:SS]') → instante.
// Los textos sin zona se interpretan como UTC: así se guardan en la BD.
function interpretar(valor) {
  if (valor instanceof Date) return valor;
  const texto = String(valor).trim().replace(' ', 'T');
  return new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(texto) ? texto : `${texto}Z`);
}

// 'AAAA-MM-DD HH:MM:SS' del instante dado, en la zona configurada.
function marcaLocal(valor, zona = zonaHoraria()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: zona,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(interpretar(valor)).replace('T', ' ');
}

// Presentación humana: 'DD/MM/AAAA HH:MM' en la zona configurada.
function formatearFecha(valor) {
  if (!valor) return '—';
  const [fecha, hora] = marcaLocal(valor).split(' ');
  const [anio, mes, dia] = fecha.split('-');
  return `${dia}/${mes}/${anio} ${hora.slice(0, 5)}`;
}

// 'AAAA-MM-DD' local del instante (default: ahora), con desplazamiento en días.
function fechaLocalISO(valor = new Date(), { dias = 0, zona = zonaHoraria() } = {}) {
  const base = new Date(interpretar(valor).getTime() + dias * 86400000);
  return marcaLocal(base, zona).slice(0, 10);
}

// Instante UTC de una hora de pared local 'AAAA-MM-DD HH:MM[:SS]'.
// Iterativo para no depender del desplazamiento fijo de la zona.
function utcDesdeLocal(textoLocal, zona = zonaHoraria()) {
  const texto = textoLocal.length === 16 ? `${textoLocal}:00` : textoLocal;
  const buscado = Date.parse(`${texto.replace(' ', 'T')}Z`);
  let instante = new Date(buscado);
  for (let i = 0; i < 3; i++) {
    const visto = Date.parse(`${marcaLocal(instante, zona).replace(' ', 'T')}Z`);
    if (visto === buscado) break;
    instante = new Date(instante.getTime() + (buscado - visto));
  }
  return instante;
}

// Instante → texto UTC 'AAAA-MM-DD HH:MM:SS' para parámetros SQL.
function utcSQL(instante) {
  return interpretar(instante).toISOString().slice(0, 19).replace('T', ' ');
}

// Solo pruebas: fija la zona sin tocar la BD (null la libera).
function _fijarZona(zona) {
  zonaFijada = zona;
}

module.exports = {
  ZONA_DEFAULT,
  zonaHoraria,
  marcaLocal,
  formatearFecha,
  fechaLocalISO,
  utcDesdeLocal,
  utcSQL,
  _fijarZona,
};
