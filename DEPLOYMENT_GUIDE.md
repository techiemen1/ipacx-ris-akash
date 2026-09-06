# Test Project Deployment & Workflow Guide

Location: `ipacx@techiemen:~/ipacx-ris-akash`

This guide explains how to manage, build, push, and deploy the application using **GitHub**, **Docker Hub**, and **Portainer**.

---

## 📁 1. Local Project Directory

Your test environment is ready at:
```bash
/home/ipacx/ipacx-ris-akash
```

It contains:
- `backend/`: Node.js Express REST API & Database models
- `src/` & `public/`: React Web Interface
- `mwl-service/`: Background listener service
- `ohif-viewer/`: Viewer integration
- `schema_docker_init.sql` & `master_data.sql`: Auto-initializing DB scripts
- `build_and_push_dockerhub.sh`: Helper script for Docker Hub image publishing
- `portainer-stack.yml`: 1-click Portainer deployment file
- `docker-compose.yml`: Local build & test compose configuration
- `docker-compose.prod.yml`: Production compose using pre-built Docker Hub images

---

## 🐙 2. Uploading Source Code to GitHub

To push this repository to GitHub under `ipacx-ris-akash`:

```bash
cd ~/ipacx-ris-akash
git add .
git commit -m "test project only"
git push -u origin main
```

---

## 🐳 3. Building & Uploading Containers to Docker Hub

```bash
cd ~/ipacx-ris-akash
./build_and_push_dockerhub.sh <your_dockerhub_username> [tag]
```

---

## 🚀 4. Deployment (Portainer or Docker Compose)

### Option A: Portainer

1. Open Portainer.
2. Go to **Stacks** > **+ Add stack**.
3. Name: `test-stack`
4. Paste the contents of `portainer-stack.yml` or select Git Repository.
5. Click **Deploy the stack**.

### Option B: Docker Compose CLI

```bash
docker compose up -d
```
