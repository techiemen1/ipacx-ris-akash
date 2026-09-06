FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY mwl_scp.py .

# DICOM MWL Port
EXPOSE 11112
# HL7 Port
EXPOSE 6060

CMD ["python", "mwl_scp.py"]
