const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "172.19.0.2",
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "lekhana",
  database: process.env.POSTGRES_DB || "ris",
});

const sql = `
-- Create table for test prices
CREATE TABLE IF NOT EXISTS public.test_prices (
    id SERIAL PRIMARY KEY,
    modality VARCHAR(10) NOT NULL,
    body_part VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    gst_percent DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create table for invoices/bills
CREATE TABLE IF NOT EXISTS public.invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    patient_id VARCHAR(50) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    discount_amount DECIMAL(10, 2) DEFAULT 0.00,
    tax_amount DECIMAL(10, 2) DEFAULT 0.00,
    grand_total DECIMAL(10, 2) NOT NULL,
    payment_status VARCHAR(20) DEFAULT 'PENDING',
    payment_method VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create table for individual items in an invoice
CREATE TABLE IF NOT EXISTS public.invoice_items (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER REFERENCES public.invoices(id) ON DELETE CASCADE,
    description VARCHAR(255) NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(10, 2) NOT NULL,
    tax_amount DECIMAL(10, 2) DEFAULT 0.00,
    total_amount DECIMAL(10, 2) NOT NULL
);

-- Add billing fields to patients table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='outstanding_balance') THEN
        ALTER TABLE public.patients ADD COLUMN outstanding_balance DECIMAL(10, 2) DEFAULT 0.00;
    END IF;
END $$;

-- Insert some sample prices
INSERT INTO public.test_prices (modality, body_part, price, gst_percent) VALUES
('X-RAY', 'CHEST PA', 500.00, 0.00),
('X-RAY', 'KNEE AP/LAT', 800.00, 0.00),
('USG', 'ABDOMEN', 1500.00, 0.00),
('USG', 'PELVIS', 1200.00, 0.00),
('CT', 'HEAD NCCT', 3500.00, 0.00),
('CT', 'ABDOMEN CECT', 7500.00, 5.00),
('MRI', 'BRAIN', 6500.00, 5.00),
('MRI', 'KNEE', 7000.00, 5.00)
ON CONFLICT DO NOTHING;
`;

async function run() {
  try {
    console.log("Starting migration...");
    await pool.query(sql);
    console.log("Migration successful!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}

run();
