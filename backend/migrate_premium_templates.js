const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "lekhana",
  database: process.env.POSTGRES_DB || "ris",
});

const ctAbdomenTable = `
<h4 style="color:#1e40af; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">ABDOMINAL ORGANOMETRY</h4>
<table border="1" style="width:100%; border-collapse:collapse; font-size:12px; margin:10px 0;">
  <tr style="background:#f8fafc;">
    <th style="padding:4px;">Organ</th><th style="padding:4px;">Size / Morphology</th><th style="padding:4px;">Findings</th>
  </tr>
  <tr><td style="padding:4px; font-weight:bold;">Liver</td><td style="padding:4px;">Normal (14.5cm)</td><td style="padding:4px;">No focal lesions seen.</td></tr>
  <tr><td style="padding:4px; font-weight:bold;">Spleen</td><td style="padding:4px;">Normal (10.2cm)</td><td style="padding:4px;">Homogeneous echotexture.</td></tr>
  <tr><td style="padding:4px; font-weight:bold;">Pancreas</td><td style="padding:4px;">Normal</td><td style="padding:4px;">Head, body and tail appear normal.</td></tr>
  <tr><td style="padding:4px; font-weight:bold;">Kidneys</td><td style="padding:4px;">R: 10cm, L: 10.5cm</td><td style="padding:4px;">No calculi or hydronephrosis.</td></tr>
</table>
`;

const dopplerTable = `
<h4 style="color:#1e40af; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">DOPPLER MEASUREMENTS</h4>
<table border="1" style="width:100%; border-collapse:collapse; font-size:12px; margin:10px 0;">
  <tr style="background:#f8fafc;">
    <th style="padding:4px;">Vessel</th><th style="padding:4px;">PSV (cm/s)</th><th style="padding:4px;">EDV (cm/s)</th><th style="padding:4px;">RI</th><th style="padding:4px;">Status</th>
  </tr>
  <tr><td style="padding:4px; font-weight:bold;">Right CCA</td><td style="padding:4px;">{{PSV}}</td><td style="padding:4px;">{{EDV}}</td><td style="padding:4px;">{{RI}}</td><td style="padding:4px;">Normal</td></tr>
  <tr><td style="padding:4px; font-weight:bold;">Right ICA</td><td style="padding:4px;">{{PSV_ICA}}</td><td style="padding:4px;">{{EDV_ICA}}</td><td style="padding:4px;">{{RI_ICA}}</td><td style="padding:4px;">Normal</td></tr>
</table>
`;

async function migrate() {
    try {
        console.log("🚀 Starting Premium Template Migration...");

        const templates = [
            {
                name: "Premium CT Abdomen Structured",
                modality: "CT",
                body_part: "ABDOMEN",
                content: {
                    history: "Referred for routine abdominal assessment.",
                    findings: ctAbdomenTable + "<p>Lungs bases are clear. No free fluid or air in the peritoneal cavity.</p>",
                    conclusion: "Normal CT Scan of the Abdomen and Pelvis."
                }
            },
            {
                name: "Premium Carotid Doppler Structured",
                modality: "US",
                body_part: "DOPPLER",
                content: {
                    history: "Evaluated for carotid artery stenosis.",
                    findings: dopplerTable + "<p>Intima-media thickness is within normal limits. No significant plaque seen.</p>",
                    conclusion: "Normal Carotid Doppler study."
                }
            }
        ];

        for (const t of templates) {
            await pool.query(
                `INSERT INTO report_templates (template_name, modality, body_part, template_type, content, updated_at)
                 VALUES ($1, $2, $3, 'structured', $4, NOW())
                 ON CONFLICT (template_name) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
                [t.name, t.modality, t.body_part, JSON.stringify(t.content)]
            );
            console.log(`✅ Template '${t.name}' integrated.`);
        }

        console.log("✨ Migration Complete!");
    } catch (err) {
        console.error("❌ Migration Failed:", err);
    } finally {
        await pool.end();
    }
}

migrate();
