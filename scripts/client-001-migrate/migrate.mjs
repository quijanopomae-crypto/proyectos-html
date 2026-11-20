import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const expectedUrl = 'libsql://cliente-001-pos-db-cr-cristian.aws-sa-east-1.turso.io';
const url = (process.env.TURSO_DATABASE_URL || '').trim();
const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim();
const target = process.env.CLIENT001_MIGRATION_TARGET || 'production';
let temporaryUrl = false;
try {
  const parsed = new URL(url);
  temporaryUrl = parsed.protocol === 'libsql:'
    && parsed.hostname.startsWith('cliente-001-canon-temp-')
    && parsed.hostname.endsWith('.turso.io')
    && !parsed.username && !parsed.password && !parsed.pathname && !parsed.search && !parsed.hash;
} catch { /* Invalid URLs fail the guard below. */ }

if (!authToken || (target === 'production' && url !== expectedUrl)
    || (target === 'temporary' && (!temporaryUrl || url === expectedUrl))
    || !['production', 'temporary'].includes(target)) {
  throw new Error('Detenido: credenciales o URL incompatibles con el destino Cliente 001 seleccionado.');
}

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const migrationsPath = join(root, 'infra', 'database', 'migrations');
const files = (await readdir(migrationsPath)).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
if (files.length !== 37 || files[0] !== '0001_sync_operations.sql' || files.at(-1) !== '0037_canonical_empty_bootstrap.sql') {
  throw new Error('Detenido: cantidad o nombres de migraciones distintos a los 37 verificados.');
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
  const canonical = await client.execute('SELECT mode,revision,authority_epoch,active_promotion_id,writer_device_id FROM canonical_control WHERE id=1');
  if (canonical.rows.length !== 1) throw new Error('Autoridad CANON ausente o duplicada.');
  const control = canonical.rows[0];
  const authority = await client.execute(`
    SELECT a.id FROM canonical_initial_authority a
    JOIN canonical_control c ON c.id=a.id
    JOIN canonical_promotions p ON p.promotion_id=a.promotion_id
    JOIN import_runs r ON r.import_id=a.import_id
    WHERE a.id=1 AND a.client_id='cliente-001' AND a.base_revision=0
      AND a.control_revision=3 AND a.authority_epoch=3
      AND c.mode='ACTIVE' AND c.revision=a.control_revision AND c.authority_epoch=a.authority_epoch
      AND c.active_promotion_id=a.promotion_id AND c.writer_device_id=a.principal_id
      AND c.minimum_client_contract='a6-gate-c-v1'
      AND p.status='COMMITTED' AND p.operation_id=a.operation_id AND p.request_hash=a.request_hash
      AND p.import_id=r.import_id AND p.device_id=a.principal_id AND p.control_revision=1
      AND p.previous_mode='FROZEN' AND p.previous_promotion_id IS NULL
      AND p.candidate_revision=0 AND p.sealed_revision=0
      AND p.canonical_digest='4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
      AND r.status='PASS' AND r.device_id=a.principal_id AND r.row_count=0 AND r.revision=0
      AND NOT EXISTS(SELECT 1 FROM import_staging WHERE import_id=a.import_id)
      AND NOT EXISTS(SELECT 1 FROM products WHERE promotion_id=a.promotion_id)
      AND NOT EXISTS(SELECT 1 FROM customers WHERE promotion_id=a.promotion_id)
      AND NOT EXISTS(SELECT 1 FROM credits WHERE promotion_id=a.promotion_id)
      AND NOT EXISTS(SELECT 1 FROM credit_payments WHERE promotion_id=a.promotion_id)
  `);
  if (control.mode === 'LEGACY' && Number(control.revision) === 0 && Number(control.authority_epoch) === 0
      && control.active_promotion_id === null && control.writer_device_id === null && authority.rows.length === 0) {
    const anyAuthority = await client.execute('SELECT COUNT(*) AS total FROM canonical_initial_authority');
    if (Number(anyAuthority.rows[0].total) !== 0) throw new Error('Autoridad inicial incompatible con LEGACY.');
    console.log('OK: 37 migraciones registradas. Nuevas:', applied, '. CANON en LEGACY.');
    console.log('Las ventas siguen desactivadas hasta completar la inicializacion funcional.');
  } else if (control.mode === 'ACTIVE' && authority.rows.length === 1) {
    console.log('OK: 37 migraciones registradas. Nuevas:', applied, '. Autoridad inicial ACTIVE verificada.');
  } else {
    throw new Error('Autoridad CANON inesperada: ni LEGACY inicial ni ACTIVE con inicializacion valida.');
  }
} finally {
  client.close();
}
