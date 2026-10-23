CREATE TABLE IF NOT EXISTS fraud_investigations (
  alert_id VARCHAR(80) PRIMARY KEY,
  customer_ids JSONB NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('NEW','UNDER_REVIEW','ESCALATED','CLOSED_NO_FRAUD','CONFIRMED_FRAUD')),
  assigned_to VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS fraud_investigations_status_idx ON fraud_investigations(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS fraud_investigation_audit (
  audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id VARCHAR(80) NOT NULL REFERENCES fraud_investigations(alert_id),
  status VARCHAR(24) NOT NULL,
  assigned_to VARCHAR(120),
  decision_note TEXT,
  actor VARCHAR(120) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS fraud_investigation_audit_alert_idx ON fraud_investigation_audit(alert_id, changed_at);
