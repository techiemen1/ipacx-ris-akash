#!/bin/bash

# ==============================================================================
# Docker Hub Build & Push Script (Test Project)
# Usage:
#   ./build_and_push_dockerhub.sh <dockerhub_username> [image_tag]
# Example:
#   ./build_and_push_dockerhub.sh ipacx latest
# ==============================================================================

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

DOCKER_USER="${1:-ipacx}"
TAG="${2:-latest}"

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}   Docker Hub Image Builder & Pusher   ${NC}"
echo -e "${BLUE}======================================================${NC}"
echo -e "${YELLOW}Docker Hub Username/Organization:${NC} ${DOCKER_USER}"
echo -e "${YELLOW}Image Tag:${NC} ${TAG}"
echo -e "${BLUE}======================================================${NC}"

# Check Docker installation
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed or not in PATH.${NC}"
    exit 1
fi

# 1. Build Services
echo -e "\n${YELLOW}🏗️ Step 1/4: Building Backend image...${NC}"
docker build -t "${DOCKER_USER}/ipacx-backend:${TAG}" ./backend

echo -e "\n${YELLOW}🏗️ Step 2/4: Building Frontend image...${NC}"
docker build -t "${DOCKER_USER}/ipacx-frontend:${TAG}" -f Dockerfile .

echo -e "\n${YELLOW}🏗️ Step 3/4: Building MWL Service image...${NC}"
docker build -t "${DOCKER_USER}/ipacx-mwl-service:${TAG}" ./mwl-service

echo -e "\n${YELLOW}🏗️ Step 4/4: Building OHIF Viewer image...${NC}"
docker build -t "${DOCKER_USER}/ipacx-ohif:${TAG}" \
    --build-arg APP_CONFIG=config/ipacx.js \
    --build-arg PUBLIC_URL=/viewer/ \
    ./ohif-viewer

echo -e "\n${GREEN}✅ All 4 images built successfully!${NC}"

# 2. Confirm Push
read -p "Do you want to push these images to hub.docker.com now? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "\n${YELLOW}🔐 Ensuring Docker Hub login...${NC}"
    docker login || true

    echo -e "\n${BLUE}🚀 Pushing ${DOCKER_USER}/ipacx-backend:${TAG}...${NC}"
    docker push "${DOCKER_USER}/ipacx-backend:${TAG}"

    echo -e "\n${BLUE}🚀 Pushing ${DOCKER_USER}/ipacx-frontend:${TAG}...${NC}"
    docker push "${DOCKER_USER}/ipacx-frontend:${TAG}"

    echo -e "\n${BLUE}🚀 Pushing ${DOCKER_USER}/ipacx-mwl-service:${TAG}...${NC}"
    docker push "${DOCKER_USER}/ipacx-mwl-service:${TAG}"

    echo -e "\n${BLUE}🚀 Pushing ${DOCKER_USER}/ipacx-ohif:${TAG}...${NC}"
    docker push "${DOCKER_USER}/ipacx-ohif:${TAG}"

    echo -e "\n${GREEN}🎉 Successfully published all images to Docker Hub!${NC}"
    echo -e "${GREEN}Client deployment docker-compose command:${NC}"
    echo "DOCKER_HUB_REPO=${DOCKER_USER} docker compose -f docker-compose.prod.yml up -d"
else
    echo -e "${YELLOW}Skipped push. Images are built locally and ready for deployment.${NC}"
fi
