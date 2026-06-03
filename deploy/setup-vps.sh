#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  MRI Monitor — Hetzner VPS Setup Script
#  Run as root on Ubuntu 24.04:  bash setup-vps.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

DOMAIN="magnets.karnagio.org"
APP_DIR="/opt/mri-monitor"
SERVER_DIR="$APP_DIR/server"
WEBAPP_DIR="$APP_DIR/webapp"
LOG_DIR="/var/log/mri-monitor"
DB_DIR="/var/lib/mri-monitor"

# Colours
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
step() { echo -e "\n${G}══ $1 ${N}"; }
warn() { echo -e "${Y}[WARN]${N} $1"; }

step "[1/8] System update"
apt-get update -qq && apt-get upgrade -y -qq

step "[2/8] Install Node.js 20"
if ! node --version 2>/dev/null | grep -q "v20"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node: $(node --version)   npm: $(npm --version)"

step "[3/8] Install PM2, Nginx, curl, unzip"
npm install -g pm2 2>/dev/null
apt-get install -y nginx curl unzip

step "[4/8] Create directory structure"
mkdir -p "$SERVER_DIR" "$WEBAPP_DIR" "$LOG_DIR" "$DB_DIR"

step "[5/8] Extract application code"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/server-v2.tar.gz" ]; then
  tar -xzf "$SCRIPT_DIR/server-v2.tar.gz" --strip-components=1 -C "$SERVER_DIR"
  echo "Server code extracted"
else
  warn "server-v2.tar.gz not found next to this script. Copy it and re-run."
fi

if [ -f "$SCRIPT_DIR/webapp.tar.gz" ]; then
  tar -xzf "$SCRIPT_DIR/webapp.tar.gz" --strip-components=1 -C "$WEBAPP_DIR"
  echo "Webapp extracted"
else
  warn "webapp.tar.gz not found. Copy it and re-run."
fi

step "[5b/8] Install Node dependencies"
if [ -d "$SERVER_DIR" ] && [ -f "$SERVER_DIR/package.json" ]; then
  cd "$SERVER_DIR" && npm install --omit=dev
  cd -
fi

step "[5c/8] Create .env from template"
ENV_FILE="$SERVER_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$SCRIPT_DIR/env.template" ]; then
    cp "$SCRIPT_DIR/env.template" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo -e "${Y}ACTION REQUIRED: Edit $ENV_FILE and set SUPERADMIN_PASSWORD${N}"
  else
    warn "env.template not found. Create $ENV_FILE manually."
  fi
else
  echo ".env already exists — skipping"
fi

step "[6/8] Configure Nginx"
cat > /etc/nginx/sites-available/$DOMAIN << 'NGINX_EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Redirect HTTP → HTTPS (Let's Encrypt renews on port 80)
server {
    listen 80;
    server_name magnets.karnagio.org;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name magnets.karnagio.org;

    ssl_certificate     /etc/letsencrypt/live/magnets.karnagio.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/magnets.karnagio.org/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    # Webapp (v1-style static files — served at root for now)
    root /opt/mri-monitor/webapp;
    index index.html;

    # v2 WebSocket — LilyGO devices + browser live feed
    location /ws {
        proxy_pass         http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host       $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # v2 REST API
    location /api/ {
        proxy_pass         http://127.0.0.1:3002;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Static fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX_EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/

step "[6b/8] Create temp HTTP-only Nginx (before cert exists)"
cat > /etc/nginx/sites-available/${DOMAIN}-temp << 'NGINX_TEMP_EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
server {
    listen 80;
    server_name magnets.karnagio.org;
    root /opt/mri-monitor/webapp;
    index index.html;
    location /ws {
        proxy_pass         http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host       $host;
        proxy_read_timeout 3600s;
    }
    location /api/ {
        proxy_pass       http://127.0.0.1:3002;
        proxy_set_header Host $host;
    }
    location / { try_files $uri $uri/ /index.html; }
}
NGINX_TEMP_EOF

# Use temp config until SSL cert is obtained
rm -f /etc/nginx/sites-enabled/$DOMAIN
ln -sf /etc/nginx/sites-available/${DOMAIN}-temp /etc/nginx/sites-enabled/$DOMAIN
nginx -t && systemctl enable nginx && systemctl restart nginx
echo "Nginx running on port 80 (HTTP-only until you run get-cert.sh)"

step "[7/8] Set up PM2"
cat > /etc/mri-monitor-pm2.config.js << 'PM2_EOF'
module.exports = {
  apps: [{
    name:      'mri-monitor',
    script:    '/opt/mri-monitor/server/index.js',
    cwd:       '/opt/mri-monitor/server',
    env: {
      NODE_ENV: 'production',
    },
    error_file: '/var/log/mri-monitor/err.log',
    out_file:   '/var/log/mri-monitor/out.log',
    time:       true,
    restart_delay: 3000,
    max_restarts:  20,
  }]
};
PM2_EOF

if [ -f "$SERVER_DIR/index.js" ]; then
  pm2 start /etc/mri-monitor-pm2.config.js
  pm2 save
  pm2 startup | tail -1 | bash   # enable PM2 on boot
  echo "PM2 running"
else
  warn "Server not yet deployed. Run after copying server-v2.tar.gz."
fi

step "[8/8] Install cloudflared (Cloudflare Tunnel)"
if ! which cloudflared >/dev/null 2>&1; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq && apt-get install -y cloudflared
fi
echo "cloudflared $(cloudflared --version 2>&1 | head -1)"

echo ""
echo -e "${G}══════════════════════════════════════════════════${N}"
echo -e "${G}  Setup complete! Next steps:${N}"
echo -e "${G}══════════════════════════════════════════════════${N}"
echo ""
echo "  1. Edit the .env file:"
echo "       nano $ENV_FILE"
echo "       → Set SUPERADMIN_PASSWORD"
echo "       → Restart: pm2 restart mri-monitor"
echo ""
echo "  2. Get SSL certificate (certbot):"
echo "       bash $(dirname "$0")/get-cert.sh"
echo ""
echo "  3. Set up Cloudflare Tunnel:"
echo "       bash $(dirname "$0")/setup-tunnel.sh"
echo ""
echo "  4. Check logs:"
echo "       pm2 logs mri-monitor"
echo "       tail -f /var/log/nginx/error.log"
