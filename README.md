# Plataforma Ferez

Plataforma digital de Gasolineras Ferez: sitio informativo, sorteo y fidelización.

## Correr en local

```bash
npm install
npm start
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

Sin base de datos configurada el sitio sigue funcionando; registro y panel responden 503.

## Rutas

- `/` — landing
- `/registro` — alta de participantes (nombre, teléfono E.164, aceptación del aviso)
- `/aviso-privacidad` — aviso de privacidad (LFPDPPP)
- `/admin` — panel: resumen, participantes, importación de ventas por CSV
- `/salud` — estado del servicio

## Importación de ventas (CSV)

Mientras no exista la integración con ControlGAS, las ventas se importan por
CSV desde `/admin/ventas` (un archivo por estación). Columnas requeridas:
`folio` y `fecha_hora` (o `fecha`); opcionales: `producto`, `litros`, `importe`.
Duplicados (mismo folio y estación) se omiten automáticamente.

## Despliegue

Automático en Railway con cada push a `main`. Las migraciones se aplican al arrancar.

## Pendientes (ver SPEC sección 11)

- Mecánica del sorteo (reglas parametrizables en la tabla `configuracion`)
- Integración con ControlGAS (ATIO) — implementar `FuenteControlGAS`
- Motor de boletos, webhook de WhatsApp, padrón público y sellado
