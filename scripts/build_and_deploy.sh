#!/bin/bash
# Build frontend and deploy to backend/public for single-port deployment
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_DIR="$PROJECT_ROOT/backend"
PUBLIC_DIR="$BACKEND_DIR/public"

echo "=== RobotCloud Build & Deploy ==="

# Step 1: Build frontend
echo "[1/2] Building frontend..."
cd "$FRONTEND_DIR"
npm install
npm run build

# Step 2: Copy build output to backend/public
echo "[2/2] Copying frontend build to backend/public..."
rm -rf "$PUBLIC_DIR"
cp -r "$FRONTEND_DIR/out" "$PUBLIC_DIR"

echo ""
echo "=== Build Complete ==="
echo "Frontend assets deployed to: $PUBLIC_DIR"
echo ""
echo "To start the server (uv auto-manages dependencies):"
echo "  cd $BACKEND_DIR"
echo "  uv run python manage.py runserver 0.0.0.0:8000"
echo ""
echo "Or with gunicorn (production):"
echo "  cd $BACKEND_DIR"
echo "  uv run gunicorn robotcloud_backend.wsgi:application -b 0.0.0.0:8000"
