// Pruebas de la ORDEN 12: modo exhibición. Sin permiso, la clave
// modo_exhibicion=true muestra el sorteo al público SIN sesión con banners
// "SIN VALIDEZ"; apagada, todo sigue oculto (ORDEN 9). Con permiso, inerte.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { configurada, consultar, obtenerPool } = require('../lib/db');
const { ejecutarMigraciones } = require('../lib/migraciones');
const modo = require('../servicios/modo-pruebas');
const { validarValor } = require('../lib/configuracion');
const { app } = require('../server');

const hayBD = configurada();
let servidor;
let base;

async function pedir(ruta) {
  const respuesta = await fetch(base + ruta);
  return { status: respuesta.status, texto: await respuesta.text() };
}

async function fijar(clave, valor) {
  await consultar('UPDATE configuracion SET valor = ? WHERE clave = ?', [valor, clave]);
}

// La franja usa position:sticky (no fixed): ocupa su propio renglón y jamás
// tapa contenido, tampoco en un viewport angosto de teléfono.
test('la franja es sticky, no fixed: no puede tapar contenido en móvil', () => {
  const franja = modo.franjaHTML();
  assert.equal(franja.includes('position:sticky'), true);
  assert.equal(franja.includes('position:fixed'), false);
  assert.equal(modo.franjaExhibicionHTML().includes('DEMOSTRACIÓN — SIN VALIDEZ'), true);
});

test('whatsapp_link: vacía permitida; con valor debe ser liga https', () => {
  assert.equal(validarValor('whatsapp_link', '').ok, true);
  assert.equal(validarValor('whatsapp_link', 'https://wa.me/5216251234567').ok, true);
  assert.equal(validarValor('whatsapp_link', 'http://wa.me/x').ok, false);
  assert.equal(validarValor('whatsapp_link', 'wa.me/x').ok, false);
});

before(async () => {
  if (!hayBD) return;
  await ejecutarMigraciones();
  await fijar('numero_permiso', '');
  await fijar('modo_exhibicion', 'false');
  await fijar('whatsapp_link', '');
  servidor = app.listen(0);
  await new Promise((resolver) => servidor.on('listening', resolver));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (hayBD) {
    await fijar('numero_permiso', '');
    await fijar('modo_exhibicion', 'false');
    await obtenerPool().end();
  }
  if (servidor) servidor.close();
});

test('clave apagada: todo oculto como hoy (cinta, sección y /bases incluidas)', { skip: !hayBD }, async () => {
  const boletos = await pedir('/boletos');
  assert.equal(boletos.texto.includes('Próximamente'), true);
  const landing = await pedir('/');
  assert.equal(landing.texto.includes('Consultar mis boletos'), false);
  assert.equal(landing.texto.includes('DEMOSTRACIÓN'), false);
  assert.equal(landing.texto.includes('SORTEO FEREZ 2027'), false, 'sin cinta');
  assert.equal(landing.texto.includes('id="sorteo"'), false, 'sin sección');
  const bases = await pedir('/bases');
  assert.equal(bases.texto.includes('Próximamente'), true, '/bases también oculta');
});

