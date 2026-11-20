import { buildManifest, sha256Hex, stableStringify } from './a5-import-core.js';
import { A6_MAPPING_VERSION, A6_SCHEMA_VERSION, a6PolicyHash } from './a6-mapping.js';
import { getDatabase } from './database-binding.js';

const CLIENT_ID = 'cliente-001';
const TURSO_URL = 'libsql://cliente-001-pos-db-cr-cristian.aws-sa-east-1.turso.io';
const IMPORT_ID = 'cliente-001-empty-source';
const PROMOTION_ID = 'cliente-001-empty-canon';
const MIGRATION = '0037_canonical_empty_bootstrap.sql';
const EMPTY_SOURCE = '[]';
const EXEMPT_TABLES = new Set(['__cliente001_schema_migrations', 'auth_sessions', 'devices', 'canonical_control']);
const REQUIRED_TABLES = [
  '__cliente001_schema_migrations', 'auth_sessions', 'devices', 'canonical_control',
  'canonical_assertions', 'canonical_promotions', 'canonical_initial_authority', 'import_runs',
];
const ID = /^[^\x00-\x1f\x7f]{1,160}$/;

export function client001InitializationAvailable(env) {
  return env?.RUNTIME_ENVIRONMENT === 'production'
    && env?.DB_PROVIDER === 'turso'
    && String(env?.TURSO_DATABASE_URL || '').trim() === TURSO_URL
    && env?.CANONICAL_RUNTIME_ENABLED === 'disabled';
}

