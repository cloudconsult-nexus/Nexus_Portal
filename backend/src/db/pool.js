import pg from 'pg';

const { Pool } = pg;

// On Cloud Run, Postgres is reached over the Cloud SQL Auth Proxy's Unix
// socket, mounted at
// /cloudsql/<INSTANCE_CONNECTION_NAME> (set via the --add-cloudsql-instances flag).
// Locally / anywhere else, we connect over TCP using DB_HOST + DB_PORT.
const isSocket = !!process.env.INSTANCE_CONNECTION_NAME;

const pool = new Pool(
  isSocket
    ? {
        host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
        user: process.env.DB_USER || 'oncallpro',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'oncallpro',
      }
);

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
});

// Named export is what backend/src/seedAdmin.js (a file that survived the
// data loss unmodified) actually imports — confirmed by its import failing
// against a default-only export. Keeping both so nothing else has to change.
export { pool };
export default pool;
