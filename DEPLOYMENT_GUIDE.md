# iPacx RIS Single Hospital Deployment & Workflow Guide

Location: `ipacx@techiemen:~/ipacx-ris-akash`

This guide explains how to manage, build, push, and deploy the single-hospital **iPacx RIS/PACS** application using **GitHub**, **Docker Hub**, and **Portainer**.

---

## 📁 1. Local Project Directory

Your single-hospital test environment is ready at:
```bash
/home/ipacx/ipacx-ris-akash
```

It contains:
- `backend/`: Node.js Express REST API & PostgreSQL models
- `src/` & `public/`: React RIS Web Interface
- `mwl-service/`: DICOM Modality Worklist SCP (Port 11118) & HL7 Service (Port 6060)
- `ohif-viewer/`: OHIF DICOM Web Viewer integration
- `schema_docker_init.sql` & `master_data.sql`: Auto-initializing DB scripts
- `build_and_push_dockerhub.sh`: Helper script for Docker Hub image publishing
- `portainer-stack.yml`: 1-click Portainer deployment file
- `docker-compose.yml`: Local build & test compose configuration
- `docker-compose.prod.yml`: Production compose using pre-built Docker Hub images

---

## 🐙 2. Uploading Source Code to GitHub

To push this repository to GitHub under `ipacx-ris-akash`:

1. **Create Repository on GitHub**:
   - Log into your GitHub account.
   - Create a new repository named **`ipacx-ris-akash`** (private or public).

2. **Connect & Push Local Repo**:
   ```bash
   cd ~/ipacx-ris-akash
   
   # Add your GitHub remote URL (replace YOUR-GITHUB-USERNAME)
   git remote add origin https://github.com/YOUR-GITHUB-USERNAME/ipacx-ris-akash.git
   
   # Push to main branch
   git push -u origin main
   ```

*Note: `.gitignore` is pre-configured so heavy `node_modules` and confidential `.env` files are excluded from GitHub automatically.*

---

## 🐳 3. Building & Uploading Containers to Docker Hub

Instead of compiling code on client hospital servers, pre-build all 4 container images and push them to **Docker Hub** (`hub.docker.com`).

### Command:
```bash
cd ~/ipacx-ris-akash
./build_and_push_dockerhub.sh <your_dockerhub_username> [tag]
```

### Example:
```bash
./build_and_push_dockerhub.sh ipacx latest
```

This script automatically builds and pushes the following 4 images:
1. `${DOCKER_USER}/ipacx-backend:latest`
2. `${DOCKER_USER}/ipacx-frontend:latest`
3. `${DOCKER_USER}/ipacx-mwl-service:latest`
4. `${DOCKER_USER}/ipacx-ohif:latest`

---

## 🚀 4. Client Site Deployment (Portainer or Docker Compose)

When setting up at a new hospital client site, you do **NOT** need Node.js, npm, or build tools on the client server.

### Option A: Portainer (1-Click GUI Deployment)

1. Open Portainer on client server (`http://<client-ip>:9000`).
2. Go to **Stacks** > **+ Add stack**.
3. Name: `ipacx-ris`
4. Choose **Build method**:
   - **Repository**: Enter `https://github.com/YOUR-GITHUB-USERNAME/ipacx-ris-akash` and Compose path `portainer-stack.yml`.
   - **OR Web editor**: Copy & paste the contents of `portainer-stack.yml`.
5. Under Environment variables, add:
   - `DOCKER_HUB_REPO` = `your_dockerhub_username`
   - `POSTGRES_PASSWORD` = `your_secure_db_password`
6. Click **Deploy the stack**.

### Option B: Docker Compose CLI (Client Machine)

If deploying via terminal at client site:

```bash
# 1. Download portainer-stack.yml (or clone git repo)
mkdir ipacx-ris && cd ipacx-ris
wget https://raw.githubusercontent.com/YOUR-GITHUB-USERNAME/ipacx-ris-akash/main/portainer-stack.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/YOUR-GITHUB-USERNAME/ipacx-ris-akash/main/schema_docker_init.sql
wget https://raw.githubusercontent.com/YOUR-GITHUB-USERNAME/ipacx-ris-akash/main/master_data.sql
wget https://raw.githubusercontent.com/YOUR-GITHUB-USERNAME/ipacx-ris-akash/main/orthanc.json

# 2. Launch container stack from Docker Hub
DOCKER_HUB_REPO=your_dockerhub_username docker compose up -d
```

---

## 🌐 Services & Ports Reference

| Service | Port / Protocol | Description |
| :--- | :--- | :--- |
| **RIS Frontend** | `http://localhost:3000` (Dev) / `80` (Prod) | Patient List, Scheduling, Reporting |
| **Backend REST API** | `http://localhost:5000` | Node.js Express API & PDF Generation |
| **OHIF Viewer** | `http://localhost:3001` or `/viewer/` | DICOM Viewer |
| **Orthanc PACS** | `http://localhost:8042` / DICOM `4242` | DICOM Server |
| **MWL SCP** | DICOM `11118` (AE Title: `IPACX_MWL`) | Modality Worklist Server |
| **HL7 Listener** | TCP `6060` | HL7 Inbound Service |
