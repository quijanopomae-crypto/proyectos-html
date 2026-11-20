import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const expectedUrl = 'libsql://cliente-001-pos-db-cr-cristian.aws-sa-east-1.turso.io';
const url = (process.env.TURSO_DATABASE_URL || '').trim();
const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim();

if (url !== expectedUrl || !authToken) {
  throw new Error('Detenido: faltan credenciales o la URL no es la base exclusiva del Cliente 001.');
}

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const migrationsPath = join(root, 'infra', 'database', 'migrations');
const files = (await readdir(migrationsPath)).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
if (files.length !== 36 || files[0] !== '0001_sync_operations.sql' || files.at(-1) !== '0036_pos_owner_device_log.sql') {
  throw new Error('Detenido: cantidad o nombres de migraciones distintos a los 36 verificados.');
}

const client = createClient({ url, authToken });
try {
  const initial = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const existingTables = initial.rows.map(row => String(row.name));
  const ledgerName = '__cliente001_schema_migrations';
  if (!existingTables.includes(ledgerName) && existingTables.length > 0) {
    throw new Error('Detenido: la base no esta vacia y no tiene registro propio de migraciones.');
  }
  if (!existingTables.includes(ledgerName)) {
    await client.execute(
      'CREATE TABLE IF NOT EXISTS __cliente001_schema_migrations ' +
      '(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    );
  }

  const ledger = await client.execute('SELECT name, sha256 FROM __cliente001_schema_migrations');
  const completed = new Map(ledger.rows.map(row => [String(row.name), String(row.sha256)]));
  const knownNames = new Set(files);
  for (const name of completed.keys()) {
    if (!knownNames.has(name)) throw new Error('Detenido: migracion desconocida ya registrada: ' + name);
  }

  let applied = 0;
  for (const name of files) {
    const sql = await readFile(join(migrationsPath, name), 'utf8');
    const sha256 = createHash('sha256').update(sql).digest('hex');
    if (completed.has(name)) {
      if (completed.get(name) !== sha256) throw new Error('Detenido: migracion modificada: ' + name);
      console.log('Verificada:', name);
      continue;
    }

    // La DDL y la marca de ejecucion van dentro de una misma transaccion.
    // Si una migracion falla, no se registra como aplicada.
    const tx = await client.transaction('write');
    try {
      await tx.executeMultiple(sql);
      await tx.execute({
        sql: 'INSERT INTO __cliente001_schema_migrations(name, sha256) VALUES (?, ?)',
        args: [name, sha256]
      });
      await tx.commit();
      applied++;
      console.log('Aplicada:', name);
    } catch (err) {
      try { await tx.rollback(); } catch { /* puede cerrarse tras un fallo */ }
      throw new Error('Error al migrar ' + name + ': ' + err.message);
    } finally {
      tx.close();
    }
  }

  const summary = await client.execute('SELECT COUNT(*) AS total FROM __cliente001_schema_migrations');
  const count = Number(summary.rows[0].total);
  if (count !== files.length) throw new Error('Migraciones incompletas: ' + count + '/' + files.length);
  const canonical = await client.execute('SELECT mode FROM canonical_control WHERE id=1');
  if (canonical.rows.length !== 1 || canonical.rows[0].mode !== 'LEGACY') {
    throw new Error('Autoridad inicial inesperada. No se permite activar ventas.');
  }
  console.log('OK: 36 migraciones registradas. Nuevas:', applied, '. Canonical en modo LEGACY.');
  console.log('Las ventas siguen desactivadas hasta completar la activacion funcional.');
} finally {
  client.close();
}
