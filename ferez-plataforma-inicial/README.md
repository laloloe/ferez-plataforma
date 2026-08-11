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
- `public/` — sitio estático (landing)
- `/salud` — verificación de estado del servicio

## Despliegue

Automático en Railway con cada push a `main`.

## Pendientes

- Integración con ControlGAS (ATIO) para lectura de ventas
- Módulo de sorteo
- Módulo de fidelización
