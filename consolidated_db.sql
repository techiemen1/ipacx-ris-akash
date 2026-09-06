--
-- PostgreSQL database dump
--


-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: body_parts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.body_parts (
    id integer NOT NULL,
    modality_id integer,
    name character varying(100) NOT NULL,
    is_active boolean DEFAULT true
);


ALTER TABLE public.body_parts OWNER TO postgres;

--
-- Name: body_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.body_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.body_parts_id_seq OWNER TO postgres;

--
-- Name: body_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.body_parts_id_seq OWNED BY public.body_parts.id;


--
-- Name: modalities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.modalities (
    id integer NOT NULL,
    code character varying(10) NOT NULL,
    name character varying(50) NOT NULL,
    is_active boolean DEFAULT true
);


ALTER TABLE public.modalities OWNER TO postgres;

--
-- Name: modalities_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.modalities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.modalities_id_seq OWNER TO postgres;

--
-- Name: modalities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.modalities_id_seq OWNED BY public.modalities.id;


--
-- Name: mwl; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mwl (
    id integer NOT NULL,
    patientid character varying(50) NOT NULL,
    patientname character varying(255) NOT NULL,
    patientsex character varying(10),
    patientage character varying(20),
    accessionnumber character varying(50),
    studydescription character varying(255),
    schedulingdate date,
    modality character varying(50),
    bodypartexamined character varying(50),
    referringphysician character varying(100)
);


ALTER TABLE public.mwl OWNER TO postgres;

--
-- Name: mwl_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.mwl_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mwl_id_seq OWNER TO postgres;

--
-- Name: mwl_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.mwl_id_seq OWNED BY public.mwl.id;


--
-- Name: report_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.report_images (
    id integer NOT NULL,
    report_id integer NOT NULL,
    image_path text NOT NULL,
    image_type text DEFAULT 'KEY'::text,
    sort_order integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.report_images OWNER TO postgres;

--
-- Name: report_images_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.report_images_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.report_images_id_seq OWNER TO postgres;

--
-- Name: report_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.report_images_id_seq OWNED BY public.report_images.id;


--
-- Name: report_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.report_templates (
    id integer NOT NULL,
    modality character varying(10) NOT NULL,
    body_part character varying(100) NOT NULL,
    template_name character varying(150) NOT NULL,
    template_type character varying(100),
    is_default boolean DEFAULT false,
    content jsonb NOT NULL,
    created_by character varying(50),
    created_by_role character varying(20),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.report_templates OWNER TO postgres;

--
-- Name: report_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.report_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.report_templates_id_seq OWNER TO postgres;

--
-- Name: report_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.report_templates_id_seq OWNED BY public.report_templates.id;


--
-- Name: reports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reports (
    id integer NOT NULL,
    study_uid text NOT NULL,
    accession_number text,
    patient_id text,
    patient_name text,
    modality text,
    report_content jsonb NOT NULL,
    reported_by text,
    approved_by text,
    status text DEFAULT 'Draft'::text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    report_title text,
    body_part text,
    referring_doctor text,
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Final'::text])))
);


ALTER TABLE public.reports OWNER TO postgres;

--
-- Name: reports_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reports_id_seq OWNER TO postgres;

--
-- Name: reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.reports_id_seq OWNED BY public.reports.id;


--
-- Name: templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.templates (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    modality character varying(50) NOT NULL,
    body_part character varying(100) NOT NULL,
    history text,
    findings text,
    conclusion text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.templates OWNER TO postgres;

--
-- Name: templates_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.templates_id_seq OWNER TO postgres;

--
-- Name: templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.templates_id_seq OWNED BY public.templates.id;


--
-- Name: body_parts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.body_parts ALTER COLUMN id SET DEFAULT nextval('public.body_parts_id_seq'::regclass);


--
-- Name: modalities id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modalities ALTER COLUMN id SET DEFAULT nextval('public.modalities_id_seq'::regclass);


--
-- Name: mwl id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mwl ALTER COLUMN id SET DEFAULT nextval('public.mwl_id_seq'::regclass);


--
-- Name: report_images id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_images ALTER COLUMN id SET DEFAULT nextval('public.report_images_id_seq'::regclass);


--
-- Name: report_templates id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_templates ALTER COLUMN id SET DEFAULT nextval('public.report_templates_id_seq'::regclass);


--
-- Name: reports id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reports ALTER COLUMN id SET DEFAULT nextval('public.reports_id_seq'::regclass);


--
-- Name: templates id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.templates ALTER COLUMN id SET DEFAULT nextval('public.templates_id_seq'::regclass);


--
-- Name: body_parts body_parts_modality_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.body_parts
    ADD CONSTRAINT body_parts_modality_id_name_key UNIQUE (modality_id, name);


--
-- Name: body_parts body_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.body_parts
    ADD CONSTRAINT body_parts_pkey PRIMARY KEY (id);


--
-- Name: modalities modalities_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modalities
    ADD CONSTRAINT modalities_code_key UNIQUE (code);


--
-- Name: modalities modalities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modalities
    ADD CONSTRAINT modalities_pkey PRIMARY KEY (id);


--
-- Name: mwl mwl_patientid_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mwl
    ADD CONSTRAINT mwl_patientid_key UNIQUE (patientid);


--
-- Name: mwl mwl_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mwl
    ADD CONSTRAINT mwl_pkey PRIMARY KEY (id);


--
-- Name: report_images report_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_images
    ADD CONSTRAINT report_images_pkey PRIMARY KEY (id);


--
-- Name: report_templates report_templates_modality_body_part_template_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_templates
    ADD CONSTRAINT report_templates_modality_body_part_template_name_key UNIQUE (modality, body_part, template_name);


--
-- Name: report_templates report_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_templates
    ADD CONSTRAINT report_templates_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: reports reports_study_uid_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_study_uid_key UNIQUE (study_uid);


--
-- Name: templates templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);


--
-- Name: reports trg_reports_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_reports_updated BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: body_parts body_parts_modality_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.body_parts
    ADD CONSTRAINT body_parts_modality_id_fkey FOREIGN KEY (modality_id) REFERENCES public.modalities(id) ON DELETE CASCADE;


--
-- Name: report_images report_images_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_images
    ADD CONSTRAINT report_images_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


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
VALUES ('MWL_SERVER', 'orthanc', 'localhost', 11118, 'MWL_SERVER', true)
ON CONFLICT (pacs_name) DO UPDATE SET port = 11118, ae_title = 'MWL_SERVER', is_active = true;
