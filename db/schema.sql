-- Canonical schema for fresh databases, including gold purchases.
PRAGMA foreign_keys = ON;

CREATE TABLE app_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  dataset_epoch TEXT NOT NULL
);

INSERT INTO
  app_meta
VALUES
  (1, 0, lower(hex(randomblob(16))));

CREATE TABLE mutation_context (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  operation_id TEXT,
  kind TEXT NOT NULL DEFAULT 'opening',
  transaction_id TEXT,
  restore INTEGER NOT NULL DEFAULT 0 CHECK (restore IN (0, 1)),
  now TEXT
);

INSERT INTO
  mutation_context (id)
VALUES
  (1);

CREATE TABLE assertions (code TEXT NOT NULL);

CREATE TRIGGER assert_version BEFORE INSERT ON assertions WHEN NEW.code = 'VERSION_CONFLICT' BEGIN
SELECT
  RAISE (ABORT, 'VERSION_CONFLICT');

END;

CREATE TRIGGER assert_epoch BEFORE INSERT ON assertions WHEN NEW.code = 'DATASET_CONFLICT' BEGIN
SELECT
  RAISE (ABORT, 'DATASET_CONFLICT');

END;

CREATE TRIGGER assert_revision BEFORE INSERT ON assertions WHEN NEW.code = 'SNAPSHOT_CONFLICT' BEGIN
SELECT
  RAISE (ABORT, 'SNAPSHOT_CONFLICT');

END;

CREATE TRIGGER assert_missing_cash BEFORE INSERT ON assertions WHEN NEW.code = 'CASH_ACCOUNT_NOT_FOUND' BEGIN
SELECT
  RAISE (ABORT, 'CASH_ACCOUNT_NOT_FOUND');

END;

CREATE TRIGGER assert_missing_tx BEFORE INSERT ON assertions WHEN NEW.code = 'TRANSACTION_NOT_FOUND' BEGIN
SELECT
  RAISE (ABORT, 'TRANSACTION_NOT_FOUND');

END;

CREATE TRIGGER assert_limit BEFORE INSERT ON assertions WHEN NEW.code = 'AMOUNT_LIMIT' BEGIN
SELECT
  RAISE (ABORT, 'AMOUNT_LIMIT');

END;

CREATE TRIGGER assert_restore BEFORE INSERT ON assertions WHEN NEW.code = 'RESTORE_MISMATCH' BEGIN
SELECT
  RAISE (ABORT, 'RESTORE_MISMATCH');

END;

CREATE TRIGGER assert_ok BEFORE INSERT ON assertions WHEN NEW.code = 'OK' BEGIN
SELECT
  RAISE (IGNORE);

END;

CREATE TABLE cash_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  currency TEXT NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
  balance_satang INTEGER NOT NULL CHECK (
    typeof(balance_satang) = 'integer'
    AND balance_satang BETWEEN 0 AND 9007199254740991
  ),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('stock', 'fund', 'btc', 'gold')),
  asset_name TEXT NOT NULL CHECK (length(trim(asset_name)) BETWEEN 1 AND 80),
  trade_date TEXT NOT NULL CHECK (
    length(trade_date) = 10
    AND date(trade_date, '+0 days') IS NOT NULL
    AND date(trade_date, '+0 days') = trade_date
  ),
  amount_satang INTEGER NOT NULL CHECK (
    typeof(amount_satang) = 'integer'
    AND amount_satang BETWEEN 1 AND 100000000000
  ),
  btc_satoshis INTEGER CHECK (
    btc_satoshis IS NULL
    OR (
      typeof(btc_satoshis) = 'integer'
      AND btc_satoshis BETWEEN 1 AND 2100000000000000
    )
  ),
  cash_account_id TEXT REFERENCES cash_accounts (id) ON DELETE RESTRICT,
  note TEXT CHECK (
    note IS NULL
    OR length(note) <= 500
  ),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (
      asset_type = 'btc'
      AND btc_satoshis IS NOT NULL
    )
    OR (
      asset_type != 'btc'
      AND btc_satoshis IS NULL
    )
  )
);

CREATE INDEX transactions_date ON transactions (trade_date DESC, id DESC);

CREATE INDEX transactions_type_date ON transactions (asset_type, trade_date DESC, id DESC);

CREATE INDEX transactions_cash ON transactions (cash_account_id);

