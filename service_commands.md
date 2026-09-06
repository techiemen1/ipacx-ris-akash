# iPacx RIS Service Management Guide

This guide describes how to manage individual services within the iPacx Docker stack.

## Starting Individual Services
To start or rebuild a specific service, use the following command:
`sudo docker compose up -d --build <service_name>`

### Common Service Names:
- **frontend**: The main RIS web application.
- **backend**: The RIS Node.js API server.
- **ohif**: The OHIF DICOM Viewer.
- **orthanc**: The Orthanc PACS server.
- **mwl-service**: The DICOM Modality Worklist and HL7 service.
- **db**: The PostgreSQL database.

### Examples:
- **Restart only the Viewer**:
  `sudo docker compose up -d --build ohif`
- **Apply changes to the RIS Frontend**:
  `sudo docker compose up -d --build frontend`
- **Restart the MWL Service**:
  `sudo docker compose up -d --build mwl-service`

## Viewing Logs
To view logs for a specific service:
`sudo docker compose logs -f <service_name>`

## Stopping Services
To stop the entire stack:
`sudo docker compose down`

To stop a specific service:
`sudo docker compose stop <service_name>`