test('clave encendida sin permiso: todo visible al público con banners', { skip: !hayBD }, async () => {
  await fijar('modo_exhibicion', 'true');

  const boletos = await pedir('/boletos');
  assert.equal(boletos.texto.includes('Próximamente'), false);
  assert.equal(boletos.texto.includes('Busca tu boleto'), true, 'padrón completo sin sesión');
  assert.equal(boletos.texto.includes('MODO PRUEBAS — SIN VALIDEZ'), true, 'con franja para todos');

  const sellado = await pedir('/boletos/sellado');
  assert.equal(sellado.texto.includes('Próximamente'), false);
  assert.equal(sellado.texto.includes('MODO PRUEBAS — SIN VALIDEZ'), true);

  const registro = await pedir('/registro');
  assert.equal(registro.status, 200);
  assert.equal(registro.texto.includes('MODO PRUEBAS — SIN VALIDEZ'), true);

  const landing = await pedir('/');
  assert.equal(landing.texto.includes('Consultar mis boletos'), true, 'ligas del sorteo visibles');
  assert.equal(landing.texto.includes('Boletos de sorteo'), true, 'liga del pie visible');
  assert.equal(landing.texto.includes('DEMOSTRACIÓN — SIN VALIDEZ'), true, 'banda superior');
  // Cinta bajo el header, toda tocable, con scroll al ancla #sorteo.
  assert.equal(landing.texto.includes('Cada $700 de carga te da un boleto'), true, 'cinta presente');
  assert.equal(landing.texto.includes('class="cinta-sorteo" href="#sorteo"'), true, 'toda la cinta enlaza a #sorteo');
  assert.equal(landing.texto.includes('Cómo participar'), true);

  // Sección #sorteo con los 4 pasos y la botonera completa.
  assert.equal(landing.texto.includes('id="sorteo"'), true);
  assert.equal(landing.texto.includes('Regístrate una sola vez'), true);
  for (const destino of ['/registro', '/boletos', '/constancia', '/boletos/sellado', '/bases']) {
    assert.equal(landing.texto.includes(`href="${destino}"`), true, `botón a ${destino}`);
  }
  assert.equal(landing.texto.includes('nadie puede alterar los boletos'), true, 'línea de transparencia');
  assert.equal(landing.texto.includes('wa.me'), false, 'sin botón de WhatsApp con la clave vacía');
  assert.equal(landing.texto.includes('%%WHATSAPP_LINK%%'), false, 'sin marcador residual');
  // La tarjeta de Recompensas ya no duplica: enlaza a #sorteo.
  assert.equal(landing.texto.includes('href="#sorteo">Consultar mis boletos'), true);

  // Prohibido hablar de trámites en textos promocionales (cinta y sección incluidas).
  assert.equal(/tr[áa]mite/i.test(landing.texto), false, 'sin "permiso en trámite" en la landing');

  // Con whatsapp_link llena, el botón aparece con esa liga.
  await fijar('whatsapp_link', 'https://wa.me/5216251112233');
  const conWA = await pedir('/');
  assert.equal(conWA.texto.includes('href="https://wa.me/5216251112233"'), true, 'botón de WhatsApp');
  await fijar('whatsapp_link', '');

  // /bases visible con la franja de pruebas.
  const bases = await pedir('/bases');
  assert.equal(bases.texto.includes('se publicarán aquí al inicio de la promoción'), true);
  assert.equal(bases.texto.includes('MODO PRUEBAS — SIN VALIDEZ'), true);
});

test('con numero_permiso llena la clave queda inerte: todo limpio', { skip: !hayBD }, async () => {
  await fijar('numero_permiso', '20270001PS07');
  for (const valor of ['true', 'false']) {
    await fijar('modo_exhibicion', valor);
    const boletos = await pedir('/boletos');
    assert.equal(boletos.texto.includes('Busca tu boleto'), true);
    assert.equal(boletos.texto.includes('MODO PRUEBAS'), false, `sin franja (exhibición=${valor})`);
    const landing = await pedir('/');
    assert.equal(landing.texto.includes('Consultar mis boletos'), true);
    assert.equal(landing.texto.includes('DEMOSTRACIÓN'), false, `sin banda (exhibición=${valor})`);
    const registro = await pedir('/registro');
    assert.equal(registro.texto.includes('MODO PRUEBAS'), false);
    assert.equal(landing.texto.includes('Cada $700 de carga te da un boleto'), true, 'cinta visible y limpia');
    const bases = await pedir('/bases');
    assert.equal(bases.texto.includes('se publicarán aquí'), true);
    assert.equal(bases.texto.includes('MODO PRUEBAS'), false);
  }
  await fijar('numero_permiso', '');
  await fijar('modo_exhibicion', 'false');
});
