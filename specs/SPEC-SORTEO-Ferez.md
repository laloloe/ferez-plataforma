# SPEC — Módulo de Sorteo · Plataforma Ferez

Documento de especificación para implementar el módulo de sorteo de Gasolineras Ferez.
Versión 0.2 · **EN EJECUCIÓN**

## Bitácora de cambios

| Versión | Fecha | Cambio |
|---|---|---|
| 0.1 | ago-2026 | Documento inicial. Pendiente de aprobación. |
| 0.2 | 31-ago-2026 | Se aprueban los parámetros del motor de boletos (sección 14, ORDEN 1 de Eduardo). El pendiente 1 de la sección 11 (mecánica del sorteo) queda resuelto en lo que toca a la generación de boletos. Estado del documento: EN EJECUCIÓN — se implementa el paso 5 de la sección 12. |

---

## 1. Contexto

Gasolineras Ferez opera tres estaciones en Chihuahua (Rubio, Km 12.9 Corredor Comercial, Oasis).
El sistema de punto de venta de las estaciones es **ControlGAS (ATIO Group)**, distribuido por CTN.

La plataforma vive en:
- Repo: `github.com/laloloe/ferez-plataforma`
- Producción: `ferez.mx` (Railway, despliegue automático desde `main`)
- Stack: Node + Express. Base de datos: TiDB Cloud (MySQL compatible).

---

## 2. Objetivo del módulo

Permitir que un cliente que carga combustible obtenga boletos para un sorteo,
enviando por WhatsApp el folio impreso en su ticket de compra.

---

## 3. Flujo del usuario

1. El cliente ve un **código QR** colocado en el dispensario.
2. Al escanearlo abre una conversación de WhatsApp con el número de la empresa
   (enlace `wa.me` con mensaje previo).
3. El cliente envía el **folio** de su ticket de carga.
4. El sistema valida el folio (ver sección 5).
5. El sistema responde en la misma conversación con su **número de boleto**.

### Requisito previo
El cliente debe estar **registrado en el sitio** antes de participar.
Si envía un folio desde un número no registrado, el bot responde con el enlace de registro
y no genera boleto hasta que complete el registro.

---

## 4. Modelo de datos

Diseñar pensando en **multiestación desde el inicio** y en que la misma base
servirá después al módulo de fidelización. La identidad del cliente es compartida
entre ambos módulos: no duplicar tablas de clientes.

### estaciones
- id
- nombre
- clave_controlgas (identificador de la estación en ControlGAS)
- activa

### clientes
- id
- telefono (único, normalizado a formato E.164, ej. +52625XXXXXXX) — **identidad principal**
- nombre
- fecha_registro
- acepto_aviso_privacidad (booleano + fecha)
- activo

### ventas
Espejo local de las cargas registradas en ControlGAS. Es la fuente de verdad
para validar folios.
- id
- estacion_id
- folio (único por estación)
- fecha_hora
- producto
- litros
- importe
- origen (`controlgas` | `manual`)
- fecha_importacion

### boletos
- id
- folio_boleto (visible al cliente, único, no adivinable)
- cliente_id
- venta_id (único — **una venta genera boletos una sola vez**)
- estacion_id
- cantidad (número de boletos generados por esa venta)
- fecha_emision
- estado (`activo` | `anulado`)

### mensajes_whatsapp
Bitácora de toda interacción, para auditoría y soporte.
- id
- telefono
- direccion (`entrante` | `saliente`)
- contenido
- resultado (`ok` | `folio_invalido` | `folio_usado` | `no_registrado` | `error`)
- fecha_hora

---

## 5. Validación del folio

Regla dura: **el folio enviado debe existir en la tabla `ventas`**, es decir,
debe corresponder a una carga real registrada por ControlGAS.

Casos y respuesta del bot:

| Caso | Respuesta |
|---|---|
| Folio existe, no usado, cliente registrado | Genera boleto y responde con el número |
| Folio no existe | "No encontramos ese folio. Verifica el número impreso en tu ticket." |
| Folio ya usado | "Ese folio ya generó boleto el [fecha]." |
| Teléfono no registrado | "Regístrate primero en ferez.mx/registro para participar." |
| Formato no reconocido | Repite la instrucción de cómo enviar el folio |

**Nunca** generar boletos con folios no verificados.

---

## 6. Integración con ControlGAS — capa aislada

