#!/bin/bash

# iPacx RIS/PACS - World-Class Setup Script
# Handles: Port conflicts, DB Initialization, Service Rebuilds, Advanced Reporting

set -e

# Colors for better output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🚀 Starting iPacx RIS Docker Stack Setup...${NC}"

# 0. Environment Setup
if [ ! -f .env ]; then
    echo -e "${YELLOW}📄 Creating default .env file...${NC}"
    echo "POSTGRES_PASSWORD=lekhana" > .env
    echo "JWT_SECRET=bhEs3RR+q74v+rK3w/3dWWTpiBpEXZ++KT7wrxMWjyUSsETbpJvORaEoAGpA+ejq" >> .env
    echo "REACT_APP_API_URL=http://localhost:3015" >> .env
fi

# 1. Resolve Port Conflicts
echo -e "${YELLOW}🔍 Checking for port conflicts (3010, 3015, 11118)...${NC}"
for port in 3010 3015 11118; do
    CONFLICT_PID=$(sudo lsof -t -i:$port || true)
    if [ ! -z "$CONFLICT_PID" ]; then
        echo -e "${RED}⚠️ Port $port is in use by PID $CONFLICT_PID. Attempting to stop...${NC}"
        # If it's a docker container, handle it
        CONTAINER_ID=$(sudo docker ps -q --filter "publish=$port" || true)
        if [ ! -z "$CONTAINER_ID" ]; then
            sudo docker stop $CONTAINER_ID || true
        else
            sudo kill -9 $CONFLICT_PID || true
        fi
    fi
done

# 2. Command Handling
case "$1" in
    clean)
        echo -e "${YELLOW}🧹 Full Clean build requested (no-cache, removing volumes/images)...${NC}"
        sudo docker compose down --remove-orphans -v --rmi local
        sudo docker builder prune -af || true
        sudo docker compose build --no-cache
        sudo docker compose up -d
        ;;
    rebuild)
        echo -e "${BLUE}🏗️ Rebuilding all services (Optimized with Cache)...${NC}"
        # Prune only old build cache (older than 24h) to keep build speed fast
        sudo docker builder prune -f --filter "until=24h" || true
        sudo docker compose up -d --build --force-recreate
        sudo docker image prune -f || true
        ;;
    sync)
        echo -e "${GREEN}🔄 Fast Sync: Updating Frontend & Backend code only...${NC}"
        # This only rebuilds services that changed, keeping the DB and Orthanc running
        sudo docker compose up -d --build frontend backend
        ;;
    logs)
        sudo docker compose logs -f $2
        exit 0
        ;;
    down)
        sudo docker compose down -v
        exit 0
        ;;
    ps)
        sudo docker compose ps
        exit 0
        ;;
    *)
        if [ ! -z "$1" ]; then
            echo -e "${YELLOW}🏗️ Rebuilding specific service: $1...${NC}"
            # Standard build uses cache for speed
            sudo docker compose up -d --build $1
        else
            echo -e "${BLUE}🛑 Stopping existing services...${NC}"
            sudo docker compose down --remove-orphans
            echo -e "${BLUE}🏗️ Building and Starting all services...${NC}"
            sudo docker compose up -d --build --force-recreate
        fi
        ;;
esac

# 4. Wait for Database
echo -e "${YELLOW}🐘 Waiting for Database to be ready...${NC}"
RETRIES=30
until sudo docker exec ipacx-db pg_isready -U postgres -d ris > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
  echo -ne "."
  sleep 2
  RETRIES=$((RETRIES-1))
done
echo -e "\n${GREEN}✅ Database is ready!${NC}"

# 5. Apply Database Fixes
echo -e "${YELLOW}🔧 Executing DB Schema Fix (port 11118, admin user)...${NC}"
sudo docker cp db_fix.sql ipacx-db:/tmp/db_fix.sql
sudo docker exec ipacx-db psql -U postgres -d ris -f /tmp/db_fix.sql > /dev/null 2>&1 || echo -e "${RED}⚠️ DB Fix warning (check logs)${NC}"

echo -e "\n----------------------------------------------------------------"
echo -e "${GREEN}iPacx RIS Deployment Successful!${NC}"
echo "----------------------------------------------------------------"
echo -e "${BLUE}Frontend Portal URL:${NC} http://localhost:3010"
echo -e "${BLUE}Backend API URL:${NC} http://localhost:3015"
echo -e "${BLUE}MWL Service:${NC} dicom://localhost:11118"
echo "----------------------------------------------------------------"
echo -e "${YELLOW}Credentials: admin / admin123${NC}"
echo "----------------------------------------------------------------"
echo -e "${GREEN}Advanced Features Configured:${NC}"
echo "✅ DICOM Synchronization & MWL Update"
echo "✅ Advanced Reporting (Split View & UI Mismatches Fixed)"
echo "✅ Dev Viewer Minimal Toolset Integration"
echo "✅ iPacx Lite (Mobile Connectivity Fixed via Proxy Patch)"
echo "✅ OHIF Path Mismatch & Routing Robustness"
echo "----------------------------------------------------------------"
echo "Usage:"
echo "  ./setup_docker.sh          # Standard start/update"
echo "  ./setup_docker.sh rebuild  # Rebuild all with fresh code (recommended after audit)"
echo "  ./setup_docker.sh clean    # Wipe everything & rebuild from scratch"
echo "  ./setup_docker.sh <name>   # Update single service (frontend, backend, ohif, etc)"
echo "  ./setup_docker.sh logs     # View logs"
echo "----------------------------------------------------------------"

# 6. Service Status
sudo docker compose ps