export async function initializeEmptyCanon(request, env, auth, json) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join(',') !== 'client_id,expected_control_revision,operation_id'
    || body.client_id !== CLIENT_ID || typeof body.operation_id !== 'string'
    || !body.operation_id.trim() || !ID.test(body.operation_id) || body.expected_control_revision !== 0) {
    return json({ error: 'invalid_initialization_request' }, 400);
  }
  if (auth.posRole !== 'owner') return json({ error: 'forbidden_role' }, 403);

  const db = getDatabase(env);
  const schema = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const names = (schema.results || []).map(row => String(row.name));
  if (REQUIRED_TABLES.some(name => !names.includes(name))) return json({ error: 'initialization_schema_missing' }, 503);
  if (names.some(name => !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name))) return json({ error: 'initialization_schema_unexpected' }, 409);

  const requestHash = await sha256Hex(stableStringify(body));
  const existing = await db.prepare('SELECT operation_id,request_hash,result_json FROM canonical_initial_authority WHERE id=1').first();
  if (existing) {
    if (existing.operation_id === body.operation_id && existing.request_hash === requestHash) {
      return json(JSON.parse(existing.result_json), 200);
    }
    return json({ error: 'already_initialized' }, 409);
  }

  // One generated JSON source with zero rows satisfies the existing promotion
  // foreign keys. It contains no Nuevo Amanecer records.
  const source = { name: 'cliente-001-empty.json', type: 'POS_JSON',
    sha256: await sha256Hex(EMPTY_SOURCE), bytes: 2 };
  const manifest = await buildManifest({ importId: IMPORT_ID, sources: [source], rows: [] });
  if (manifest.report.verdict !== 'PASS' || manifest.rows.length !== 0) {
    return json({ error: 'empty_source_invalid' }, 503);
  }
  const digest = await sha256Hex('[]');
  const operationalManifest = stableStringify({
    kind: 'cliente-001-empty-canon-v1', client_id: CLIENT_ID, import_id: IMPORT_ID,
    source_hash: manifest.source_hash, manifest_hash: manifest.manifest_hash,
    rows: 0, imported_from_nuevo_amanecer: false,
  });
  const promotionResult = stableStringify({
    status: 'COMMITTED', mode: 'CANONICAL_READ_ONLY', promotion_id: PROMOTION_ID,
    canonical_digest: digest, counts: { products: 0, customers: 0, credits: 0, credit_payments: 0 },
    revision: 2, authority_epoch: 2,
  });
  const receipt = {
    status: 'initialized', client_id: CLIENT_ID, operation_id: body.operation_id,
    promotion_id: PROMOTION_ID, mode: 'ACTIVE', revision: 3, authority_epoch: 3,
    minimum_client_contract: 'a6-gate-c-v1',
  };
  const receiptJson = stableStringify(receipt);
  const emptyTables = names.filter(name => !EXEMPT_TABLES.has(name));
  const emptyPredicate = emptyTables.map(name => `NOT EXISTS(SELECT 1 FROM "${name}")`).join(' AND ');
  const assertion = 'client001:init:' + body.operation_id;
  const complete = assertion + ':complete';
  const statements = [
    db.prepare(`INSERT INTO canonical_assertions(assertion_id,ok)
      SELECT ?1,CASE WHEN EXISTS(
        SELECT 1 FROM canonical_control c
        JOIN devices d ON d.device_id=?2
        JOIN auth_sessions s ON d.device_id='session:'||s.session_id
        WHERE c.id=1 AND c.mode='LEGACY' AND c.active_promotion_id IS NULL
          AND c.revision=0 AND c.authority_epoch=0 AND c.writer_device_id IS NULL
          AND c.first_live_operation_id IS NULL AND c.minimum_client_contract='a6-gate-p-v1'
          AND d.role='writer' AND d.status='active' AND d.credential_hash=?3
          AND s.status='active' AND s.token_hash=?3
          AND NOT EXISTS(SELECT 1 FROM pos_device_roles role
            WHERE role.device_id=d.device_id AND role.pos_role='empleado')
      ) AND (SELECT COUNT(*) FROM __cliente001_schema_migrations)=37
        AND EXISTS(SELECT 1 FROM __cliente001_schema_migrations WHERE name=?4)
        AND ${emptyPredicate} THEN 1 ELSE 0 END`)
      .bind(assertion, auth.principalId, auth.credentialHash, MIGRATION),
    db.prepare(`INSERT INTO import_runs
      (import_id,source_hash,manifest_hash,transform_version,device_id,status,source_files,sources_json,row_count,report_json)
      VALUES (?1,?2,?3,?4,?5,'PASS',1,?6,0,?7)`)
      .bind(IMPORT_ID, manifest.source_hash, manifest.manifest_hash, manifest.transform_version,
        auth.principalId, stableStringify(manifest.sources), stableStringify(manifest.report)),
    db.prepare(`UPDATE canonical_control
      SET mode='FROZEN',revision=revision+1,authority_epoch=authority_epoch+1,writer_device_id=?1
      WHERE id=1 AND mode='LEGACY' AND revision=0 AND authority_epoch=0`)
      .bind(auth.principalId),
    db.prepare(`INSERT INTO canonical_promotions
      (promotion_id,operation_id,request_hash,import_id,source_hash,manifest_hash,transform_version,
       staging_revision,mapping_version,schema_version,policy_hash,control_revision,
       operational_manifest_json,operational_manifest_hash,device_id,status,previous_mode)
      VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8,?9,?10,1,?11,?12,?13,'PREPARED','FROZEN')`)
      .bind(PROMOTION_ID, body.operation_id, requestHash, IMPORT_ID, manifest.source_hash,
        manifest.manifest_hash, manifest.transform_version, A6_MAPPING_VERSION, A6_SCHEMA_VERSION,
        await a6PolicyHash(), operationalManifest, await sha256Hex(operationalManifest), auth.principalId),
    db.prepare(`UPDATE canonical_promotions
      SET status='COMMITTED',sealed_revision=candidate_revision,canonical_digest=?1,
          result_json=?2,committed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE promotion_id=?3 AND status='PREPARED' AND candidate_revision=0 AND sealed_revision IS NULL`)
      .bind(digest, promotionResult, PROMOTION_ID),
    db.prepare(`UPDATE canonical_control
      SET mode='CANONICAL_READ_ONLY',active_promotion_id=?1,revision=revision+1,authority_epoch=authority_epoch+1
      WHERE id=1 AND mode='FROZEN' AND revision=1 AND authority_epoch=1
        AND EXISTS(SELECT 1 FROM canonical_promotions WHERE promotion_id=?1 AND status='COMMITTED')`)
      .bind(PROMOTION_ID),
    // Migration 0037 validates this authority record and applies the final
    // READ_ONLY -> ACTIVE transition in its own trigger.
    db.prepare(`INSERT INTO canonical_initial_authority
      (id,client_id,operation_id,request_hash,import_id,promotion_id,principal_id,credential_hash,
       base_revision,control_revision,authority_epoch,result_json)
      VALUES (1,'cliente-001',?1,?2,?3,?4,?5,?6,0,3,3,?7)`)
      .bind(body.operation_id, requestHash, IMPORT_ID, PROMOTION_ID,
        auth.principalId, auth.credentialHash, receiptJson),
    db.prepare(`INSERT INTO canonical_assertions(assertion_id,ok)
      SELECT ?1,CASE WHEN EXISTS(
        SELECT 1 FROM canonical_control c JOIN canonical_initial_authority a ON a.id=c.id
        WHERE c.id=1 AND c.mode='ACTIVE' AND c.active_promotion_id=?2
          AND c.revision=3 AND c.authority_epoch=3 AND c.minimum_client_contract='a6-gate-c-v1'
          AND a.operation_id=?3 AND a.request_hash=?4 AND a.principal_id=?5
      ) THEN 1 ELSE 0 END`)
      .bind(complete, PROMOTION_ID, body.operation_id, requestHash, auth.principalId),
    db.prepare('DELETE FROM canonical_assertions WHERE assertion_id IN (?1,?2)').bind(assertion, complete),
  ];
  try { await db.batch(statements); }
  catch {
    const replay = await db.prepare('SELECT operation_id,request_hash,result_json FROM canonical_initial_authority WHERE id=1').first();
    if (replay?.operation_id === body.operation_id && replay.request_hash === requestHash) {
      return json(JSON.parse(replay.result_json), 200);
    }
    return json({ error: 'initialization_conflict' }, 409);
  }
  const saved = await db.prepare('SELECT result_json FROM canonical_initial_authority WHERE id=1').first();
  return json(JSON.parse(saved.result_json), 201);
}
