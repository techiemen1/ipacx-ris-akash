-- iPacx RIS/PACS v1.1 - Comprehensive Schema
SET search_path TO public;

-- 1. Users & Profiles
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) DEFAULT 'USER',
    full_name VARCHAR(100),
    email VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Default Admin: admin / admin123
INSERT INTO users (username, password_hash, role)
VALUES ('admin', '$2b$10$Bg9X1wb/bbdeiUL9U4qT2eSsYSEUNn/3LIrBhO5YyIDB9AGTeev0a', 'ADMIN')
ON CONFLICT (username) DO NOTHING;

-- 2. Patients
CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    patient_id VARCHAR(64) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    gender VARCHAR(20),
    dob DATE,
    age VARCHAR(20),
    mobile VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. Modalities & Body Parts
CREATE TABLE IF NOT EXISTS modalities (
    id SERIAL PRIMARY KEY,
    code VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS body_parts (
    id SERIAL PRIMARY KEY,
    modality_id INTEGER REFERENCES modalities(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(modality_id, name)
);

-- 4. PACS & Sync
CREATE TABLE IF NOT EXISTS studies (
    id SERIAL PRIMARY KEY,
    study_uid TEXT UNIQUE NOT NULL,
    patient_id TEXT,
    patient_name TEXT,
    patient_sex TEXT,
    patient_age TEXT,
    accession_number TEXT,
    study_date TEXT,
    study_time TEXT,
    study_description TEXT,
    modality TEXT,
    instances INTEGER DEFAULT 0,
    source TEXT DEFAULT 'PACS',
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Reporting
CREATE TABLE IF NOT EXISTS reporters (
    id SERIAL PRIMARY KEY,
    title VARCHAR(20),
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE,
    qualification VARCHAR(255),
    signature_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_templates (
    id SERIAL PRIMARY KEY,
    template_name VARCHAR(255),
    modality VARCHAR(50),
    body_part VARCHAR(100),
    template_type VARCHAR(50) DEFAULT 'plain',
    content JSONB NOT NULL,
    created_by INTEGER,
    created_by_role VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    study_uid TEXT NOT NULL,
    accession_number TEXT,
    patient_id TEXT,
    patient_name TEXT,
    modality TEXT,
    body_part TEXT,
    report_title TEXT,
    referring_doctor TEXT,
    report_content JSONB NOT NULL,
    reported_by TEXT,
    reported_by_signature JSONB,
    approved_by TEXT,
    approved_by_signature JSONB,
    status TEXT DEFAULT 'Draft' CHECK (status IN ('Draft', 'Final', 'Addendum')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_images (
    id SERIAL PRIMARY KEY,
    report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
    image_path TEXT NOT NULL,
    image_type VARCHAR(50),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_addendums (
    id SERIAL PRIMARY KEY,
    report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
    study_uid TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 6. PACS & MWL Configuration
CREATE TABLE IF NOT EXISTS pacs (
    id SERIAL PRIMARY KEY,
    pacs_name VARCHAR(100) UNIQUE NOT NULL,
    pacs_type VARCHAR(50) DEFAULT 'orthanc',
    ip_address VARCHAR(100),
    port INTEGER,
    ae_title VARCHAR(50) UNIQUE,
    username VARCHAR(100),
    password VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO pacs (pacs_name, pacs_type, ip_address, port, ae_title)
VALUES ('MWL_SERVER', 'orthanc', 'orthanc', 11118, 'MWL_SERVER')
ON CONFLICT (pacs_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS mwl (
    id SERIAL PRIMARY KEY,
    patientid VARCHAR(50) NOT NULL,
    patientname VARCHAR(255) NOT NULL,
    patientsex VARCHAR(10),
    patientage VARCHAR(20),
    accessionnumber VARCHAR(50),
    studydescription VARCHAR(255),
    schedulingdate DATE,
    scheduling_datetime TIMESTAMP,
    modality VARCHAR(50),
    bodypartexamined VARCHAR(50),
    referringphysician VARCHAR(100),
    status TEXT DEFAULT 'NEW'
);

CREATE TABLE IF NOT EXISTS mwl_modality_targets (
    id SERIAL PRIMARY KEY,
    modality_code VARCHAR(16) NOT NULL UNIQUE,
    pacs_id INTEGER REFERENCES pacs(id) ON DELETE SET NULL,
    orthanc_modality_name VARCHAR(64),
    manual_host VARCHAR(128),
    manual_port INTEGER,
    manual_ae_title VARCHAR(64),
    manual_type VARCHAR(32),
    manual_protocol VARCHAR(16),
    manual_calling_ae VARCHAR(64),
    manual_called_ae VARCHAR(64),
    viewer_protocol VARCHAR(32),
    viewer_base_url VARCHAR(256),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mwl_settings (
    id INTEGER PRIMARY KEY,
    key VARCHAR(100) UNIQUE,
    value TEXT,
    autopush_enabled BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO mwl_settings (id, autopush_enabled) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

-- 7. Billing
CREATE TABLE IF NOT EXISTS test_prices (
    id SERIAL PRIMARY KEY,
    modality VARCHAR(50) NOT NULL,
    body_part VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) DEFAULT 0.00,
    gst_percent DECIMAL(5,2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    patient_id VARCHAR(64) NOT NULL,
    total_amount DECIMAL(10,2) DEFAULT 0.00,
    discount_amount DECIMAL(10,2) DEFAULT 0.00,
    tax_amount DECIMAL(10,2) DEFAULT 0.00,
    grand_total DECIMAL(10,2) DEFAULT 0.00,
    payment_status VARCHAR(20) DEFAULT 'PAID',
    payment_method VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT,
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(10,2) DEFAULT 0.00,
    tax_amount DECIMAL(10,2) DEFAULT 0.00,
    total_amount DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 8. Audit & Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT,
    username TEXT,
    role TEXT,
    event TEXT NOT NULL,
    page TEXT,
    details JSONB,
    ip_address TEXT,
    user_agent TEXT,
    log_date DATE DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')::date,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log_archives (
    id BIGSERIAL PRIMARY KEY,
    log_date DATE NOT NULL UNIQUE,
    file_path TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    archived_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Performance indexes for high-volume worklist, reporting, and audit queries.
CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at);
CREATE INDEX IF NOT EXISTS idx_patients_full_name ON patients(full_name);
CREATE INDEX IF NOT EXISTS idx_studies_study_date ON studies(study_date);
CREATE INDEX IF NOT EXISTS idx_studies_modality ON studies(modality);
CREATE INDEX IF NOT EXISTS idx_studies_patient_id ON studies(patient_id);
CREATE INDEX IF NOT EXISTS idx_reports_study_uid ON reports(study_uid);
CREATE INDEX IF NOT EXISTS idx_reports_patient_id ON reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_pacs_is_active ON pacs(is_active);
CREATE INDEX IF NOT EXISTS idx_mwl_schedulingdate ON mwl(schedulingdate);
CREATE INDEX IF NOT EXISTS idx_mwl_modality ON mwl(modality);
CREATE INDEX IF NOT EXISTS idx_audit_logs_log_date ON audit_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs(event);
