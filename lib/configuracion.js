// Lectura y validación tipada de la tabla `configuracion`.
// Las claves del sorteo están definidas aquí; /admin solo permite editar
// claves conocidas y valida el tipo antes de guardar.

const { consultar } = require('./db');

const DEFINICIONES = {
  monto_por_boleto: { tipo: 'numero' },
  acumula_multiplos: { tipo: 'booleano' },
  productos_participantes: { tipo: 'lista' },
  formas_pago_excluidas: { tipo: 'lista' },
  asignacion: { tipo: 'texto' },
  dias_para_reclamar: { tipo: 'numero' },
  precio_boleto_oficina: { tipo: 'numero' },
  tope_por_persona: { tipo: 'numero' },
  formato_boleto: { tipo: 'formato_boleto' },
  cierre_padron: { tipo: 'fecha_hora' },
  zona_horaria: { tipo: 'zona_horaria' },
};

function validarValor(clave, valorCrudo) {
  const definicion = DEFINICIONES[clave];
  if (!definicion) return { ok: false, error: 'Clave no reconocida.' };
  const valor = String(valorCrudo ?? '').trim();
  if (!valor) return { ok: false, error: 'El valor no puede quedar vacío.' };

  switch (definicion.tipo) {
    case 'numero':
      if (!/^\d+(\.\d+)?$/.test(valor)) return { ok: false, error: 'Debe ser un número (sin signo).' };
      return { ok: true, valor };
    case 'booleano':
      if (valor !== 'true' && valor !== 'false') return { ok: false, error: 'Debe ser "true" o "false".' };
      return { ok: true, valor };
    case 'lista':
      return { ok: true, valor: valor.split(',').map((v) => v.trim()).filter(Boolean).join(',') };
    case 'fecha_hora':
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(valor) || Number.isNaN(Date.parse(valor.replace(' ', 'T')))) {
        return { ok: false, error: 'Formato esperado: AAAA-MM-DD HH:MM.' };
      }
      return { ok: true, valor };
    case 'formato_boleto':
      if (!valor.includes('#')) return { ok: false, error: 'Debe incluir # para los dígitos del consecutivo (ej. SF27-######).' };
      return { ok: true, valor };
    case 'zona_horaria':
      try {
        new Intl.DateTimeFormat('es-MX', { timeZone: valor });
        return { ok: true, valor };
      } catch {
        return { ok: false, error: 'Zona horaria IANA no válida (ej. America/Chihuahua).' };
      }
    default:
      return { ok: true, valor };
  }
}

function interpretar(clave, valor) {
  const definicion = DEFINICIONES[clave];
  if (!definicion) return valor;
  switch (definicion.tipo) {
    case 'numero': return Number(valor);
    case 'booleano': return valor === 'true';
    case 'lista': return valor.split(',').map((v) => v.trim()).filter(Boolean);
    default: return valor;
  }
}

async function leerConfiguracion() {
  const filas = await consultar('SELECT clave, valor, descripcion FROM configuracion');
  const config = {};
  for (const fila of filas) config[fila.clave] = interpretar(fila.clave, fila.valor);
  return config;
}

async function leerConfiguracionCruda() {
  return consultar('SELECT clave, valor, descripcion FROM configuracion ORDER BY clave');
}

async function guardarValor(clave, valor) {
  await consultar('UPDATE configuracion SET valor = ? WHERE clave = ?', [valor, clave]);
}

module.exports = { DEFINICIONES, validarValor, interpretar, leerConfiguracion, leerConfiguracionCruda, guardarValor };
