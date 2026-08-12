// FuenteManual: ventas cargadas por archivo CSV desde el panel (SPEC sección 6.1).
//
// Formato esperado del CSV (encabezados flexibles, sin distinguir mayúsculas):
//   folio, fecha_hora (o fecha), producto, litros, importe (o monto/total)
// Separador: coma o punto y coma. Fechas aceptadas:
//   AAAA-MM-DD [HH:MM[:SS]]  o  DD/MM/AAAA [HH:MM[:SS]]

const { parse } = require('csv-parse/sync');
const { FuenteDeVentas } = require('./fuente-de-ventas');

const ALIAS_COLUMNAS = {
  folio: ['folio', 'ticket', 'no_ticket', 'numero'],
  fecha_hora: ['fecha_hora', 'fecha', 'fechahora', 'fecha y hora'],
  producto: ['producto', 'combustible', 'articulo'],
  litros: ['litros', 'volumen', 'cantidad'],
  importe: ['importe', 'monto', 'total'],
};

function normalizarEncabezado(texto) {
  return String(texto).replace(/^﻿/, '').trim().toLowerCase();
}

function mapearColumnas(encabezados) {
  const mapa = {};
  for (const [campo, alias] of Object.entries(ALIAS_COLUMNAS)) {
    const indice = encabezados.findIndex((e) => alias.includes(normalizarEncabezado(e)));
    if (indice >= 0) mapa[campo] = indice;
  }
  return mapa;
}

function interpretarFecha(texto) {
  const limpio = String(texto).trim();
  let m = limpio.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return construirFecha(m[1], m[2], m[3], m[4], m[5], m[6]);
  }
  m = limpio.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return construirFecha(m[3], m[2], m[1], m[4], m[5], m[6]);
  }
  return null;
}

function construirFecha(anio, mes, dia, hora, minuto, segundo) {
  const fecha = new Date(
    Number(anio), Number(mes) - 1, Number(dia),
    Number(hora || 0), Number(minuto || 0), Number(segundo || 0)
  );
  if (fecha.getFullYear() !== Number(anio) || fecha.getMonth() !== Number(mes) - 1 || fecha.getDate() !== Number(dia)) {
    return null; // fecha inválida, ej. 31/02
  }
  return fecha;
}

function interpretarNumero(texto) {
  if (texto === undefined || texto === null || String(texto).trim() === '') return null;
  const limpio = String(texto).replace(/[$\s,]/g, '');
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : null;
}

class FuenteManual extends FuenteDeVentas {
  constructor(contenidoCSV) {
    super();
    this.contenido = contenidoCSV;
  }

  async obtenerVentas() {
    const texto = Buffer.isBuffer(this.contenido)
      ? this.contenido.toString('utf8')
      : String(this.contenido);

    const separador = texto.split('\n')[0].includes(';') ? ';' : ',';
    let filas;
    try {
      filas = parse(texto, {
        delimiter: separador,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
      });
    } catch (err) {
      return { ventas: [], errores: [`El archivo no se pudo leer como CSV: ${err.message}`] };
    }

    if (!filas.length) return { ventas: [], errores: ['El archivo está vacío.'] };

    const mapa = mapearColumnas(filas[0]);
    if (mapa.folio === undefined || mapa.fecha_hora === undefined) {
      return {
        ventas: [],
        errores: ['El CSV debe incluir al menos las columnas "folio" y "fecha_hora" (o "fecha").'],
      };
    }

    const ventas = [];
    const errores = [];
    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const numeroFila = i + 1;
      const folio = String(fila[mapa.folio] ?? '').trim();
      if (!folio) {
        errores.push(`Fila ${numeroFila}: folio vacío.`);
        continue;
      }
      const fecha = interpretarFecha(fila[mapa.fecha_hora]);
      if (!fecha) {
        errores.push(`Fila ${numeroFila}: fecha no reconocida ("${fila[mapa.fecha_hora]}").`);
        continue;
      }
      ventas.push({
        folio,
        fecha_hora: fecha,
        producto: mapa.producto !== undefined ? String(fila[mapa.producto] ?? '').trim() || null : null,
        litros: mapa.litros !== undefined ? interpretarNumero(fila[mapa.litros]) : null,
        importe: mapa.importe !== undefined ? interpretarNumero(fila[mapa.importe]) : null,
      });
    }
    return { ventas, errores };
  }
}

module.exports = { FuenteManual };
