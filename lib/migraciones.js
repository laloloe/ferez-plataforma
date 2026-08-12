// Ejecutor de migraciones: aplica en orden los archivos .sql de /migraciones
// que aún no estén registrados en la tabla _migraciones.

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { configurada, opcionesConexion } = require('./db');

const DIRECTORIO = path.join(__dirname, '..', 'migraciones');

async function ejecutarMigraciones() {
  if (!configurada()) {
    console.log('Migraciones omitidas: base de datos no configurada.');
    return { aplicadas: [] };
  }

  const conexion = await mysql.createConnection({
    ...opcionesConexion(),
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  const aplicadas = [];
  try {
    await conexion.query(`CREATE TABLE IF NOT EXISTS _migraciones (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(200) NOT NULL,
      fecha_aplicacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_migraciones_nombre (nombre)
    )`);

    const [filas] = await conexion.query('SELECT nombre FROM _migraciones');
    const hechas = new Set(filas.map((f) => f.nombre));

    const archivos = fs.readdirSync(DIRECTORIO).filter((a) => a.endsWith('.sql')).sort();
    for (const archivo of archivos) {
      if (hechas.has(archivo)) continue;
      const sql = fs.readFileSync(path.join(DIRECTORIO, archivo), 'utf8');
      console.log(`Aplicando migración ${archivo}...`);
      await conexion.query(sql);
      await conexion.query('INSERT INTO _migraciones (nombre) VALUES (?)', [archivo]);
      aplicadas.push(archivo);
    }
  } finally {
    await conexion.end();
  }

  console.log(aplicadas.length ? `Migraciones aplicadas: ${aplicadas.join(', ')}` : 'Base de datos al día.');
  return { aplicadas };
}

if (require.main === module) {
  ejecutarMigraciones()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error en migraciones:', err.message);
      process.exit(1);
    });
}

module.exports = { ejecutarMigraciones };
