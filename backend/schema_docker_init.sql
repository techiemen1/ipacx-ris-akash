-- iPacx RIS/PACS Master Complete Database Schema
SET search_path TO public;

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) DEFAULT 'USER',
    title VARCHAR(20),
    full_name VARCHAR(100),
    email VARCHAR(100),
    qualification VARCHAR(255),
    designation VARCHAR(255),
    registration_number VARCHAR(100),
    signature_url TEXT,
    assigned_clinics TEXT[] DEFAULT '{"ALL"}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Ensure all columns exist on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS title VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS qualification VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS designation VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_clinics TEXT[] DEFAULT '{"ALL"}';

-- Default Admin (admin / admin123)
INSERT INTO users (username, password_hash, role, is_active)
VALUES ('admin', '$2b$10$Bg9X1wb/bbdeiUL9U4qT2eSsYSEUNn/3LIrBhO5YyIDB9AGTeev0a', 'ADMIN', true)
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true;

-- 2. Clinics & Hospitals
CREATE TABLE IF NOT EXISTS clinics (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    ae_title VARCHAR(100),
    institution_name VARCHAR(255),
    address TEXT,
    phone VARCHAR(50),
    header_text TEXT,
    footer_text TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO clinics (code, name, ae_title, institution_name, is_active)
VALUES ('MAIN', 'Main Diagnostic Center', 'IPACX_MAIN', 'iPACX Hospital Network', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS hospitals (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    logo_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO hospitals (code, name, is_active)
VALUES ('MAIN', 'Main Hospital Network', true)
ON CONFLICT (code) DO NOTHING;

-- 3. Referring Doctors
CREATE TABLE IF NOT EXISTS referring_doctors (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    specialty VARCHAR(100),
    qualification VARCHAR(100),
    clinic_name VARCHAR(255),
    hospital_name VARCHAR(255),
    mobile VARCHAR(20),
    contact_number VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    clinic_id INT DEFAULT 1,
    hospital_id INT DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Patients
CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    uhid VARCHAR(64) UNIQUE,
    patient_id VARCHAR(64) UNIQUE,
    mrn VARCHAR(64),
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    gender VARCHAR(20),
    dob DATE,
    age VARCHAR(20),
    mobile VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    address_line1 TEXT,
    city VARCHAR(100),
    district VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(20),
    id_type VARCHAR(50),
    id_number VARCHAR(100),
    biometric_flag BOOLEAN DEFAULT false,
    id_proof_path TEXT,
    id_proof TEXT,
    patient_type VARCHAR(50),
    clinical_history TEXT,
    provisional_diagnosis TEXT,
    data_privacy_accepted BOOLEAN DEFAULT false,
    consent_signed BOOLEAN DEFAULT false,
    consent_image_sharing BOOLEAN DEFAULT false,
    consent_telemedicine BOOLEAN DEFAULT false,
    digital_signature TEXT,
    signature_file TEXT,
    photo_url TEXT,
    referring_doctor VARCHAR(255),
    attending_physician VARCHAR(255),
    visit_type VARCHAR(50),
    modality VARCHAR(50),
    study_type VARCHAR(100),
    study VARCHAR(100),
    contrast BOOLEAN DEFAULT false,
    urgency VARCHAR(20),
    billing_type VARCHAR(50),
    insurance_id VARCHAR(100),
    abha_number VARCHAR(100),
    abha_address VARCHAR(100),
    voter_id VARCHAR(100),
    registration_channel VARCHAR(50),
    title VARCHAR(20),
    relationship_type VARCHAR(50),
    relationship_name VARCHAR(100),
    marital_status VARCHAR(20),
    occupation TEXT,
    nationality VARCHAR(50),
    language_preference VARCHAR(50),
    emergency_contact_name VARCHAR(100),
    emergency_contact_phone VARCHAR(20),
    emergency_contact_relation VARCHAR(50),
    secondary_contact_name VARCHAR(100),
    secondary_contact_phone VARCHAR(20),
    blood_group VARCHAR(10),
    height_cm VARCHAR(10),
    weight_kg VARCHAR(10),
    allergies TEXT,
    current_medications TEXT,
    medical_history TEXT,
    is_pregnant BOOLEAN DEFAULT false,
    menstrual_status VARCHAR(50),
    lmp_date DATE,
    edd DATE,
    gestational_age VARCHAR(50),
    creatinine_level VARCHAR(50),
    contrast_safety_flag BOOLEAN DEFAULT false,
    modalities TEXT,
    department VARCHAR(100),
    ward_room_bed VARCHAR(100),
    billing_category VARCHAR(100),
    insurance_provider VARCHAR(100),
    consent_research_ai BOOLEAN DEFAULT false,
    indication_for_scan TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. Modalities & Body Parts
CREATE TABLE IF NOT EXISTS modalities (
    id SERIAL PRIMARY KEY,
    code VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT true
);

INSERT INTO modalities (code, name, is_active) VALUES
('CT', 'Computed Tomography', true),
('MR', 'Magnetic Resonance', true),
('CR', 'Computed Radiography', true),
('DX', 'Digital Radiography', true),
('US', 'Ultrasound', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS body_parts (
    id SERIAL PRIMARY KEY,
    modality_id INTEGER REFERENCES modalities(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(modality_id, name)
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

INSERT INTO pacs (pacs_name, pacs_type, ip_address, port, ae_title, is_active)
VALUES ('MWL_SERVER', 'orthanc', 'localhost', 11118, 'MWL_SERVER', true)
ON CONFLICT (pacs_name) DO UPDATE SET port = 11118, ae_title = 'MWL_SERVER', is_active = true;

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

-- 7. Studies & Reports
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

CREATE TABLE IF NOT EXISTS report_templates (
    id SERIAL PRIMARY KEY,
    template_name VARCHAR(255),
    modality VARCHAR(50),
    body_part VARCHAR(100),
    template_type VARCHAR(50) DEFAULT 'plain',
    is_default BOOLEAN DEFAULT false,
    content JSONB NOT NULL,
    created_by INTEGER,
    created_by_role VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    modality VARCHAR(50) NOT NULL,
    body_part VARCHAR(100) NOT NULL,
    history TEXT,
    findings TEXT,
    conclusion TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    reported_by_signature TEXT,
    clinic_id INTEGER DEFAULT 1,
    hospital_id INTEGER DEFAULT 1,
    status TEXT DEFAULT 'Draft',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE patients ADD COLUMN IF NOT EXISTS clinic_id INTEGER DEFAULT 1;
ALTER TABLE studies ADD COLUMN IF NOT EXISTS clinic_id INTEGER DEFAULT 1;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS clinic_id INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS user_clinics (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    clinic_id INTEGER REFERENCES clinics(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, clinic_id)
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

-- 8. Billing
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

-- 9. Audit & Privacy Logs
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

CREATE TABLE IF NOT EXISTS privacy_requests (
    id SERIAL PRIMARY KEY,
    request_type VARCHAR(50) NOT NULL,
    patient_id VARCHAR(64) NOT NULL,
    requester_name VARCHAR(100),
    requester_email VARCHAR(100),
    status VARCHAR(20) DEFAULT 'PENDING',
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
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
