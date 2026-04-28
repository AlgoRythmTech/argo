#!/bin/bash
# Argo Server Setup — run this on your AMD Ryzen 3 server (8GB RAM, 1TB)
# One command: curl -fsSL <this-url> | bash
set -euo pipefail

echo "========================================="
echo "  Argo Server Setup"
echo "========================================="
echo ""

# 1. Install Docker if not present
if ! command -v docker &>/dev/null; then
  echo "[1/7] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable docker && sudo systemctl start docker
  sudo usermod -aG docker $USER
  echo "  Docker installed. You may need to log out and back in for group changes."
else
  echo "[1/7] Docker already installed."
fi

# 2. Install Docker Compose plugin if not present
if ! docker compose version &>/dev/null 2>&1; then
  echo "[2/7] Installing Docker Compose..."
  sudo apt-get update && sudo apt-get install -y docker-compose-plugin
else
  echo "[2/7] Docker Compose already installed."
fi

# 3. Install Node.js 20 if not present
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 20 ]]; then
  echo "[3/7] Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[3/7] Node.js $(node -v) already installed."
fi

# 4. Install pnpm
if ! command -v pnpm &>/dev/null; then
  echo "[4/7] Installing pnpm..."
  npm install -g pnpm@9
else
  echo "[4/7] pnpm already installed."
fi

# 5. Clone the repo (or pull if already there)
REPO_DIR="$HOME/argo"
if [ -d "$REPO_DIR" ]; then
  echo "[5/7] Pulling latest code..."
  cd "$REPO_DIR" && git pull origin main
else
  echo "[5/7] Cloning repo..."
  git clone https://github.com/AlgoRythmTech/server-backend.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

# 6. Set up environment
if [ ! -f .env.local ]; then
  echo "[6/7] Creating .env.local from template..."
  cp .env.example .env.local
  # Set the API to listen on all interfaces
  sed -i 's/API_HOST=127.0.0.1/API_HOST=0.0.0.0/' .env.local
  sed -i 's/API_HOST=localhost/API_HOST=0.0.0.0/' .env.local

  # Get the server's IP
  SERVER_IP=$(hostname -I | awk '{print $1}')
  sed -i "s|API_PUBLIC_URL=.*|API_PUBLIC_URL=http://${SERVER_IP}:4000|" .env.local
  sed -i "s|API_CORS_ORIGINS=.*|API_CORS_ORIGINS=http://localhost:5173,http://${SERVER_IP}:5173,http://0.0.0.0:5173|" .env.local

  echo ""
  echo "  !! IMPORTANT: Edit .env.local and add your OPENAI_API_KEY !!"
  echo "  nano $REPO_DIR/.env.local"
  echo ""
else
  echo "[6/7] .env.local already exists."
fi

# 7. Install deps, start infra, run migrations
echo "[7/7] Installing dependencies and starting services..."
cd "$REPO_DIR"
pnpm install

echo ""
echo "Starting Docker services (postgres, mongo, redis, mailpit)..."
docker compose up -d

echo ""
echo "Waiting 10s for databases to initialize..."
sleep 10

echo ""
echo "Running database migrations..."
pnpm db:generate
pnpm db:migrate

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "To start the API server:"
echo "  cd $REPO_DIR && pnpm --filter @argo/api dev"
echo ""
echo "The API will be available at:"
echo "  http://$(hostname -I | awk '{print $1}'):4000"
echo ""
echo "On your Windows machine, create apps/web/.env.local with:"
echo "  VITE_API_URL=http://$(hostname -I | awk '{print $1}'):4000"
echo ""
echo "Then run: pnpm --filter @argo/web dev"
echo ""
