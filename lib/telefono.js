// Normalización de teléfonos mexicanos a E.164 (+52 y 10 dígitos).
// Devuelve null si el número no es reconocible.

function normalizarTelefono(entrada) {
  if (typeof entrada !== 'string') return null;
  let digitos = entrada.replace(/[\s\-().]/g, '');
  if (digitos.startsWith('+')) digitos = digitos.slice(1);
  if (!/^\d+$/.test(digitos)) return null;

  // Formato viejo de WhatsApp: 521 + 10 dígitos
  if (digitos.length === 13 && digitos.startsWith('521')) digitos = '52' + digitos.slice(3);
  if (digitos.length === 12 && digitos.startsWith('52')) return '+' + digitos;
  if (digitos.length === 10) return '+52' + digitos;
  return null;
}

module.exports = { normalizarTelefono };