⚠️ **La integración con ControlGAS aún no está definida.** Se está a la espera de
respuesta de CTN sobre si existe API, acceso de solo lectura a la base de datos,
o exportación automática.

Por eso: implementar la lectura de ventas detrás de una **interfaz abstracta**
(por ejemplo `FuenteDeVentas`) con al menos dos implementaciones:

1. `FuenteManual` — carga de ventas por archivo CSV o captura en panel. Funciona hoy.
2. `FuenteControlGAS` — a implementar cuando se conozca el mecanismo.

El resto del sistema no debe saber de dónde vienen las ventas. Cambiar de fuente
no debe requerir tocar la lógica de boletos.

---

## 7. Bot de WhatsApp

- Usar la **API de WhatsApp Business Cloud de Meta** (bot propio, sin intermediarios).
- Webhook para mensajes entrantes.
- Respuestas automáticas según la tabla de la sección 5.
- Toda credencial en variables de entorno, nunca en el repositorio.
- Registrar cada mensaje en `mensajes_whatsapp`.
- Contemplar límite de intentos por número para evitar abuso por fuerza bruta de folios.

---

## 8. Panel de administración

Acceso con usuario y contraseña, roles diferenciados.

Funciones mínimas:
- Consultar participantes y sus boletos
- Buscar por teléfono o por folio
- Importar ventas (CSV) mientras no exista la integración
- Anular boletos con motivo registrado
- **Exportar el padrón completo** en CSV
- Ver estadísticas: boletos por día, por estación, participantes únicos

---

## 9. Páginas públicas del sitio

- `/registro` — alta del participante (teléfono, nombre, aceptación del aviso de privacidad)
- `/boletos` — padrón público completo con buscador y contador (ver 9-bis)
- `/aviso-privacidad` — aviso de privacidad

---

---

## 9-bis. Transparencia y confianza publica

Contexto: buena parte de la clientela pertenece a la comunidad menonita de la region,
con desconfianza natural hacia lo digital. Un sorteo que se resuelve dentro de una
computadora sera percibido como manipulable. **La confianza no se declara: se demuestra
con evidencia verificable por terceros.**

### 9-bis.1 Padron publico

Pagina abierta, sin necesidad de iniciar sesion, en `/boletos`.

- Lista **completa** de boletos participantes, con paginacion.
- Columnas visibles: numero de boleto, estacion, fecha de emision.
- **Nunca** mostrar nombre, telefono ni dato personal alguno.
- Buscador por numero de boleto ("busca el mio").
- Contador total visible y prominente: "N boletos participando".

Razon de diseno: que el participante vea unicamente su boleto no prueba nada, porque
depende de la misma pagina que se lo otorgo. Ver el padron completo si genera certeza:
puede contar, comparar y confirmar que otros tambien aparecen.

### 9-bis.2 Sellado del padron

Antes de la fecha del sorteo:

- Se congela el padron: no se admiten boletos nuevos.
- Se genera un PDF con la lista completa, numerado y con fecha y hora de cierre.
- Se calcula y publica la **huella digital (hash SHA-256)** de ese archivo.
- El PDF queda disponible para descarga publica y se entrega copia impresa al notario.

Esto permite que cualquiera compruebe despues que la lista no fue alterada.
Explicarlo en el sitio en lenguaje llano, sin tecnicismos:
"La lista se cerro, se imprimio y se entrego antes del sorteo."

### 9-bis.3 El sorteo es fisico, no digital

**El sistema no elige al ganador.** La plataforma emite boletos y lleva el padron;
la seleccion del ganador ocurre de forma fisica y presencial:

- Tombola con boletos de papel, en una de las estaciones.
- Con publico presente y ante notario.
- Transmitido en vivo por redes sociales.

Un numero elegido por computadora siempre podra ser puesto en duda. Uno que sale de
una tombola frente a la gente, no.

### 9-bis.4 Evidencia en manos del cliente

El boleto llega por WhatsApp al telefono del participante, con fecha y hora, y queda
fuera del control de la empresa. Esa constancia en su propio dispositivo es la prueba
mas solida desde la perspectiva del cliente. El mensaje de confirmacion debe incluir:

- Numero de boleto
- Folio del ticket con el que se genero
- Estacion y fecha de la carga
- Enlace al padron publico

### 9-bis.5 Publicacion de resultados

- Los boletos ganadores se publican en el sitio junto a la fecha del acto y el nombre
  del notario que dio fe.
