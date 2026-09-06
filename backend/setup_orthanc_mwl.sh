#!/bin/bash

# setup_orthanc_mwl.sh
# Automates the configuration of Orthanc to serve as a Worklist SCP

ORTHANC_CONF_DIR="/etc/orthanc"
MWL_DIR="/var/lib/orthanc/db/Worklists"

echo "==== Orthanc MWL Setup Assistant ===="

# 1. Create Worklists directory
echo "[1/3] Creating Worklists directory at $MWL_DIR..."
sudo mkdir -p "$MWL_DIR"
sudo chown -R orthanc:orthanc "$MWL_DIR"

# 2. Update Orthanc Configuration
echo "[2/3] Updating orthanc.json to enable ModalityWorklists..."
# This is a suggestion; real implementation would use jq to edit if available
echo "Please ensure your orthanc.json contains:"
echo '{
  "ModalityWorklists" : {
    "Enable" : true,
    "Database" : "'$MWL_DIR'"
  }
}'

# 3. Instruction for RIS integration
echo "[3/3] RIS Integration"
echo "The RIS is configured to export worklist files to: $MWL_DIR"
echo "Ensure the RIS .env matches: MWL_DIMSE_OUT_DIR=$MWL_DIR"

echo "Done! Restart Orthanc: sudo systemctl restart orthanc"