CREATE TABLE btc_goal (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  target_satoshis INTEGER CHECK (
    target_satoshis IS NULL
    OR (
      typeof(target_satoshis) = 'integer'
      AND target_satoshis BETWEEN 1 AND 2100000000000000
    )
  ),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

INSERT INTO
  btc_goal
VALUES
  (1, NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE cash_balance_events (
  id TEXT PRIMARY KEY,
  cash_account_id TEXT NOT NULL REFERENCES cash_accounts (id),
  kind TEXT NOT NULL CHECK (
    kind IN (
      'opening',
      'manual_add',
      'manual_subtract',
      'manual_set',
      'purchase_debit',
      'purchase_refund'
    )
  ),
  delta_satang INTEGER NOT NULL,
  balance_after_satang INTEGER NOT NULL CHECK (balance_after_satang >= 0),
  transaction_id TEXT,
  operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX cash_events_account ON cash_balance_events (cash_account_id, created_at);

CREATE TABLE mutation_requests (
  idempotency_key TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER cash_context_insert BEFORE INSERT ON cash_accounts WHEN (
  SELECT
    operation_id
  FROM
    mutation_context
  WHERE
    id = 1
) IS NULL BEGIN
SELECT
  RAISE (ABORT, 'MUTATION_CONTEXT_REQUIRED');

END;

CREATE TRIGGER cash_context_update BEFORE
UPDATE ON cash_accounts WHEN (
  SELECT
    operation_id
  FROM
    mutation_context
  WHERE
    id = 1
) IS NULL BEGIN
SELECT
  RAISE (ABORT, 'MUTATION_CONTEXT_REQUIRED');

END;

CREATE TRIGGER cash_open AFTER INSERT ON cash_accounts BEGIN
INSERT INTO
  cash_balance_events
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  NEW.id,
  'opening',
  NEW.balance_satang,
  NEW.balance_satang,
  NULL,
  operation_id,
  now
FROM
  mutation_context
WHERE
  id = 1;

END;

CREATE TRIGGER cash_audit AFTER
UPDATE OF balance_satang ON cash_accounts BEGIN
INSERT INTO
  cash_balance_events
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  NEW.id,
  kind,
  NEW.balance_satang - OLD.balance_satang,
  NEW.balance_satang,
  transaction_id,
  operation_id,
  now
FROM
  mutation_context
WHERE
  id = 1;

END;

CREATE TRIGGER tx_context_insert BEFORE INSERT ON transactions WHEN (
  SELECT
    operation_id
  FROM
    mutation_context
  WHERE
    id = 1
) IS NULL BEGIN
SELECT
  RAISE (ABORT, 'MUTATION_CONTEXT_REQUIRED');

END;

CREATE TRIGGER tx_context_update BEFORE
UPDATE ON transactions WHEN (
  SELECT
    operation_id
  FROM
    mutation_context
  WHERE
    id = 1
) IS NULL BEGIN
SELECT
  RAISE (ABORT, 'MUTATION_CONTEXT_REQUIRED');

END;

CREATE TRIGGER tx_context_delete BEFORE DELETE ON transactions WHEN (
  SELECT
    operation_id
  FROM
    mutation_context
  WHERE
    id = 1
) IS NULL BEGIN
SELECT
  RAISE (ABORT, 'MUTATION_CONTEXT_REQUIRED');

END;

CREATE TRIGGER purchase_insert AFTER INSERT ON transactions WHEN (
  SELECT
    restore
  FROM
    mutation_context
  WHERE
    id = 1
) = 0 BEGIN
UPDATE mutation_context
SET
  kind = 'purchase_debit',
  transaction_id = NEW.id
WHERE
  id = 1;

UPDATE cash_accounts
SET
  balance_satang = balance_satang - NEW.amount_satang,
  version = version + 1,
  updated_at = (
    SELECT
      now
    FROM
      mutation_context
    WHERE
      id = 1
  )
WHERE
  id = NEW.cash_account_id;

END;

CREATE TRIGGER purchase_update AFTER
UPDATE ON transactions WHEN (
  SELECT
    restore
  FROM
    mutation_context
  WHERE
    id = 1
) = 0 BEGIN
UPDATE mutation_context
SET
  kind = 'purchase_refund',
  transaction_id = OLD.id
WHERE
  id = 1;

UPDATE cash_accounts
SET
  balance_satang = balance_satang + OLD.amount_satang,
  version = version + 1,
  updated_at = (
    SELECT
      now
    FROM
      mutation_context
    WHERE
      id = 1
  )
WHERE
  id = OLD.cash_account_id;

UPDATE mutation_context
SET
  kind = 'purchase_debit',
  transaction_id = NEW.id
WHERE
  id = 1;

UPDATE cash_accounts
SET
  balance_satang = balance_satang - NEW.amount_satang,
  version = version + 1,
  updated_at = (
    SELECT
      now
    FROM
      mutation_context
    WHERE
      id = 1
  )
WHERE
  id = NEW.cash_account_id;

END;

CREATE TRIGGER purchase_delete AFTER DELETE ON transactions WHEN (
  SELECT
    restore
  FROM
    mutation_context
  WHERE
    id = 1
) = 0 BEGIN
UPDATE mutation_context
SET
  kind = 'purchase_refund',
  transaction_id = OLD.id
WHERE
  id = 1;

UPDATE cash_accounts
SET
  balance_satang = balance_satang + OLD.amount_satang,
  version = version + 1,
  updated_at = (
    SELECT
      now
    FROM
      mutation_context
    WHERE
      id = 1
  )
WHERE
  id = OLD.cash_account_id;

END;