- Se publica el video del sorteo.
- Se mantiene el padron sellado accesible despues del evento.

---

## 10. Protección de datos

Los datos personales captados son propiedad de Estación de Servicio Ferez, S.A. de C.V.

- Obtener consentimiento explícito en el registro (LFPDPPP).
- Aviso de privacidad publicado y enlazado desde todos los puntos de captación.
- El padrón debe ser exportable en formato estándar en cualquier momento.
- No compartir datos con terceros.

---

## 11. Pendientes que bloquean el cierre

Estos puntos **no están definidos** y deben resolverse antes de terminar el módulo:

1. **Mecánica del sorteo** (responsable: Carlos Solís Juárez)
   - Cuántos boletos genera una carga y bajo qué criterio (monto, producto, etc.)
   - Vigencia y periodo de participación
   - Premios, fechas y criterio de desempate
   - Exclusiones y qué procede si un premio no se reclama
   - Manejo de boletos con costo y su destino a beneficencia

2. **Integración con ControlGAS** (respuesta pendiente de CTN)

3. **Número de WhatsApp Business** a utilizar

Mientras 1 y 2 no se resuelvan, construir todo lo demás dejando la regla de
generación de boletos **parametrizable** (configurable sin cambiar código).

---

## 12. Orden sugerido de implementación

1. Reorganizar el repo: mover el contenido de `ferez-plataforma-inicial/` a la raíz
   y quitar el Root Directory en Railway.
2. Conexión a base de datos y migraciones del modelo de datos.
3. Registro de clientes y aviso de privacidad.
4. Importación manual de ventas (CSV) + panel básico.
5. Motor de generación de boletos, con reglas parametrizables.
6. Webhook de WhatsApp y respuestas automáticas.
7. Padrón público con buscador y contador total (sección 9-bis).
8. Exportación del padrón, sellado con hash y estadísticas.
9. `FuenteControlGAS` cuando se conozca el mecanismo.

---

## 13. Criterios de calidad

- Nada de credenciales en el repositorio.
- Los folios de boleto no deben ser adivinables ni secuenciales predecibles.
- Una venta nunca puede generar boletos dos veces (restricción a nivel de base de datos).
- Toda operación queda registrada con fecha y responsable.
- El sistema debe funcionar correctamente con las tres estaciones desde el inicio.
- El padrón público no debe exponer ningún dato personal.
- El sistema no selecciona ganadores: solo emite boletos y resguarda el padrón.

---

## 14. Parámetros del motor — APROBADOS 31-ago-2026

Aprobados por Eduardo (ORDEN 1 — SORTEO FEREZ 2027). Se siembran como valores
por defecto en la tabla `configuracion` y son editables desde `/admin` sin
cambiar código.

| Parámetro | Valor | Nota |
|---|---|---|
| `monto_por_boleto` | 700 (MXN) | |
| `acumula_multiplos` | true | Boletos por venta = ⌊importe / 700⌋. $1,400 = 2 boletos. **Nunca** se suman importes de ventas distintas. |
| `productos_participantes` | solo combustibles, todos por igual | Otros conceptos no generan boletos. |
| `formas_pago_excluidas` | vales | Contado y crédito participan igual. |
| asignación | al cliente registrado que reclama | El boleto se emite al teléfono E.164 registrado que reclama el folio. |
| `dias_para_reclamar` | 7 | Días naturales desde la fecha de la venta. |
| `precio_boleto_oficina` | 70 (MXN) | Alta desde /admin con nombre, teléfono y recibo; misma numeración; origen "compra". |
| `tope_por_persona` | 0 | Sin tope. |
| `formato_boleto` | `SF27-` + consecutivo global de 6 dígitos | Desde SF27-000001, sin huecos. |
| `cierre_padron` | 2027-12-16 12:00 hora local | Después del cierre no se emite nada. |

Estaciones: **Campo** y **Rubio** operan por importación; **Oasis** queda de
alta como estación participante (sus ventas entrarán por captura manual más
adelante).

Garantías del motor: emisión idempotente (una venta genera boletos una sola
vez, con restricción a nivel de base de datos); numeración consecutiva sin
huecos ni duplicados bajo concurrencia (contador con bloqueo en transacción);
boletos VIGENTE/ANULADO — la anulación registra motivo y fecha, no borra ni
libera el número; rechazos con código estable y motivo claro (los usará el
bot tal cual); bitácora de cada emisión y cada rechazo.
