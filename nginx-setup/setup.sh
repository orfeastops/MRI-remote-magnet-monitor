#!/bin/bash
# Complete Nginx + SSL setup for monitor.example.com
# Run as root: sudo bash nginx-setup/setup.sh
#
# Prerequisites:
#   1. Edit nginx-setup/cloudflare-credentials.ini with your CF API token
#      (dash.cloudflare.com β†’ API Tokens β†’ Create Token β†’ "Edit zone DNS"
#       restricted to zone: example.com)
set -e

DOMAIN="monitor.example.com"
CF_CREDS="/etc/cloudflare-credentials.ini"
PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== [1/7] Install packages ==="
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-dns-cloudflare

echo "=== [2/7] Validate Cloudflare credentials ==="
if grep -q "PASTE_YOUR_TOKEN_HERE" "$PROJ_DIR/nginx-setup/cloudflare-credentials.ini"; then
    echo "ERROR: Edit nginx-setup/cloudflare-credentials.ini with your Cloudflare API token first."
    exit 1
fi
cp "$PROJ_DIR/nginx-setup/cloudflare-credentials.ini" "$CF_CREDS"
chmod 600 "$CF_CREDS"

echo "=== [3/7] Start Nginx with temporary HTTP config (keep v1 live during setup) ==="
rm -f /etc/nginx/sites-enabled/default
cp "$PROJ_DIR/nginx-setup/magnets-temp-http.conf" "/etc/nginx/sites-available/$DOMAIN"
ln -sf "/etc/nginx/sites-available/$DOMAIN" /etc/nginx/sites-enabled/
nginx -t
systemctl enable nginx
systemctl restart nginx
echo "Nginx serving HTTP temporarily β€” v1 still live via tunnel"

echo "=== [4/7] Obtain Let's Encrypt certificate (DNS challenge, no port 80 needed) ==="
certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "$CF_CREDS" \
    --dns-cloudflare-propagation-seconds 30 \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    -m admin@example.com

echo "=== [5/7] Install full SSL Nginx config ==="
cp "$PROJ_DIR/nginx-setup/monitor.example.com.conf" "/etc/nginx/sites-available/$DOMAIN"
nginx -t
systemctl reload nginx
echo "Nginx now serving HTTPS on 443 with Let's Encrypt cert"

echo "=== [6/7] Update Cloudflare Tunnel to route through Nginx HTTPS ==="
cp /home/linux/.cloudflared/mri-monitor.yml /home/linux/.cloudflared/mri-monitor.yml.bak
cp "$PROJ_DIR/nginx-setup/mri-monitor-updated.yml" /home/linux/.cloudflared/mri-monitor.yml
sudo -u linux pm2 restart mri-cloudflare
echo "Tunnel now connects to https://localhost:443 (Nginx)"

echo "=== [7/7] Set up certbot auto-renewal ==="
echo "0 3 * * * root certbot renew --quiet --post-hook 'systemctl reload nginx'" \
    > /etc/cron.d/certbot-renew

echo ""
echo "==============================="
echo " Setup complete!"
echo "==============================="
echo " Test:"
echo "   curl https://$DOMAIN/api/v2/auth/me"
echo "   curl https://$DOMAIN/            (v1 legacy)"
echo "   wscat -c wss://$DOMAIN/ws        (v2 WebSocket)"
echo ""
echo " Note: port 443 is handled by Cloudflare Tunnel (no firewall change needed)."
echo " If you ever want direct HTTPS access (bypassing tunnel), open port 443:"
echo "   ufw allow 443/tcp"
