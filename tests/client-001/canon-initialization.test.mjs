import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../tools/cloudflare-lab/src/worker.js';
import { handleA6 } from '../../tools/cloudflare-lab/src/a6-canonical.js';
import { tursoSqlite } from '../cloud-sync/turso-sqlite-protocol.mjs';
import { device } from '../cloud-sync/canon-browser-harness.mjs';

const migrations = new URL('../../infra/database/migrations/', import.meta.url);
const tursoUrl = 'libsql://cliente-001-pos-db-cr-cristian.aws-sa-east-1.turso.io';
const initialBody = { client_id: 'cliente-001', operation_id: 'client001-first-authority', expected_control_revision: 0 };

function fixture(t) {
  const database = new DatabaseSync(':memory:');
  const files = readdirSync(migrations).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  database.exec('CREATE TABLE __cliente001_schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of files) {
    const sql = readFileSync(new URL(name, migrations), 'utf8');
    database.exec(sql);
    database.prepare('INSERT INTO __cliente001_schema_migrations(name,sha256) VALUES (?,?)')
      .run(name, createHash('sha256').update(sql).digest('hex'));
  }
  const transport = tursoSqlite(database);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => transport.adapter.fetchImpl(url, options);
  t.after(() => { globalThis.fetch = originalFetch; database.close(); });
  const env = {
    DB_PROVIDER: 'turso', TURSO_DATABASE_URL: tursoUrl, TURSO_AUTH_TOKEN: 'synthetic-token',
    RUNTIME_ENVIRONMENT: 'production', CANONICAL_RUNTIME_ENABLED: 'disabled',
    POS_ACTIVATION_SECRET: 'client001-local-secret', READ_TOKEN: 'client001-read',
    DB: { prepare() { throw new Error('D1 must stay disconnected'); } },
  };
  return {
    database, env, transport,
    sql(query, ...args) { return database.prepare(query).get(...args); },
    control() { return this.sql('SELECT * FROM canonical_control WHERE id=1'); },
    async fetch(path, options = {}) { return worker.fetch(new Request(new URL(path, 'http://localhost'), options), env); },
    async activate() {
      const response = await this.fetch('/auth/activate', { method: 'POST', headers: { 'x-activation-secret': env.POS_ACTIVATION_SECRET } });
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()).session_token;
    },
    post(token, body = initialBody) {
      return this.fetch('/commands/canonical.initialize-empty', {
        method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
    },
  };
}

test('first owner activation records an empty CANON authority without importing shop data', async t => {
  const f = fixture(t);
  assert.deepEqual({ ...f.sql('SELECT mode,revision,authority_epoch FROM canonical_control WHERE id=1') },
    { mode: 'LEGACY', revision: 0, authority_epoch: 0 });
  assert.throws(() => f.database.exec("UPDATE canonical_control SET mode='ACTIVE',revision=revision+1,authority_epoch=authority_epoch+1 WHERE id=1"), /gate_p_control/);
  const token = await f.activate();
  const response = await f.post(token);
  assert.equal(response.status, 201, await response.clone().text());
  const receipt = await response.json();
  assert.equal(receipt.mode, 'ACTIVE');
  assert.equal(receipt.promotion_id, 'cliente-001-empty-canon');
  assert.deepEqual({ ...f.sql('SELECT mode,active_promotion_id,revision,authority_epoch,minimum_client_contract FROM canonical_control WHERE id=1') }, {
    mode: 'ACTIVE', active_promotion_id: 'cliente-001-empty-canon', revision: 3, authority_epoch: 3,
    minimum_client_contract: 'a6-gate-c-v1',
  });
  assert.equal(f.sql('SELECT COUNT(*) n FROM import_staging').n, 0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM products').n, 0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM customers').n, 0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM sales').n, 0);
  assert.equal(f.sql("SELECT status,sealed_revision,candidate_revision FROM canonical_promotions WHERE promotion_id='cliente-001-empty-canon'").status, 'COMMITTED');
  assert.equal(f.sql('SELECT operation_id FROM canonical_initial_authority WHERE id=1').operation_id, initialBody.operation_id);
  assert.throws(() => f.database.exec("UPDATE canonical_initial_authority SET operation_id='changed' WHERE id=1"), /immutable_initial_authority/);
  assert.throws(() => f.database.exec('DELETE FROM canonical_initial_authority WHERE id=1'), /immutable_initial_authority/);
});

test('initialization requires the Cliente 001 Turso worker and an owner session', async t => {
  const f = fixture(t);
  const noSession = await f.post('wrong-token');
  assert.equal(noSession.status, 401);
  const token = await f.activate();
  const session = f.sql('SELECT session_id FROM auth_sessions');
  f.database.prepare("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES (?,'empleado',?,?)")
    .run('session:' + session.session_id, 'owner', '2026-11-19T00:00:00Z');
  assert.equal((await f.post(token)).status, 403);
  f.database.prepare('DELETE FROM pos_device_roles WHERE device_id=?').run('session:' + session.session_id);
  assert.equal((await f.post(token, { ...initialBody, client_id: 'nuevo-amanecer' })).status, 400);
  assert.equal((await f.fetch('/commands/canonical.initialize-empty')).status, 405);
  f.env.TURSO_DATABASE_URL = 'libsql://other.turso.test';
  assert.equal((await f.post(token)).status, 404);
  f.env.TURSO_DATABASE_URL = tursoUrl;
  f.env.RUNTIME_ENVIRONMENT = 'lab';
  assert.equal((await f.post(token)).status, 404);
  f.env.RUNTIME_ENVIRONMENT = 'production';
  f.env.CANONICAL_RUNTIME_ENABLED = 'enabled';
  assert.equal((await f.post(token)).status, 404);
  f.env.CANONICAL_RUNTIME_ENABLED = 'disabled';
  f.env.DB_PROVIDER = 'd1';
  assert.equal((await f.post(token)).status, 404);
  assert.equal(f.control().mode, 'LEGACY');
});

test('an empty operation identity cannot register the initial authority', async t => {
  const f = fixture(t);
  const token = await f.activate();
  assert.equal((await f.post(token, { ...initialBody, operation_id: '   ' })).status, 400);
  assert.equal(f.control().mode, 'LEGACY');
});

test('legacy operational data blocks initialization without deleting the old row', async t => {
  const f = fixture(t);
  const token = await f.activate();
  f.database.prepare(`INSERT INTO sync_operations
    (operation_id,device_id,device_sequence,entity_type,entity_id,payload,payload_hash,created_at)
    VALUES ('old-operation','old-device',1,'product','old-product','{}',?1,'2026-11-19T00:00:00Z')`)
    .run('a'.repeat(64));
  assert.equal((await f.post(token)).status, 409);
  assert.equal(f.control().mode, 'LEGACY');
  assert.equal(f.sql('SELECT COUNT(*) n FROM sync_operations').n, 1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_initial_authority').n, 0);
});

test('an existing source run blocks initialization without erasing it', async t => {
  const f = fixture(t);
  const token = await f.activate();
  const session = f.sql('SELECT session_id FROM auth_sessions');
  f.database.prepare(`INSERT INTO import_runs(import_id,source_hash,manifest_hash,transform_version,device_id,status,source_files,sources_json,row_count,report_json)
    VALUES ('other-source',?1,?2,'existing','session:'||?3,'PASS',1,'[]',0,'{}')`)
    .run('a'.repeat(64), 'b'.repeat(64), session.session_id);
  assert.equal((await f.post(token)).status, 409);
  assert.equal(f.control().mode, 'LEGACY');
  assert.equal(f.sql('SELECT COUNT(*) n FROM import_runs').n, 1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_promotions').n, 0);
});

test('initialization rolls back its source, promotion and authority if a later SQL step fails', async t => {
  const f = fixture(t);
  const token = await f.activate();
  f.database.exec("CREATE TRIGGER test_abort_initial_promotion BEFORE INSERT ON canonical_promotions BEGIN SELECT RAISE(ABORT,'forced_test_failure'); END");
  assert.equal((await f.post(token)).status, 409);
  assert.equal(f.control().mode, 'LEGACY');
  assert.equal(f.sql('SELECT COUNT(*) n FROM import_runs').n, 0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_promotions').n, 0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_initial_authority').n, 0);
  f.database.exec('DROP TRIGGER test_abort_initial_promotion');
  assert.equal((await f.post(token)).status, 201);
});

test('same operation replays one authority receipt while another operation is refused', async t => {
  const f = fixture(t);
  const token = await f.activate();
  const first = await f.post(token);
  assert.equal(first.status, 201, await first.clone().text());
  const firstReceipt = await first.json();
  const retry = await f.post(token);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), firstReceipt);
  assert.equal((await f.post(token, { ...initialBody, operation_id: 'other-initialization' })).status, 409);
  assert.equal((await f.post(token, { ...initialBody, expected_control_revision: 1 })).status, 400);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_initial_authority').n, 1);
  assert.equal(f.control().authority_epoch, 3);
});

