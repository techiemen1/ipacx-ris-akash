-- Migration 004: Multi-Tenant Hospital/Clinic Scoping, Referring Doctors & AI Auto-Templating Support
SET search_path TO public;

-- 1. Hospitals Table
CREATE TABLE IF NOT EXISTS hospitals (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    logo_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Clinics Table (Branches)
CREATE TABLE IF NOT EXISTS clinics (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    logo_url TEXT,
    header_text TEXT,
    footer_text TEXT,
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE;

-- Seed Default Hospital & Clinic
INSERT INTO hospitals (id, code, name, is_active)
VALUES (1, 'DEFAULT_HOSP', 'Default Healthcare Network', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO clinics (id, hospital_id, code, name, header_text, footer_text, is_active)
VALUES (1, 1, 'MAIN_CLINIC', 'Main Radiology Branch', 'Main Diagnostic Center', 'Serving quality healthcare', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Referring Doctors Table
CREATE TABLE IF NOT EXISTS referring_doctors (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL DEFAULT 1,
    clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL DEFAULT 1,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    mobile VARCHAR(50),
    specialty VARCHAR(100),
    qualification VARCHAR(255),
    clinic_name VARCHAR(255),
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. Add Multi-Tenancy Foreign Keys & Default Values
DO $$
BEGIN
    -- users table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='hospital_id') THEN
        ALTER TABLE users ADD COLUMN hospital_id INTEGER REFERENCES hospitals(id) DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='clinic_id') THEN
        ALTER TABLE users ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) DEFAULT 1;
    END IF;

    -- patients table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='hospital_id') THEN
        ALTER TABLE patients ADD COLUMN hospital_id INTEGER REFERENCES hospitals(id) DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='clinic_id') THEN
        ALTER TABLE patients ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='referring_doctor_id') THEN
        ALTER TABLE patients ADD COLUMN referring_doctor_id INTEGER REFERENCES referring_doctors(id) ON DELETE SET NULL;
    END IF;

    -- studies table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='studies' AND column_name='hospital_id') THEN
        ALTER TABLE studies ADD COLUMN hospital_id INTEGER REFERENCES hospitals(id) DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='studies' AND column_name='clinic_id') THEN
        ALTER TABLE studies ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) DEFAULT 1;
    END IF;

    -- reports table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='hospital_id') THEN
        ALTER TABLE reports ADD COLUMN hospital_id INTEGER REFERENCES hospitals(id) DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='clinic_id') THEN
        ALTER TABLE reports ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='referring_doctor_id') THEN
        ALTER TABLE reports ADD COLUMN referring_doctor_id INTEGER REFERENCES referring_doctors(id) ON DELETE SET NULL;
    END IF;

    -- invoices table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='hospital_id') THEN
        ALTER TABLE invoices ADD COLUMN hospital_id INTEGER REFERENCES hospitals(id) DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='clinic_id') THEN
        ALTER TABLE invoices ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) DEFAULT 1;
    END IF;

    -- mwl table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mwl' AND column_name='hospital_id') THEN
        ALTER TABLE mwl ADD COLUMN hospital_id INTEGER REFERENCES hospitals(id) DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mwl' AND column_name='clinic_id') THEN
        ALTER TABLE mwl ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) DEFAULT 1;
    END IF;

    -- pacs table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pacs' AND column_name='hospital_id') THEN
        ALTER TABLE pacs ADD COLUMN hospital_id INTEGER REFERENCES hospitals(id) DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pacs' AND column_name='clinic_id') THEN
        ALTER TABLE pacs ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) DEFAULT 1;
    END IF;

    -- report_templates table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='report_templates' AND column_name='clinic_id') THEN
        ALTER TABLE report_templates ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) DEFAULT 1;
    END IF;
END $$;

-- 5. Performance Indexes for Scoped Tenant Queries
CREATE INDEX IF NOT EXISTS idx_patients_clinic_id ON patients(clinic_id);
CREATE INDEX IF NOT EXISTS idx_studies_clinic_id ON studies(clinic_id);
CREATE INDEX IF NOT EXISTS idx_reports_clinic_id ON reports(clinic_id);
CREATE INDEX IF NOT EXISTS idx_reports_ref_doctor ON reports(referring_doctor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_clinic_id ON invoices(clinic_id);
CREATE INDEX IF NOT EXISTS idx_mwl_clinic_id ON mwl(clinic_id);
