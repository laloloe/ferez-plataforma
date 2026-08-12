// Capa de acceso a base de datos (TiDB Cloud / MySQL compatible).
//
// Configuración por variables de entorno:
//   DATABASE_URL  — cadena mysql://usuario:contraseña@host:puerto/base
//   o bien DB_HOST, DB_PORT, DB_USUARIO, DB_PASSWORD, DB_NOMBRE
//   DB_SSL=off    — desactiva TLS (solo para desarrollo local)
//
// Si no hay configuración, el servidor arranca igual y las rutas que
// necesitan base de datos responden 503.

const mysql = require('mysql2/promise');

let pool = null;

function configurada() {
  return Boolean(process.env.DATABASE_URL || process.env.DB_HOST);
}

function opcionesSSL(host) {
  if (process.env.DB_SSL === 'off') return undefined;
  if (host === 'localhost' || host === '127.0.0.1') return undefined;
  // TiDB Cloud exige TLS
  return { minVersion: 'TLSv1.2', rejectUnauthorized: true };
}

function opcionesConexion() {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
      ssl: opcionesSSL(url.hostname),
    };
  }
  return {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USUARIO,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NOMBRE,
    ssl: opcionesSSL(process.env.DB_HOST),
  };
}

function obtenerPool() {
  if (!configurada()) return null;
  if (!pool) {
    pool = mysql.createPool({
      ...opcionesConexion(),
      waitForConnections: true,
      connectionLimit: 5,
      charset: 'utf8mb4',
    });
  }
  return pool;
}

async function consultar(sql, parametros = []) {
  const p = obtenerPool();
  if (!p) throw new Error('Base de datos no configurada');
  const [filas] = await p.execute(sql, parametros);
  return filas;
}

module.exports = { configurada, obtenerPool, opcionesConexion, consultar };
