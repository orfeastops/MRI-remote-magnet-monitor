#!/bin/bash
# Run once: sudo bash nginx-setup/install-nginx.sh
#
# What this does:
#   1. Installs Nginx
#   2. Configures it as a reverse proxy:
#        /ws         → port 3002 (v2 WebSocket for LilyGO + browser)
#        /api/v2/    → port 3002 (v2 REST API)
#        everything  → port 3001 (v1 legacy MRI monitor)
#   3. Updates Cloudflare Tunnel to route through Nginx
#   4. Certbot + Let's Encrypt instructions left at end
#      (run when you have a Cloudflare API token)
set -e

DOMAIN="magnets.karnagio.org"
PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[1/4] Installing Nginx..."
apt-get update -qq && apt-get install -y nginx

echo "[2/4] Writing Nginx config..."
cat > "/etc/nginx/sites-available/$DOMAIN" << 'NGINX_CONF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name magnets.karnagio.org;

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

    # v2 REST API  (/api/v2/auth/login → /api/auth/login on port 3002)
    location /api/v2/ {
        rewrite ^/api/v2/(.*) /api/$1 break;
        proxy_pass         http://127.0.0.1:3002;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
    }

    # v1 legacy MRI monitor (everything else)
    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
    }
}
NGINX_CONF

rm -f /etc/nginx/sites-enabled/default
ln -sf "/etc/nginx/sites-available/$DOMAIN" /etc/nginx/sites-enabled/

echo "[3/4] Starting Nginx..."
nginx -t && systemctl enable nginx && systemctl restart nginx

echo "[4/4] Updating Cloudflare Tunnel config to route through Nginx..."
cp /home/linux/.cloudflared/mri-monitor.yml /home/linux/.cloudflared/mri-monitor.yml.bak
cat > /home/linux/.cloudflared/mri-monitor.yml << 'TUNNEL_CONF'
tunnel: c4f2768d-ca16-4827-8a78-91c26a699ef9
credentials-file: /home/linux/.cloudflared/c4f2768d-ca16-4827-8a78-91c26a699ef9.json
protocol: http2

ingress:
  - hostname: magnets.karnagio.org
    service: http://localhost:80
  - service: http_status:404
TUNNEL_CONF

sudo -u linux pm2 restart mri-cloudflare

echo ""
echo "=== Done! ==="
echo "  v1 (legacy):   https://magnets.karnagio.org/"
echo "  v2 API:        https://magnets.karnagio.org/api/v2/auth/me"
echo "  v2 WebSocket:  wss://magnets.karnagio.org/ws"
echo ""
echo "To add Let's Encrypt later (when you have a Cloudflare API token):"
echo "  sudo apt-get install -y certbot python3-certbot-dns-cloudflare"
echo "  sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/cloudflare-credentials.ini -d $DOMAIN"
echo "  # Then add listen 443 ssl; lines to the nginx config"
