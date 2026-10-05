// Pruebas de la ORDEN 17: el POST del webhook de WhatsApp deja UNA línea
// de diagnóstico en el log por cada rama (FIRMA_OK / FIRMA_INVALIDA /
// NO_CONFIGURADO), sin token, secreto, cuerpo ni teléfonos.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { configurada, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const { app } = require('../server');

const hayBD = configurada();
let servidor;
let base;

const SECRETO = 'secreto-webhook-prueba';
const TOKEN = 'TOKEN-WEBHOOK-ULTRA-SECRETO';
const TELEFONO = '5216251112233';

function capturarLog() {
  const lineas = [];
  const original = console.log;
  console.log = (...args) => { lineas.push(args.join(' ')); };
  return { lineas, restaurar: () => { console.log = original; } };
}

async function publicar({ cuerpo, firma }) {
  const crudo = JSON.stringify(cuerpo);
  return fetch(`${base}/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(firma ? { 'x-hub-signature-256': firma } : {}),
    },
    body: crudo,
  });
}

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  process.env.WHATSAPP_TOKEN = TOKEN;
  process.env.WHATSAPP_PHONE_NUMBER_ID = '12345';
  process.env.WHATSAPP_VERIFY_TOKEN = 'verif';
  process.env.WHATSAPP_APP_SECRET = SECRETO;
  servidor = app.listen(0);
  await new Promise((resolver) => servidor.on('listening', resolver));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  for (const clave of ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET']) {
    delete process.env[clave];
  }
  if (servidor) servidor.close();
  if (hayBD) await obtenerPool().end();
});

test('FIRMA_OK: una línea con encabezado-firma=si y los bytes del cuerpo', { skip: !hayBD }, async () => {
  const cuerpo = { entry: [], de: TELEFONO }; // el teléfono va en el cuerpo, no debe salir en el log
  const crudo = JSON.stringify(cuerpo);
  const firma = 'sha256=' + crypto.createHmac('sha256', SECRETO).update(Buffer.from(crudo)).digest('hex');
  const captura = capturarLog();
  try {
    const r = await publicar({ cuerpo, firma });
    assert.equal(r.status, 200);
  } finally { captura.restaurar(); }

  const linea = captura.lineas.find((l) => l.includes('[webhook-whatsapp]'));
  assert.equal(Boolean(linea), true, 'hay línea de diagnóstico');
  assert.equal(linea.includes('FIRMA_OK'), true);
  assert.equal(linea.includes('encabezado-firma=si'), true);
  assert.equal(linea.includes(`bytes=${Buffer.byteLength(crudo)}`), true);
  assert.equal(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(linea), true, 'con timestamp');
  // Nada sensible en la línea:
  assert.equal(linea.includes(TELEFONO), false, 'sin teléfonos');
  assert.equal(linea.includes(SECRETO), false, 'sin secreto');
  assert.equal(linea.includes(TOKEN), false, 'sin token');
});

test('FIRMA_INVALIDA: 401 y línea con encabezado-firma correcto', { skip: !hayBD }, async () => {
  const captura = capturarLog();
  try {
    const conFirmaMala = await publicar({ cuerpo: { entry: [] }, firma: 'sha256=' + '0'.repeat(64) });
    assert.equal(conFirmaMala.status, 401);
    const sinFirma = await publicar({ cuerpo: { entry: [] } });
    assert.equal(sinFirma.status, 401);
  } finally { captura.restaurar(); }

  const lineas = captura.lineas.filter((l) => l.includes('FIRMA_INVALIDA'));
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].includes('encabezado-firma=si'), true, 'traía encabezado (aunque inválido)');
  assert.equal(lineas[1].includes('encabezado-firma=no'), true, 'sin encabezado');
  for (const linea of lineas) {
    assert.equal(linea.includes(SECRETO), false);
  }
});

test('NO_CONFIGURADO: 503 con su línea cuando faltan variables', { skip: !hayBD }, async () => {
  const secreto = process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  const captura = capturarLog();
  try {
    const r = await publicar({ cuerpo: { entry: [] } });
    assert.equal(r.status, 503);
  } finally {
    captura.restaurar();
    process.env.WHATSAPP_APP_SECRET = secreto;
  }
  const linea = captura.lineas.find((l) => l.includes('[webhook-whatsapp]'));
  assert.equal(linea.includes('NO_CONFIGURADO'), true);
  assert.equal(linea.includes('bytes='), true);
});
