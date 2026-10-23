CREATE TABLE IF NOT EXISTS customer_recommendations (
  recommendation_id VARCHAR(80) PRIMARY KEY,
  customer_id VARCHAR(40) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('PROPOSED','ACCEPTED','IN_PROGRESS','COMPLETED','REJECTED','CANCELLED')),
  owner VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_recommendations_customer_status_idx ON customer_recommendations(customer_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS customer_recommendations_status_updated_idx ON customer_recommendations(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS customer_recommendation_audit (
  audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recommendation_id VARCHAR(80) NOT NULL REFERENCES customer_recommendations(recommendation_id),
  status VARCHAR(24) NOT NULL,
  owner VARCHAR(120),
  outcome TEXT,
  actor VARCHAR(120) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_recommendation_audit_idx ON customer_recommendation_audit(recommendation_id,changed_at);
