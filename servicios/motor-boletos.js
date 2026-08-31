// Motor de boletos (SPEC v0.2, sección 14 — paso 5).
//
// Servicio único de emisión con dos entradas: reclamo de folio y boleto de
// oficina. Hoy lo dispara /admin; mañana lo usará el bot de WhatsApp sin
// cambios. Garantías:
//   - Una venta genera boletos UNA sola vez: emisiones.venta_id es único en BD.
//   - Numeración consecutiva sin huecos ni duplicados bajo concurrencia:
//     contador con SELECT ... FOR UPDATE dentro de la transacción de emisión.
//   - El boleto anulado no se borra ni libera su número.
//   - Todo reclamo, compra, rechazo y anulación queda en bitacora_boletos.

const { obtenerPool, consultar } = require('../lib/db');
const { leerConfiguracion } = require('../lib/configuracion');
const { normalizarTelefono } = require('../lib/telefono');
const reglas = require('./reglas-boletos');

// Códigos de rechazo estables: el bot los usará tal cual.
const RECHAZOS = {
  PADRON_CERRADO: 'El padrón del sorteo ya cerró. Ya no se emiten boletos.',
  CLIENTE_NO_REGISTRADO: 'Regístrate primero en ferez.mx/registro para participar.',
  ESTACION_NO_PARTICIPANTE: 'Esa estación no participa en el sorteo.',
  FOLIO_INEXISTENTE: 'No encontramos ese folio. Verifica el número impreso en tu ticket.',
  FOLIO_YA_RECLAMADO: 'Ese folio ya generó boleto.',
  VENTA_CANCELADA: 'Esa venta está cancelada o devuelta y no genera boletos.',
  FUERA_DE_PLAZO: 'Ese folio ya no se puede reclamar: pasaron más de los días permitidos desde la carga.',
  FORMA_PAGO_EXCLUIDA: 'Las compras con esa forma de pago no participan en el sorteo.',
  PRODUCTO_NO_PARTICIPANTE: 'Ese concepto no participa en el sorteo; solo las cargas de combustible.',
  IMPORTE_INSUFICIENTE: 'El importe de esa carga no alcanza para un boleto.',
  TOPE_ALCANZADO: 'Ya alcanzaste el máximo de boletos permitidos por persona.',
  TELEFONO_INVALIDO: 'El teléfono no tiene un formato válido.',
  RECIBO_DUPLICADO: 'Ese número de recibo ya tiene un boleto emitido.',
  DATOS_INCOMPLETOS: 'Faltan datos para emitir el boleto.',
};

function parametrosDelMotor(config) {
  return {
    montoPorBoleto: config.monto_por_boleto,
    acumulaMultiplos: config.acumula_multiplos,
    productosParticipantes: config.productos_participantes || [],
    formasExcluidas: config.formas_pago_excluidas || [],
    diasParaReclamar: config.dias_para_reclamar,
    topePorPersona: config.tope_por_persona,
    formatoBoleto: config.formato_boleto,
    cierrePadron: config.cierre_padron,
    zonaHoraria: config.zona_horaria || 'America/Chihuahua',
  };
}