test('new empty store can create catalog, sell with stock and cash, then record and pay credit', async t => {
  const f = fixture(t);
  const token = await f.activate();
  const initial = await f.post(token);
  assert.equal(initial.status, 201, await initial.clone().text());
  f.env.CANONICAL_RUNTIME_ENABLED = 'enabled';
  const tab = await device(f, { token });
  const product = await tab.api.createProduct({
    product_id: 'CLIENT001-P1', name: 'Producto nuevo', sku: 'CLIENT001-SKU', barcode: '775000000901',
    alternate_codes: [], category: 'prueba', brand: null, description: null, icon: null, image: null,
    unit: 'unidad', purchase_unit: 'unidad', purchase_factor: 1, cost_cents: 100, price_cents: 250,
    box_price_cents: null, units_per_box: null, initial_stock_quantity: 5, stock_min_quantity: 0,
    expiry_date: null, includes_igv: true, tax_type: 'gravado', complementary_tax: null, tracks_inventory: true,
  });
  assert.equal(product.status, 'created');
  await tab.api.refresh();
  const customer = await tab.api.createCustomer({
    customer_id: 'CLIENT001-C1', name: 'Cliente nuevo', document: '12345678', phone: null, address: null, color: 1,
  });
  assert.equal(customer.status, 'created');
  await tab.api.refresh();
  assert.equal((await tab.api.openCash({ session_id: 'CLIENT001-CAJA', opening_cents: 0 })).status, 'created');
  await tab.api.refresh();
  assert.equal((await tab.api.createSale({
    items: [{ product_id: 'CLIENT001-P1', quantity: 2 }], payment_method: 'efectivo', customer_id: 'CLIENT001-C1',
  })).status, 'created');
  await tab.api.refresh();
  assert.equal(f.sql("SELECT current_stock_quantity n FROM canonical_live_products WHERE product_id='CLIENT001-P1'").n, 3);
  assert.equal(f.sql('SELECT COUNT(*) n FROM cash_movements').n, 1);
  assert.equal(f.sql("SELECT expected_cents n FROM canonical_cash_state WHERE session_id='CLIENT001-CAJA'").n, 500);
  const firstLiveOperation = f.control().first_live_operation_id;
  assert.ok(firstLiveOperation);
  assert.throws(() => f.database.exec('UPDATE canonical_control SET first_live_operation_id=NULL WHERE id=1'), /gate_p_control|immutable_first_live/);
  assert.equal(f.control().first_live_operation_id, firstLiveOperation);
  assert.equal((await tab.api.createCreditAccount({ customer_id: 'CLIENT001-C1', account_id: 'client001-account', name: 'Créditos pequeños', mode: 'accumulated' })).status, 'created');
  await tab.api.refresh();
  assert.equal((await tab.api.createSale({
    items: [{ product_id: 'CLIENT001-P1', quantity: 1 }], payment_method: 'credito', customer_id: 'CLIENT001-C1',
    credit_due: '2099-12-31', credit_account: { account_id: 'client001-account', name: 'Créditos pequeños', mode: 'accumulated' },
  })).status, 'created');
  await tab.api.refresh();
  const credit = f.sql('SELECT credit_id FROM live_credits');
  assert.ok(credit?.credit_id);
  assert.equal((await tab.api.createPayment({ credit_id: credit.credit_id, amount_cents: 100, payment_method: 'yape', reference: 'CLIENT001-PAY-1' })).status, 'created');
  assert.equal(f.sql("SELECT current_balance_cents n FROM canonical_credit_balances WHERE credit_id=?", credit.credit_id).n, 150);
  assert.equal(f.sql("SELECT current_stock_quantity n FROM canonical_live_products WHERE product_id='CLIENT001-P1'").n, 2);
  assert.equal(f.sql('SELECT COUNT(*) n FROM import_staging').n, 0);
});


