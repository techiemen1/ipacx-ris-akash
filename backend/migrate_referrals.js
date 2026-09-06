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
-- Create table for referring doctors
CREATE TABLE IF NOT EXISTS public.referring_doctors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    specialty VARCHAR(100),
    hospital_name VARCHAR(255),
    contact_number VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert some dummy data
INSERT INTO public.referring_doctors (name, specialty, hospital_name) VALUES
('Dr. Ramesh Kumar', 'General Physician', 'City Hospital'),
('Dr. Anita Sharma', 'Orthopedic Surgeon', 'Ortho Clinic'),
('Dr. Vijay Singh', 'Gastroenterologist', 'Metro Medics')
ON CONFLICT DO NOTHING;
`;

async function run() {
  try {
    console.log("Starting referral migration...");
    await pool.query(sql);
    console.log("Referral migration successful!");
  } catch (err) {
    console.error("Referral migration failed:", err);
  } finally {
    await pool.end();
  }
}

run();
