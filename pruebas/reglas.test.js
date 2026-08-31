// Pruebas unitarias de las reglas puras del motor (sin base de datos).
process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const reglas = require('../servicios/reglas-boletos');

test('múltiplos: $1,400 con monto 700 = 2 boletos', () => {
  assert.equal(reglas.calcularCantidadBoletos({ importe: 1400, montoPorBoleto: 700, acumulaMultiplos: true }), 2);
  assert.equal(reglas.calcularCantidadBoletos({ importe: 700, montoPorBoleto: 700, acumulaMultiplos: true }), 1);
  assert.equal(reglas.calcularCantidadBoletos({ importe: 2099.99, montoPorBoleto: 700, acumulaMultiplos: true }), 2);
});

test('importe insuficiente no genera boletos', () => {
  assert.equal(reglas.calcularCantidadBoletos({ importe: 699.99, montoPorBoleto: 700, acumulaMultiplos: true }), 0);
  assert.equal(reglas.calcularCantidadBoletos({ importe: 0, montoPorBoleto: 700, acumulaMultiplos: true }), 0);
  assert.equal(reglas.calcularCantidadBoletos({ importe: -100, montoPorBoleto: 700, acumulaMultiplos: true }), 0);
});

test('sin acumular múltiplos: máximo un boleto por venta', () => {
  assert.equal(reglas.calcularCantidadBoletos({ importe: 2100, montoPorBoleto: 700, acumulaMultiplos: false }), 1);
  assert.equal(reglas.calcularCantidadBoletos({ importe: 500, montoPorBoleto: 700, acumulaMultiplos: false }), 0);
});

test('vales quedan excluidos; contado y crédito participan; sin dato participa', () => {
  const excluidas = ['vales'];
  assert.equal(reglas.formaPagoExcluida('Vales', excluidas), true);
  assert.equal(reglas.formaPagoExcluida('VALES ', excluidas), true);
  assert.equal(reglas.formaPagoExcluida('contado', excluidas), false);
  assert.equal(reglas.formaPagoExcluida('crédito', excluidas), false);
  assert.equal(reglas.formaPagoExcluida(null, excluidas), false);
});

test('solo combustibles participan; sin producto se considera carga', () => {
  const lista = ['magna', 'premium', 'diesel'];
  assert.equal(reglas.productoParticipante('Magna', lista), true);
  assert.equal(reglas.productoParticipante('Diésel', lista), true);
  assert.equal(reglas.productoParticipante('DIESEL', lista), true);
  assert.equal(reglas.productoParticipante('Aceite 20W-50', lista), false);
  assert.equal(reglas.productoParticipante(null, lista), true);
});

test('plazo de 7 días naturales desde la fecha de la venta', () => {
  const config = { diasParaReclamar: 7, zonaHoraria: 'UTC' };
  const venta = '2027-01-01 10:30';
  assert.equal(reglas.fueraDePlazo(venta, config, new Date('2027-01-01T11:00:00Z')), false);
  assert.equal(reglas.fueraDePlazo(venta, config, new Date('2027-01-08T23:59:00Z')), false); // día 7: aún válido
  assert.equal(reglas.fueraDePlazo(venta, config, new Date('2027-01-09T00:01:00Z')), true);  // día 8: fuera
});

test('cierre del padrón: nada se emite desde la hora de cierre', () => {
  const config = { cierrePadron: '2027-12-16 12:00', zonaHoraria: 'UTC' };
  assert.equal(reglas.padronCerrado(config, new Date('2027-12-16T11:59:00Z')), false);
  assert.equal(reglas.padronCerrado(config, new Date('2027-12-16T12:00:00Z')), true);
  assert.equal(reglas.padronCerrado(config, new Date('2028-01-01T00:00:00Z')), true);
});

test('formato de boleto: SF27- + consecutivo de 6 dígitos', () => {
  assert.equal(reglas.formatearFolioBoleto('SF27-######', 1), 'SF27-000001');
  assert.equal(reglas.formatearFolioBoleto('SF27-######', 456), 'SF27-000456');
  assert.equal(reglas.formatearFolioBoleto('SF27-######', 1234567), 'SF27-1234567'); // crece si se desborda
  assert.equal(reglas.formatearFolioBoleto('BOL', 9), 'BOL9'); // sin #: se anexa
});

test('normalización de texto ignora mayúsculas y acentos', () => {
  assert.equal(reglas.normalizarTexto('  Diésel '), 'diesel');
  assert.equal(reglas.normalizarTexto('CRÉDITO'), 'credito');
});
