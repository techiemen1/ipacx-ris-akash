-- 005_schema_enhancements.sql
-- Consolidates all application schema additions into a structured, versioned migration.

ALTER TABLE mwl ADD COLUMN IF NOT EXISTS scheduling_datetime timestamp;
ALTER TABLE mwl ADD COLUMN IF NOT EXISTS status text DEFAULT 'NEW';
ALTER TABLE mwl ADD COLUMN IF NOT EXISTS scheduledstationaetitle text;

ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_host VARCHAR(128);
ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_port INTEGER;
ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_ae_title VARCHAR(64);
ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_type VARCHAR(32);
ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_protocol VARCHAR(16);
ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_calling_ae VARCHAR(64);
ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_called_ae VARCHAR(64);
ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS viewer_protocol VARCHAR(32);
ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS viewer_base_url VARCHAR(256);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS scheduled_station_aetitle text;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS log_date DATE DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')::date;

ALTER TABLE patients ADD COLUMN IF NOT EXISTS outstanding_balance DECIMAL(10, 2) DEFAULT 0.00;
