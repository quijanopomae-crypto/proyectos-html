-- Cliente 001: native, empty-store first authority. No original shop data is imported.
CREATE TABLE IF NOT EXISTS canonical_initial_authority (
  id INTEGER PRIMARY KEY CHECK(id=1),
  client_id TEXT NOT NULL CHECK(client_id='cliente-001'),
  operation_id TEXT NOT NULL UNIQUE CHECK(length(operation_id) BETWEEN 1 AND 160),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  import_id TEXT NOT NULL REFERENCES import_runs(import_id) CHECK(import_id='cliente-001-empty-source'),
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id) CHECK(promotion_id='cliente-001-empty-canon'),
  principal_id TEXT NOT NULL REFERENCES devices(device_id),
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64 AND credential_hash NOT GLOB '*[^0-9a-f]*'),
  base_revision INTEGER NOT NULL CHECK(base_revision=0),
  control_revision INTEGER NOT NULL CHECK(control_revision=3),
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch=3),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TRIGGER IF NOT EXISTS canonical_initial_authority_validate BEFORE INSERT ON canonical_initial_authority
WHEN NOT EXISTS (
  SELECT 1 FROM canonical_control c
  JOIN canonical_promotions p ON p.promotion_id=NEW.promotion_id
  JOIN import_runs r ON r.import_id=NEW.import_id
  JOIN devices d ON d.device_id=NEW.principal_id
  JOIN auth_sessions s ON d.device_id='session:'||s.session_id
  WHERE c.id=1 AND c.mode='CANONICAL_READ_ONLY' AND c.active_promotion_id=NEW.promotion_id
    AND c.revision=2 AND c.authority_epoch=2 AND c.minimum_client_contract='a6-gate-p-v1'
    AND c.writer_device_id=NEW.principal_id AND c.first_live_operation_id IS NULL
    AND p.status='COMMITTED' AND p.import_id=NEW.import_id AND p.device_id=NEW.principal_id
    AND p.control_revision=1 AND p.previous_mode='FROZEN' AND p.previous_promotion_id IS NULL
    AND p.candidate_revision=0 AND p.sealed_revision=0
    AND p.canonical_digest='4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
    AND r.status='PASS' AND r.device_id=NEW.principal_id AND r.row_count=0
    AND NOT EXISTS(SELECT 1 FROM import_staging WHERE import_id=NEW.import_id)
    AND NOT EXISTS(SELECT 1 FROM products WHERE promotion_id=NEW.promotion_id)
    AND NOT EXISTS(SELECT 1 FROM customers WHERE promotion_id=NEW.promotion_id)
    AND NOT EXISTS(SELECT 1 FROM credits WHERE promotion_id=NEW.promotion_id)
    AND NOT EXISTS(SELECT 1 FROM credit_payments WHERE promotion_id=NEW.promotion_id)
    AND NOT EXISTS(SELECT 1 FROM sales)
    AND NOT EXISTS(SELECT 1 FROM canonical_sale_context)
    AND NOT EXISTS(SELECT 1 FROM canonical_financial_operations)
    AND NOT EXISTS(SELECT 1 FROM canonical_product_operations)
    AND NOT EXISTS(SELECT 1 FROM canonical_customer_operations)
    AND d.role='writer' AND d.status='active' AND d.credential_hash=NEW.credential_hash
    AND s.status='active' AND s.token_hash=NEW.credential_hash
    AND NOT EXISTS(SELECT 1 FROM pos_device_roles role WHERE role.device_id=d.device_id AND role.pos_role='empleado')
)
BEGIN SELECT RAISE(ABORT,'invalid_initial_authority'); END;

CREATE TRIGGER IF NOT EXISTS canonical_initial_authority_apply AFTER INSERT ON canonical_initial_authority
BEGIN
  UPDATE canonical_control
     SET mode='ACTIVE', revision=revision+1, authority_epoch=authority_epoch+1,
         minimum_client_contract='a6-gate-c-v1'
   WHERE id=1 AND mode='CANONICAL_READ_ONLY' AND active_promotion_id=NEW.promotion_id
     AND writer_device_id=NEW.principal_id AND revision=2 AND authority_epoch=2;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM canonical_control WHERE id=1 AND mode='ACTIVE'
      AND active_promotion_id=NEW.promotion_id AND revision=NEW.control_revision
      AND authority_epoch=NEW.authority_epoch
  ) THEN RAISE(ABORT,'invalid_initial_authority') END;
END;
CREATE TRIGGER IF NOT EXISTS canonical_initial_authority_no_update BEFORE UPDATE ON canonical_initial_authority
BEGIN SELECT RAISE(ABORT,'immutable_initial_authority'); END;
CREATE TRIGGER IF NOT EXISTS canonical_initial_authority_no_delete BEFORE DELETE ON canonical_initial_authority
BEGIN SELECT RAISE(ABORT,'immutable_initial_authority'); END;

