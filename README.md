# Plataforma Ferez

Plataforma digital de Gasolineras Ferez: sitio informativo, sorteo y fidelización.

## Correr en local

```bash
npm install
npm start
```

Pruebas (las de motor requieren una base MySQL de prueba en las variables `DB_*`):

```bash
npm test
```

Abre http://localhost:3000

## Estructura

- `server.js` — servidor Express
- `public/` — sitio estático (landing, registro, aviso de privacidad)
- `lib/` — base de datos, migraciones, utilerías
- `migraciones/` — archivos SQL aplicados en orden al arrancar (o con `npm run migrar`)
- `rutas/` — registro de clientes y panel de administración
- `fuentes/` — fuentes de ventas (interfaz abstracta; hoy: CSV manual)
- `/salud` — verificación de estado del servicio

## Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión `mysql://usuario:contraseña@host:puerto/base` (TiDB Cloud) |
| `DB_HOST`, `DB_PORT`, `DB_USUARIO`, `DB_PASSWORD`, `DB_NOMBRE` | Alternativa a `DATABASE_URL` |
| `DB_SSL` | `off` para desactivar TLS (solo desarrollo local) |
| `ADMIN_USUARIO`, `ADMIN_PASSWORD` | Credenciales del panel `/admin` |
| `WHATSAPP_TOKEN` | Token de acceso de la app de Meta (hoy: número de prueba) |
| `WHATSAPP_PHONE_NUMBER_ID` | Id del número emisor en la Cloud API |
| `WHATSAPP_VERIFY_TOKEN` | Token que se configura en la verificación del webhook |
| `WHATSAPP_APP_SECRET` | Secreto de la app (firma X-Hub-Signature-256) |
| `SITIO_URL` | Base de las ligas del bot (por defecto https://ferez.mx) |

Sin base de datos configurada el sitio sigue funcionando; registro y panel responden 503.

## Rutas

- `/` — landing
- `/registro` — alta de participantes (nombre, teléfono E.164, aceptación del aviso)
- `/aviso-privacidad` — aviso de privacidad (LFPDPPP)
- `/boletos` — padrón público: contador, buscador (boleto o teléfono) y lista completa paginada
- `/admin` — panel: resumen, participantes, importación de ventas por CSV
- `/admin/boletos` — reclamo manual de folios, boletos de oficina, listado con filtros y detalle
- `/admin/parametros` — parámetros del sorteo (tabla `configuracion`) editables con validación
- `/admin/bitacora` — bitácora consultable del motor (emisiones, rechazos, anulaciones)
- `/admin/captura` — captura manual de ventas (alta individual y CSV) para estaciones sin importación
- `/admin/whatsapp` — conversaciones del bot, estado de envíos y reenvío manual
- `/webhooks/whatsapp` — webhook de la Cloud API de Meta (verificación GET + mensajes POST firmados)
- `/salud` — estado del servicio

## Importación de ventas (CSV)

Mientras no exista la integración con ControlGAS, las ventas se importan por
CSV desde `/admin/ventas` (un archivo por estación). Columnas requeridas:
`folio` y `fecha_hora` (o `fecha`); opcionales: `producto`, `litros`, `importe`.
Duplicados (mismo folio y estación) se omiten automáticamente.

## Despliegue

Automático en Railway con cada push a `main`. Las migraciones se aplican al arrancar.

## Módulo de sorteo

El SPEC vive en `specs/SPEC-SORTEO-Ferez.md` (v0.2, EN EJECUCIÓN). El motor de
boletos (`servicios/`) emite por reclamo de folio o compra en oficina, con
numeración global `SF27-######` sin huecos, parámetros en `configuracion`
editables desde `/admin/parametros`, y bitácora en `bitacora_boletos`.

## Pendientes (ver SPEC sección 11)

- Integración con ControlGAS (ATIO) — implementar `FuenteControlGAS`
- Sellado del padrón con hash y exportación (paso 8 de la sección 12)

El bot corre hoy contra el número de prueba de Meta; pasar a la línea real es
solo cambiar variables de entorno. El sorteo NO se anuncia al público hasta
tener permiso: el bot no debe conectarse a ninguna línea pública antes.
