CREATE TABLE IF NOT EXISTS privacy_requests (
  id BIGSERIAL PRIMARY KEY,
  request_type TEXT NOT NULL CHECK (request_type IN ('ACCESS', 'ERASURE', 'RECTIFICATION')),
  patient_identifier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'APPROVED', 'REJECTED', 'COMPLETED')),
  reason TEXT,
  requested_by TEXT,
  reviewed_by TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests(status);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_patient_identifier ON privacy_requests(patient_identifier);