-- Preserve the final Gate C first-live exception from 0017 and add only the
-- committed empty-store authority exception for CANONICAL_READ_ONLY -> ACTIVE.
DROP TRIGGER IF EXISTS canonical_control_no_legacy;

CREATE TRIGGER canonical_control_no_legacy BEFORE UPDATE ON canonical_control
WHEN (NEW.mode='ACTIVE' OR (OLD.mode<>'LEGACY' AND NEW.mode='LEGACY') OR NEW.revision<>OLD.revision+1 OR NEW.authority_epoch<>OLD.authority_epoch+1 OR
  (NEW.mode='CANONICAL_READ_ONLY' AND NOT EXISTS(SELECT 1 FROM canonical_promotions p WHERE p.promotion_id=NEW.active_promotion_id AND p.status='COMMITTED')))
 AND NOT (
  OLD.id=1 AND NEW.id IS OLD.id
  AND OLD.mode='CANONICAL_READ_ONLY' AND NEW.mode='ACTIVE'
  AND OLD.revision=2 AND OLD.authority_epoch=2
  AND NEW.revision=3 AND NEW.authority_epoch=3
  AND OLD.minimum_client_contract='a6-gate-p-v1'
  AND NEW.minimum_client_contract='a6-gate-c-v1'
  AND NEW.active_promotion_id IS OLD.active_promotion_id
  AND NEW.writer_device_id IS OLD.writer_device_id
  AND OLD.first_live_operation_id IS NULL AND NEW.first_live_operation_id IS NULL
  AND EXISTS (
    SELECT 1 FROM canonical_initial_authority a
    JOIN canonical_promotions p ON p.promotion_id=a.promotion_id
    JOIN import_runs r ON r.import_id=a.import_id
    JOIN devices d ON d.device_id=a.principal_id
    JOIN auth_sessions s ON d.device_id='session:'||s.session_id
    WHERE a.id=1 AND a.client_id='cliente-001'
      AND a.promotion_id=OLD.active_promotion_id
      AND a.principal_id=OLD.writer_device_id
      AND a.control_revision=NEW.revision AND a.authority_epoch=NEW.authority_epoch
      AND p.status='COMMITTED' AND p.sealed_revision=0 AND p.candidate_revision=0
      AND p.import_id=r.import_id AND r.status='PASS' AND r.row_count=0
      AND d.role='writer' AND d.status='active' AND d.credential_hash=a.credential_hash
      AND s.status='active' AND s.token_hash=a.credential_hash
      AND NOT EXISTS(SELECT 1 FROM pos_device_roles role WHERE role.device_id=d.device_id AND role.pos_role='empleado')
  )
)
 AND NOT (
  OLD.mode='ACTIVE' AND NEW.mode IS OLD.mode AND NEW.id IS OLD.id
  AND NEW.active_promotion_id IS OLD.active_promotion_id AND NEW.revision IS OLD.revision
  AND NEW.authority_epoch IS OLD.authority_epoch AND NEW.writer_device_id IS OLD.writer_device_id
  AND NEW.minimum_client_contract IS OLD.minimum_client_contract
  AND NEW.first_live_operation_id IS NOT NULL
  AND (OLD.first_live_operation_id IS NULL OR NEW.first_live_operation_id IS OLD.first_live_operation_id)
  AND (EXISTS (
    SELECT 1 FROM canonical_write_guards g
    JOIN sales s ON s.operation_id=g.operation_id AND s.commit_token=g.commit_token
    JOIN canonical_sale_context x ON x.sale_id=s.sale_id AND x.operation_id=g.operation_id
    WHERE g.promotion_id=OLD.active_promotion_id AND g.authority_epoch=OLD.authority_epoch
    AND g.control_revision=OLD.revision AND g.client_contract=OLD.minimum_client_contract
    AND s.device_id=g.principal_id AND g.credential_hash IS NOT NULL
    AND EXISTS(SELECT 1 FROM devices sale_writer WHERE sale_writer.device_id=g.principal_id
      AND sale_writer.role='writer' AND sale_writer.status='active' AND sale_writer.credential_hash=g.credential_hash)
    AND x.promotion_id=g.promotion_id AND x.authority_epoch=g.authority_epoch
    AND x.control_revision=g.control_revision AND x.client_contract=g.client_contract
    AND (OLD.first_live_operation_id IS NOT NULL OR (NEW.first_live_operation_id=g.operation_id
      AND NOT EXISTS(SELECT 1 FROM canonical_sale_context prior WHERE prior.operation_id<>g.operation_id)))
    AND EXISTS(SELECT 1 FROM sale_items i WHERE i.sale_id=s.sale_id AND i.operation_id=g.operation_id)
    AND EXISTS(SELECT 1 FROM cash_movements m WHERE m.sale_id=s.sale_id AND m.operation_id=g.operation_id)
    AND (s.payment_method<>'credito' OR EXISTS(SELECT 1 FROM live_credits l
      WHERE l.sale_id=s.sale_id AND l.operation_id=g.operation_id AND l.promotion_id=g.promotion_id AND l.customer_id=x.customer_id))
  ) OR EXISTS (
    SELECT 1 FROM canonical_write_guards g
    JOIN canonical_financial_operations o ON o.operation_id=g.operation_id
    JOIN devices d ON d.device_id=o.device_id
    WHERE g.promotion_id=OLD.active_promotion_id AND g.authority_epoch=OLD.authority_epoch
    AND g.control_revision=OLD.revision AND g.client_contract=OLD.minimum_client_contract
    AND o.promotion_id=g.promotion_id AND o.authority_epoch=g.authority_epoch
    AND o.control_revision=g.control_revision AND o.client_contract=g.client_contract
    AND o.device_id=g.principal_id AND g.credential_hash=o.credential_hash
    AND d.role='writer' AND d.status='active' AND d.credential_hash=o.credential_hash
    AND (OLD.first_live_operation_id IS NOT NULL OR (NEW.first_live_operation_id=o.operation_id
      AND NOT EXISTS(SELECT 1 FROM canonical_financial_operations prior WHERE prior.operation_id<>o.operation_id)
      AND NOT EXISTS(SELECT 1 FROM canonical_sale_context)))
    AND (
      (o.command='cash.open' AND EXISTS(SELECT 1 FROM canonical_cash_sessions s
        WHERE s.open_operation_id=o.operation_id AND s.promotion_id=o.promotion_id
        AND s.session_id=json_extract(o.result_json,'$.session_id') AND s.opening_cents=json_extract(o.result_json,'$.expected_cents')))
      OR (o.command='cash.close' AND EXISTS(SELECT 1 FROM canonical_cash_closures c JOIN canonical_cash_sessions s ON s.session_id=c.session_id
        WHERE c.close_operation_id=o.operation_id AND s.promotion_id=o.promotion_id
        AND c.session_id=json_extract(o.result_json,'$.session_id') AND c.expected_cents=json_extract(o.result_json,'$.expected_cents')
        AND c.counted_cents=json_extract(o.result_json,'$.counted_cents') AND c.difference_cents=json_extract(o.result_json,'$.difference_cents')))
      OR (o.command IN ('payment.create','adjustment.create','compensation.create') AND EXISTS(SELECT 1 FROM canonical_financial_events e
        WHERE e.operation_id=o.operation_id AND e.promotion_id=o.promotion_id
        AND e.event_type=CASE o.command WHEN 'payment.create' THEN 'PAYMENT' WHEN 'adjustment.create' THEN 'ADJUSTMENT' ELSE 'COMPENSATION' END
        AND e.event_id=json_extract(o.result_json,'$.event_id')
        AND e.credit_delta_cents=json_extract(o.result_json,'$.credit_delta_cents') AND e.cash_delta_cents=json_extract(o.result_json,'$.cash_delta_cents')
        AND e.credit_id IS json_extract(o.result_json,'$.credit_id') AND e.session_id IS json_extract(o.result_json,'$.session_id')))
    )
  ) OR EXISTS (
    SELECT 1 FROM canonical_write_guards g
    JOIN canonical_expense_operations o ON o.operation_id=g.operation_id
    JOIN canonical_expenses e ON e.operation_id=o.operation_id AND e.promotion_id=o.promotion_id
    JOIN devices d ON d.device_id=o.device_id
    WHERE g.promotion_id=OLD.active_promotion_id AND g.authority_epoch=OLD.authority_epoch
    AND g.control_revision=OLD.revision AND g.client_contract=OLD.minimum_client_contract
    AND o.promotion_id=g.promotion_id AND o.authority_epoch=g.authority_epoch
    AND o.control_revision=g.control_revision AND o.client_contract=g.client_contract
    AND o.device_id=g.principal_id AND g.credential_hash=o.credential_hash
    AND d.role='writer' AND d.status='active' AND d.credential_hash=o.credential_hash
    AND (OLD.first_live_operation_id IS NOT NULL OR (NEW.first_live_operation_id=o.operation_id
      AND NOT EXISTS(SELECT 1 FROM canonical_sale_context)
      AND NOT EXISTS(SELECT 1 FROM canonical_financial_operations)
      AND NOT EXISTS(SELECT 1 FROM canonical_expense_operations prior WHERE prior.operation_id<>o.operation_id)))
    AND e.expense_id=json_extract(o.result_json,'$.expense_id')
    AND e.session_id IS json_extract(o.result_json,'$.session_id')
    AND e.cash_delta_cents=json_extract(o.result_json,'$.cash_delta_cents')
  ))
 )
BEGIN SELECT RAISE(ABORT,'gate_p_control'); END;
