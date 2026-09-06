#!/bin/bash

# iPacx RIS - Service Restart Script
# Restarts all docker services and rebuilds to pick up code changes.

echo "🛑 Stopping services..."
sudo docker compose down

echo "🏗️ Rebuilding and Starting services..."
sudo docker compose up -d --build

echo "✅ Services started. Checking status..."
sudo docker compose ps
