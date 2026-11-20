import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import worker from '../../tools/cloudflare-lab/src/worker.js';
import { getDatabase } from '../../tools/cloudflare-lab/src/database-binding.js';
import {
  client001InitializationAvailable,
  initializeEmptyCanon,
} from '../../tools/cloudflare-lab/src/client-001-canon-init.js';

const url = (process.env.TURSO_DATABASE_URL || '').trim();
const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim();
let temporaryUrl = false;
try {
  const parsed = new URL(url);
  temporaryUrl = parsed.protocol === 'libsql:'
    && parsed.hostname.startsWith('cliente-001-canon-temp-')
    && parsed.hostname.endsWith('.turso.io')
    && !parsed.username && !parsed.password && !parsed.pathname && !parsed.search && !parsed.hash;
} catch { /* Invalid URLs fail the guard below. */ }
if (process.env.CLIENT001_MIGRATION_TARGET !== 'temporary' || !temporaryUrl || !authToken) {
  throw new Error('Solo se permite una base Turso temporal cliente-001-canon-temp-*.');
}

const client = createClient({ url, authToken });
const env = {
  DB_PROVIDER: 'turso',
  TURSO_DATABASE_URL: url,
  TURSO_AUTH_TOKEN: authToken,
  RUNTIME_ENVIRONMENT: 'production',
  CANONICAL_RUNTIME_ENABLED: 'disabled',
  POS_ACTIVATION_SECRET: randomUUID() + randomUUID(),
};
const json = (data, status) => Response.json(data, { status });
const body = {
  client_id: 'cliente-001',
  operation_id: 'client001-temp-' + randomUUID(),
  expected_control_revision: 0,
};
const query = async (sql, args = []) => (await client.execute({ sql, args })).rows;
const count = async (table) => Number((await query('SELECT COUNT(*) AS n FROM "' + table + '"'))[0].n);
const control = async () => (await query(
  'SELECT mode,revision,authority_epoch,active_promotion_id FROM canonical_control WHERE id=1'
))[0];
const initialize = (requestBody) => initializeEmptyCanon(
  new Request('https://cliente-001-canon-temp.test/commands/canonical.initialize-empty', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  }),
  env,
  auth,
  json,
);
let auth;

try {
  console.log('fase: esquema y aislamiento');
  assert.equal(await count('__cliente001_schema_migrations'), 37);
  assert.deepEqual(
    { mode: (await control()).mode, revision: Number((await control()).revision) },
    { mode: 'LEGACY', revision: 0 },
  );
  assert.equal(client001InitializationAvailable(env), false);
  const isolated = await worker.fetch(
    new Request('https://cliente-001-canon-temp.test/commands/canonical.initialize-empty', { method: 'POST' }),
    env,
  );
  assert.equal(isolated.status, 404);

  console.log('fase: trigger de transicion directa');
  await assert.rejects(
    client.execute("UPDATE canonical_control SET mode='ACTIVE',revision=revision+1,authority_epoch=authority_epoch+1 WHERE id=1"),
    /gate_p_control/,
  );
  assert.equal((await control()).mode, 'LEGACY');

  console.log('fase: sesion de dueno');
  const activation = await worker.fetch(
    new Request('https://cliente-001-canon-temp.test/auth/activate', {
      method: 'POST',
      headers: { 'x-activation-secret': env.POS_ACTIVATION_SECRET },
    }),
    env,
  );
  assert.equal(activation.status, 200, await activation.clone().text());
  const sessionToken = (await activation.json()).session_token;
  const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
  const session = (await query(
    "SELECT d.device_id FROM auth_sessions s JOIN devices d ON d.device_id='session:'||s.session_id WHERE s.token_hash=?",
    [tokenHash],
  ))[0];
  assert.ok(session?.device_id);
  auth = { principalId: session.device_id, credentialHash: tokenHash, posRole: 'owner' };

  const db = getDatabase(env);
  const batch = db.batch.bind(db);
  let batchError;
  db.batch = async (statements) => {
    try { return await batch(statements); }
    catch (error) { batchError = error; throw error; }
  };

  console.log('fase: rollback forzado');
  await client.execute(
    "CREATE TRIGGER client001_temp_forced_abort BEFORE INSERT ON canonical_promotions BEGIN SELECT RAISE(ABORT,'client001_temp_rollback'); END",
  );
  try {
    const failed = await initialize(body);
    assert.equal(failed.status, 409);
    assert.match(String(batchError?.message), /client001_temp_rollback/);
    assert.equal((await control()).mode, 'LEGACY');
    for (const table of ['import_runs', 'canonical_promotions', 'canonical_initial_authority', 'canonical_assertions']) {
      assert.equal(await count(table), 0, table + ' must roll back');
    }
  } finally {
    await client.execute('DROP TRIGGER IF EXISTS client001_temp_forced_abort');
  }

  console.log('fase: inicializacion valida');
  const created = await initialize(body);
  assert.equal(created.status, 201, await created.clone().text());
  const receipt = await created.json();
  assert.equal(receipt.mode, 'ACTIVE');
  assert.equal((await control()).mode, 'ACTIVE');
  assert.equal(Number((await control()).revision), 3);
  assert.equal(Number((await control()).authority_epoch), 3);
  assert.equal(await count('canonical_initial_authority'), 1);
  assert.equal(await count('import_staging'), 0);
  for (const table of ['products', 'customers', 'sales']) assert.equal(await count(table), 0);
  const source = (await query("SELECT status,row_count FROM import_runs WHERE import_id='cliente-001-empty-source'"))[0];
  assert.equal(source.status, 'PASS');
  assert.equal(Number(source.row_count), 0);
  const promotion = (await query(
    "SELECT status,sealed_revision,candidate_revision FROM canonical_promotions WHERE promotion_id='cliente-001-empty-canon'"
  ))[0];
  assert.equal(promotion.status, 'COMMITTED');
  assert.equal(Number(promotion.sealed_revision), 0);
  assert.equal(Number(promotion.candidate_revision), 0);

  console.log('fase: idempotencia e inmutabilidad');
  const repeated = await initialize(body);
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), receipt);
  assert.equal((await initialize({ ...body, operation_id: body.operation_id + '-different' })).status, 409);
  assert.equal(await count('canonical_initial_authority'), 1);
  await assert.rejects(
    client.execute("UPDATE canonical_initial_authority SET operation_id='changed' WHERE id=1"),
    /immutable_initial_authority/,
  );
  await assert.rejects(
    client.execute('DELETE FROM canonical_initial_authority WHERE id=1'),
    /immutable_initial_authority/,
  );
  console.log('PASS: Turso temporal aplicó triggers, rollback, autoridad inicial e idempotencia; runtime desactivado.');
} finally {
  client.close();
}