test('CANON handler accepts a validated session without invoking the read-token gateway', async t => {
  const f = fixture(t);
  const token = await f.activate();
  assert.equal((await f.post(token)).status, 201);
  f.env.CANONICAL_RUNTIME_ENABLED = 'enabled';
  const url = new URL('https://cliente-001.test/read/canonical/status');
  const response = await handleA6(new Request(url, { headers: { authorization: 'Bearer ' + token } }), url, f.env, {
    json: (body, status = 200) => Response.json(body, { status }),
    authorizeSession: async () => ({ posRole: 'owner' }),
    authorizeRead: async () => Response.json({ error: 'unauthorized' }, { status: 401 }),
  });
  assert.equal(response.status, 200);
});

test('real CANON routes accept owner session alone and retain anonymous and revoked-session protection', async t => {
  const f = fixture(t);
  const token = await f.activate();
  assert.equal((await f.post(token)).status, 201);
  const headers = { authorization: 'Bearer ' + token };
  assert.equal((await f.fetch('/read/canonical/status', { headers })).status, 404);
  f.env.CANONICAL_RUNTIME_ENABLED = 'enabled';
  delete f.env.READ_TOKEN;
  assert.equal((await f.fetch('/read/canonical/status', { headers })).status, 200);
  assert.equal((await f.fetch('/read/canonical/snapshot', { headers })).status, 200);
  assert.equal((await f.fetch('/read/canonical/status')).status, 503);
  f.env.READ_TOKEN = 'synthetic-read-token';
  assert.equal((await f.fetch('/read/canonical/status')).status, 401);
  assert.equal((await f.fetch('/read/canonical/status', { headers: { 'x-read-token': f.env.READ_TOKEN } })).status, 200);
  assert.equal((await f.fetch('/read/canonical/status', { headers: { authorization: 'Bearer invalid', 'x-read-token': f.env.READ_TOKEN } })).status, 401);
  f.database.exec("UPDATE auth_sessions SET status='revoked'");
  assert.equal((await f.fetch('/read/canonical/status', { headers })).status, 403);
});

test('employee CANON reads preserve role restrictions with only a session token', async t => {
  const f = fixture(t);
  const token = await f.activate();
  assert.equal((await f.post(token)).status, 201);
  f.env.CANONICAL_RUNTIME_ENABLED = 'enabled';
  delete f.env.READ_TOKEN;
  const session = f.sql('SELECT session_id FROM auth_sessions');
  f.database.prepare("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES (?,'empleado','owner','2026-11-21T00:00:00Z')").run('session:' + session.session_id);
  const headers = { authorization: 'Bearer ' + token };
  assert.equal((await f.fetch('/read/canonical/products', { headers })).status, 200);
  assert.equal((await f.fetch('/read/canonical/expenses', { headers })).status, 403);
  const snapshot = await f.fetch('/read/canonical/snapshot', { headers });
  assert.equal(snapshot.status, 200);
  assert.deepEqual((await snapshot.json()).expenses, []);
});
