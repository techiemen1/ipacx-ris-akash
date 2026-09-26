const pacsGateway = require("../backend/services/pacsGateway");
const hybridPacsGateway = require("../backend/utils/hybridPacsGateway");
const pool = require("../backend/db");

async function test() {
  console.log("--- Testing PACS Services Locally ---");
  try {
    const { rows } = await pool.query("SELECT study_uid, patient_id, accession_number FROM public.studies LIMIT 5");
    console.log("DB Studies count:", rows.length);
    if (rows.length > 0) {
      console.log("First study from DB:", rows[0]);
      const testUid = rows[0].study_uid || rows[0].accession_number;
      
      console.time("getFullDicomTags");
      const tags = await pacsGateway.getFullDicomTags(testUid);
      console.timeEnd("getFullDicomTags");
      console.log("Tags Result:", JSON.stringify(tags, null, 2));

      console.time("fetchHybridSeriesAndInstances");
      const series = await hybridPacsGateway.fetchHybridSeriesAndInstances(testUid);
      console.timeEnd("fetchHybridSeriesAndInstances");
      console.log("Series count:", series.length);
      if (series.length > 0) {
        console.log("First series:", {
          series_id: series[0].series_id,
          series_description: series[0].series_description,
          total_slices: series[0].total_slices
        });
      }
    } else {
      console.log("No studies in DB, testing Orthanc directly...");
      const orthancUrl = await require("../backend/utils/orthancHelper").getOrthancUrl();
      console.log("Orthanc URL:", orthancUrl);
    }
  } catch (e) {
    console.error("Test Error:", e);
  } finally {
    process.exit(0);
  }
}

test();
