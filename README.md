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
| `ADMIN_USUARIO`, `ADMIN_PASSWORD` | Credencial provisional de `/admin`; se deshabilita sola al existir un administrador en la tabla `usuarios` |
| `SESSION_SECRET` | Opcional: secreto de las sesiones del panel (si falta, se deriva de la credencial provisional) |
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
- `/boletos/sellado` — sellado del padrón: explicación antes; CSV, acta y SHA-256 después
- `/admin` — panel con usuarios individuales y roles (administrador / operador): resumen, participantes, importación CSV
- `/admin/acceso` — pantalla de acceso (correo y contraseña; sesión por cookie firmada)
- `/admin/usuarios` — gestión de usuarios (solo administrador): alta con contraseña temporal, desactivación y rol
- `/admin/boletos` — reclamo manual de folios, boletos de oficina, listado con filtros y detalle
- `/admin/parametros` — parámetros del sorteo (tabla `configuracion`) editables con validación
- `/admin/bitacora` — bitácora consultable del motor (emisiones, rechazos, anulaciones)
- `/admin/captura` — captura manual de ventas (alta individual y CSV) para estaciones sin importación
- `/admin/whatsapp` — conversaciones del bot, estado de envíos y reenvío manual
- `/admin/sellado` — simulacro de sellado (repetible) y sellado real (único, con doble confirmación)
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

El bot corre hoy contra el número de prueba de Meta; pasar a la línea real es
solo cambiar variables de entorno. El sorteo NO se anuncia al público hasta
tener permiso: el bot no debe conectarse a ninguna línea pública antes.
