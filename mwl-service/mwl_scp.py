import os
import time
import threading
import logging
import psycopg2
from pydicom.dataset import Dataset
from pynetdicom import AE, evt, debug_logger
from pynetdicom.sop_class import ModalityWorklistInformationFind
import hl7

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("MWL_SCP")
# debug_logger() # Uncomment for verbose DICOM logs

# Environment variables
DB_HOST = os.getenv("POSTGRES_HOST", "db")
DB_PORT = os.getenv("POSTGRES_PORT", "5432")
DB_NAME = os.getenv("POSTGRES_DB", "ris")
DB_USER = os.getenv("POSTGRES_USER", "postgres")
DB_PASS = os.getenv("POSTGRES_PASSWORD", "lekhana")

AE_TITLE = os.getenv("MWL_AE_TITLE", "IPACX_MWL")
SCP_PORT = int(os.getenv("MWL_SCP_PORT", 11118))
HL7_PORT = int(os.getenv("HL7_PORT", 6060))

def get_db_connection():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASS
    )

def handle_find(event):
    """Handle a C-FIND request."""
    ds = event.identifier
    logger.info(f"Received C-FIND request from {event.assoc.requestor.ae_title}")
    
    # Extract search keys
    patient_name = str(ds.get("PatientName", "*"))
    patient_id = str(ds.get("PatientID", "*"))
    accession = str(ds.get("AccessionNumber", "*"))
    
    # Simple wildcard to SQL conversion
    def to_sql_pattern(val):
        if not val or val == "*": return "%"
        return val.replace("*", "%").replace("?", "_")

    name_pattern = to_sql_pattern(patient_name)
    id_pattern = to_sql_pattern(patient_id)
    acc_pattern = to_sql_pattern(accession)

    conn = get_db_connection()
    cur = conn.cursor()
    
    # Query the MWL table
    # Note: In a real system, you'd filter by ScheduledProcedureStepSequence tags too
    query = """
    SELECT patientid, patientname, patientsex, patientage, accessionnumber, 
           studydescription, modality, bodypartexamined, referringphysician, schedulingdate,
           studyinstanceuid
    FROM mwl
    WHERE patientname ILIKE %s AND patientid ILIKE %s AND accessionnumber ILIKE %s
    """
    cur.execute(query, (name_pattern, id_pattern, acc_pattern))
    rows = cur.fetchall()
    
    for row in rows:
        if event.is_cancelled:
            yield 0xFE00, None
            return

        # Create a response dataset
        identifier = Dataset()
        identifier.PatientID = row[0]
        identifier.PatientName = row[1]
        identifier.PatientSex = row[2] or "O"
        identifier.PatientBirthDate = "" # Could calculate from age if needed
        identifier.AccessionNumber = row[4]
        identifier.StudyDescription = row[5]
        identifier.ReferringPhysicianName = row[8] or ""
        identifier.StudyInstanceUID = row[10] or ""
        
        # Scheduled Procedure Step Sequence (Required for MWL)
        sps_step = Dataset()
        sps_step.Modality = row[6] or "OT"
        sps_step.ScheduledStationAETitle = AE_TITLE
        sps_step.ScheduledProcedureStepStartDate = row[9].strftime("%Y%m%d") if row[9] else ""
        sps_step.ScheduledProcedureStepStartTime = "000000"
        sps_step.ScheduledProcedureStepDescription = row[5]
        sps_step.ScheduledProcedureStepID = f"SPS-{row[4]}"
        
        identifier.ScheduledProcedureStepSequence = [sps_step]
        identifier.RequestedProcedureID = f"RP-{row[4]}"
        identifier.RequestedProcedureDescription = row[5]

        yield 0xFF00, identifier

    cur.close()
    conn.close()

def start_dicom_scp():
    ae = AE(ae_title=AE_TITLE)
    ae.add_supported_context(ModalityWorklistInformationFind)
    
    handlers = [(evt.EVT_C_FIND, handle_find)]
    
    logger.info(f"Starting DICOM MWL SCP on port {SCP_PORT} as {AE_TITLE}...")
    ae.start_server(("", SCP_PORT), block=False, evt_handlers=handlers)

def handle_hl7_message(data):
    """Process incoming HL7 ORM/ADT messages."""
    try:
        msg = hl7.parse(data.decode('utf-8'))
        msh = msg['MSH']
        msg_type = msh[9][0][0]
        
        logger.info(f"Received HL7 message type: {msg_type}")
        
        if msg_type in ['ADT', 'ORM']:
            pid = msg['PID']
            patient_id = str(pid[3])
            patient_name = str(pid[5])
            patient_sex = str(pid[8])
            
            accession = ""
            study_desc = "HL7 Order"
            modality = "OT"
            
            if msg_type == 'ORM':
                orc = msg['ORC']
                obr = msg['OBR']
                accession = str(orc[2]) or str(obr[2])
                study_desc = str(obr[4][0][1]) if len(obr[4]) > 0 else "Unknown"
                modality = str(obr[24]) if len(obr) > 24 else "OT"

            # Insert into database
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO mwl (patientid, patientname, patientsex, accessionnumber, studydescription, modality, schedulingdate)
                VALUES (%s, %s, %s, %s, %s, %s, CURRENT_DATE)
                ON CONFLICT (patientid) DO UPDATE SET
                    patientname = EXCLUDED.patientname,
                    accessionnumber = EXCLUDED.accessionnumber,
                    studydescription = EXCLUDED.studydescription,
                    modality = EXCLUDED.modality
            """, (patient_id, patient_name, patient_sex, accession, study_desc, modality))
            conn.commit()
            cur.close()
            conn.close()
            logger.info(f"Added/Updated patient {patient_id} via HL7")
            
    except Exception as e:
        logger.error(f"HL7 processing error: {e}")

def start_hl7_listener():
    import socket
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("0.0.0.0", HL7_PORT))
    sock.listen(5)
    
    logger.info(f"Starting HL7 listener on port {HL7_PORT}...")
    
    while True:
        client, addr = sock.accept()
        data = client.recv(4096)
        if data:
            # HL7 often uses MLLP protocol (minimal lower layer protocol)
            # For simplicity, we assume raw HL7 here or stripped MLLP
            handle_hl7_message(data)
        client.close()

if __name__ == "__main__":
    # Wait for DB to be ready
    time.sleep(5)
    
    # Start DICOM SCP in background
    start_dicom_scp()
    
    # Start HL7 listener in main thread
    start_hl7_listener()
