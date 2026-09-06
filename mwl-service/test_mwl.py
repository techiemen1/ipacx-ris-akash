from pynetdicom import AE, debug_logger
from pydicom.dataset import Dataset
from pynetdicom.sop_class import ModalityWorklistInformationFind

# debug_logger()

def test_mwl_query():
    ae = AE()
    ae.add_requested_context(ModalityWorklistInformationFind)

    # MWL server details (adjust if running outside docker)
    server_ip = 'localhost'
    server_port = 11112
    server_aet = 'IPACX_MWL'

    assoc = ae.associate(server_ip, server_port, ae_title=server_aet)
    if assoc.is_established:
        print(f"Connected to {server_aet}")
        
        # Create a query dataset
        ds = Dataset()
        ds.PatientName = '*'
        ds.PatientID = ''
        ds.AccessionNumber = ''
        ds.ScheduledProcedureStepSequence = [Dataset()]
        ds.ScheduledProcedureStepSequence[0].Modality = ''
        ds.ScheduledProcedureStepSequence[0].ScheduledProcedureStepStartDate = ''

        responses = assoc.send_c_find(ds, ModalityWorklistInformationFind)
        
        count = 0
        for (status, identifier) in responses:
            if status:
                if status.Status == 0xFF00: # Pending
                    print("-" * 30)
                    print(f"Matching Patient: {identifier.PatientName}")
                    print(f"Accession: {identifier.AccessionNumber}")
                    count += 1
                elif status.Status == 0x0000: # Success
                    print(f"\nQuery Finished. Found {count} results.")
            else:
                print("Connection failed or timed out")
        
        assoc.release()
    else:
        print("Failed to associate with MWL server")

if __name__ == "__main__":
    test_mwl_query()