async function registrarBitacora({ actor, tipo, telefono, folioVenta, estacionId, resultado, detalle, boletosGenerados }) {
  try {
    await consultar(
      `INSERT INTO bitacora_boletos (actor, tipo, telefono, folio_venta, estacion_id, resultado, detalle, boletos_generados)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [actor, tipo, telefono ?? null, folioVenta ?? null, estacionId ?? null, resultado, detalle ?? null, boletosGenerados ?? 0]
    );
  } catch (err) {
    console.error('No se pudo registrar en bitácora:', err.message);
  }
}

function rechazo(codigo, extras = {}) {
  return { ok: false, codigo, mensaje: RECHAZOS[codigo] || codigo, ...extras };
}

// Toma `cantidad` números consecutivos del contador y crea los boletos,
// todo dentro de la transacción de `conexion`. Devuelve los folios creados.
async function emitirEnTransaccion(conexion, { emisionId, cantidad, clienteId, ventaId, estacionId, origen, formatoBoleto }) {
  const [[contador]] = await conexion.query('SELECT siguiente FROM contador_boletos WHERE id = 1 FOR UPDATE');
  const primero = Number(contador.siguiente);
  await conexion.query('UPDATE contador_boletos SET siguiente = ? WHERE id = 1', [primero + cantidad]);

  const folios = [];
  for (let i = 0; i < cantidad; i++) {
    const numero = primero + i;
    const folioBoleto = reglas.formatearFolioBoleto(formatoBoleto, numero);
    await conexion.query(
      `INSERT INTO boletos (folio_boleto, numero, emision_id, cliente_id, venta_id, estacion_id, origen, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'vigente')`,
      [folioBoleto, numero, emisionId, clienteId, ventaId, estacionId, origen]
    );
    folios.push(folioBoleto);
  }
  return folios;
}

// Entrada (a): cliente registrado + folio + estación.
async function reclamarFolio({ telefono, folio, estacionId, actor }) {
  const config = await leerConfiguracion();
  const p = parametrosDelMotor(config);
  const folioLimpio = String(folio ?? '').trim();
  const estacion = Number(estacionId);

  const terminar = async (resultado, boletosGenerados = 0, detalle = null) => {
    await registrarBitacora({
      actor, tipo: 'reclamo', telefono: resultado.telefono ?? telefono, folioVenta: folioLimpio,
      estacionId: estacion || null, resultado: resultado.ok ? 'OK' : resultado.codigo,
      detalle: detalle ?? (resultado.ok ? `Boletos: ${resultado.boletos.join(', ')}` : resultado.mensaje),
      boletosGenerados,
    });
    return resultado;
  };

  if (!folioLimpio || !estacion) return terminar(rechazo('DATOS_INCOMPLETOS'));

  if (reglas.padronCerrado(p)) return terminar(rechazo('PADRON_CERRADO'));

  const telefonoNormalizado = normalizarTelefono(String(telefono ?? ''));
  if (!telefonoNormalizado) return terminar(rechazo('TELEFONO_INVALIDO'));

  const [cliente] = await consultar(
    'SELECT id, nombre FROM clientes WHERE telefono = ? AND activo = 1', [telefonoNormalizado]);
  if (!cliente) return terminar({ ...rechazo('CLIENTE_NO_REGISTRADO'), telefono: telefonoNormalizado });

  const [filaEstacion] = await consultar(
    'SELECT id, nombre FROM estaciones WHERE id = ? AND activa = 1 AND participa_sorteo = 1', [estacion]);
  if (!filaEstacion) return terminar(rechazo('ESTACION_NO_PARTICIPANTE'));

  const [venta] = await consultar(
    'SELECT id, folio, fecha_hora, producto, litros, importe, forma_pago, estado FROM ventas WHERE estacion_id = ? AND folio = ?',
    [estacion, folioLimpio]);
  if (!venta) return terminar(rechazo('FOLIO_INEXISTENTE'));
  if (venta.estado !== 'normal') return terminar(rechazo('VENTA_CANCELADA'));
  if (reglas.fueraDePlazo(venta.fecha_hora, p)) return terminar(rechazo('FUERA_DE_PLAZO'));
  if (reglas.formaPagoExcluida(venta.forma_pago, p.formasExcluidas)) return terminar(rechazo('FORMA_PAGO_EXCLUIDA'));
  if (!reglas.productoParticipante(venta.producto, p.productosParticipantes)) return terminar(rechazo('PRODUCTO_NO_PARTICIPANTE'));

  const cantidad = reglas.calcularCantidadBoletos({
    importe: Number(venta.importe), montoPorBoleto: p.montoPorBoleto, acumulaMultiplos: p.acumulaMultiplos,
  });
  if (cantidad < 1) return terminar(rechazo('IMPORTE_INSUFICIENTE'));

  if (p.topePorPersona > 0) {
    const [{ vigentes }] = await consultar(
      "SELECT COUNT(*) AS vigentes FROM boletos WHERE cliente_id = ? AND estado = 'vigente'", [cliente.id]);
    if (Number(vigentes) + cantidad > p.topePorPersona) return terminar(rechazo('TOPE_ALCANZADO'));
  }

  const conexion = await obtenerPool().getConnection();
  try {
    await conexion.beginTransaction();
    let emisionId;
    try {
      const [resultado] = await conexion.query(
        `INSERT INTO emisiones (tipo, venta_id, cliente_id, estacion_id, cantidad, actor)
         VALUES ('reclamo', ?, ?, ?, ?, ?)`,
        [venta.id, cliente.id, estacion, cantidad, actor]);
      emisionId = resultado.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        await conexion.rollback();
        const [previa] = await consultar(
          'SELECT fecha FROM emisiones WHERE venta_id = ?', [venta.id]);
        const cuando = previa ? ` el ${new Date(previa.fecha).toISOString().slice(0, 10)}` : '';
        return terminar({ ...rechazo('FOLIO_YA_RECLAMADO'), mensaje: `Ese folio ya generó boleto${cuando}.` });
      }
      throw err;
    }

    const folios = await emitirEnTransaccion(conexion, {
      emisionId, cantidad, clienteId: cliente.id, ventaId: venta.id,
      estacionId: estacion, origen: 'reclamo', formatoBoleto: p.formatoBoleto,
    });
    await conexion.commit();
    return terminar({ ok: true, boletos: folios, cantidad, cliente: cliente.nombre, telefono: telefonoNormalizado }, cantidad);
  } catch (err) {
    try { await conexion.rollback(); } catch { /* la conexión pudo cerrarse */ }
    throw err;
  } finally {
    conexion.release();
  }
}

// Entrada (b): boleto de oficina ($70) — nombre, teléfono y número de recibo.
// SUPUESTO: si el teléfono no está registrado, se da de alta al cliente en el
// momento (la compra presencial incluye la aceptación del aviso en papel).
async function emitirBoletoOficina({ nombre, telefono, recibo, actor }) {
  const config = await leerConfiguracion();
  const p = parametrosDelMotor(config);
  const nombreLimpio = String(nombre ?? '').trim();
  const reciboLimpio = String(recibo ?? '').trim();

  const terminar = async (resultado, boletosGenerados = 0) => {
    await registrarBitacora({
      actor, tipo: 'compra', telefono: resultado.telefono ?? telefono, folioVenta: reciboLimpio || null,
      estacionId: null, resultado: resultado.ok ? 'OK' : resultado.codigo,
      detalle: resultado.ok ? `Recibo ${reciboLimpio}. Boletos: ${resultado.boletos.join(', ')}` : resultado.mensaje,
      boletosGenerados,
    });
    return resultado;
  };

  if (!nombreLimpio || !reciboLimpio) return terminar(rechazo('DATOS_INCOMPLETOS'));
  if (reglas.padronCerrado(p)) return terminar(rechazo('PADRON_CERRADO'));

  const telefonoNormalizado = normalizarTelefono(String(telefono ?? ''));
  if (!telefonoNormalizado) return terminar(rechazo('TELEFONO_INVALIDO'));

  let [cliente] = await consultar('SELECT id FROM clientes WHERE telefono = ?', [telefonoNormalizado]);
  if (!cliente) {
    try {
      await consultar(
        `INSERT INTO clientes (telefono, nombre, acepto_aviso_privacidad, fecha_aceptacion_aviso)
         VALUES (?, ?, 1, NOW())`, [telefonoNormalizado, nombreLimpio]);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err; // alguien lo registró al mismo tiempo
    }
    [cliente] = await consultar('SELECT id FROM clientes WHERE telefono = ?', [telefonoNormalizado]);
  }

  const conexion = await obtenerPool().getConnection();
  try {
    await conexion.beginTransaction();
    let emisionId;
    try {
      const [resultado] = await conexion.query(
        `INSERT INTO emisiones (tipo, venta_id, cliente_id, estacion_id, recibo, cantidad, actor)
         VALUES ('compra', NULL, ?, NULL, ?, 1, ?)`,
        [cliente.id, reciboLimpio, actor]);
      emisionId = resultado.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        await conexion.rollback();
        return terminar(rechazo('RECIBO_DUPLICADO'));
      }
      throw err;
    }

    const folios = await emitirEnTransaccion(conexion, {
      emisionId, cantidad: 1, clienteId: cliente.id, ventaId: null,
      estacionId: null, origen: 'compra', formatoBoleto: p.formatoBoleto,
    });
    await conexion.commit();
    return terminar({ ok: true, boletos: folios, cantidad: 1, telefono: telefonoNormalizado }, 1);
  } catch (err) {
    try { await conexion.rollback(); } catch { /* la conexión pudo cerrarse */ }
    throw err;
  } finally {
    conexion.release();
  }
}

// Marca una venta como cancelada o devuelta y anula sus boletos.
// El boleto anulado NO se borra ni libera su número.
async function marcarVenta({ ventaId, estado, actor }) {
  if (estado !== 'cancelada' && estado !== 'devuelta') {
    return { ok: false, mensaje: 'Estado no válido: usa "cancelada" o "devuelta".' };
  }
  const [venta] = await consultar('SELECT id, folio, estacion_id FROM ventas WHERE id = ?', [ventaId]);
  if (!venta) return { ok: false, mensaje: 'Venta no encontrada.' };

  await consultar('UPDATE ventas SET estado = ? WHERE id = ?', [estado, ventaId]);
  const resultado = await consultar(
    `UPDATE boletos SET estado = 'anulado', motivo_anulacion = ?, fecha_anulacion = NOW()
     WHERE venta_id = ? AND estado = 'vigente'`,
    [`Venta ${estado}`, ventaId]);

  await registrarBitacora({
    actor, tipo: 'anulacion', folioVenta: venta.folio, estacionId: venta.estacion_id,
    resultado: 'OK', detalle: `Venta marcada ${estado}; ${resultado.affectedRows} boleto(s) anulado(s).`,
  });
  return { ok: true, anulados: resultado.affectedRows };
}

// Anula un boleto individual con motivo (SPEC sección 8).
async function anularBoleto({ folioBoleto, motivo, actor }) {
  const motivoLimpio = String(motivo ?? '').trim();
  if (!motivoLimpio) return { ok: false, mensaje: 'Indica el motivo de la anulación.' };
  const resultado = await consultar(
    `UPDATE boletos SET estado = 'anulado', motivo_anulacion = ?, fecha_anulacion = NOW()
     WHERE folio_boleto = ? AND estado = 'vigente'`,
    [motivoLimpio, folioBoleto]);
  if (!resultado.affectedRows) return { ok: false, mensaje: 'El boleto no existe o ya estaba anulado.' };
  await registrarBitacora({
    actor, tipo: 'anulacion', resultado: 'OK', detalle: `Boleto ${folioBoleto} anulado: ${motivoLimpio}`,
  });
  return { ok: true };
}

module.exports = { RECHAZOS, reclamarFolio, emitirBoletoOficina, marcarVenta, anularBoleto };
