-- Consolidated Schema Fix
SET search_path TO public;
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

-- Fix for users table missing columns and default admin
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) DEFAULT 'USER',
    full_name VARCHAR(100),
    email VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    title VARCHAR(20)
);

-- Reset/Create default admin (admin / admin123)
-- Hash: $2b$10$Bg9X1wb/bbdeiUL9U4qT2eSsYSEUNn/3LIrBhO5YyIDB9AGTeev0a
INSERT INTO users (username, password_hash, role, is_active)
VALUES ('admin', '$2b$10$Bg9X1wb/bbdeiUL9U4qT2eSsYSEUNn/3LIrBhO5YyIDB9AGTeev0a', 'ADMIN', true)
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true;

-- Fix for reports table missing columns
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reported_by_signature TEXT;
-- Fix for missing billing tables
CREATE TABLE IF NOT EXISTS test_prices (
    id SERIAL PRIMARY KEY,
    modality VARCHAR(50) NOT NULL,
    body_part VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
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

-- Fix for modality targets unique constraint
ALTER TABLE mwl_modality_targets ADD CONSTRAINT IF NOT EXISTS mwl_modality_targets_modality_code_key UNIQUE (modality_code);

-- Fix for pacs table updated_at
ALTER TABLE pacs ADD COLUMN IF NOT EXISTS username VARCHAR(100);
ALTER TABLE pacs ADD COLUMN IF NOT EXISTS password VARCHAR(100);
ALTER TABLE pacs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Ensure MWL_SERVER is correctly configured in the pacs table
INSERT INTO pacs (pacs_name, pacs_type, ip_address, port, ae_title, is_active)
VALUES ('MWL_SERVER', 'orthanc', 'orthanc', 11118, 'MWL_SERVER', true)
ON CONFLICT (pacs_name) DO UPDATE SET port = 11118, ae_title = 'MWL_SERVER', is_active = true;
