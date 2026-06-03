#!/bin/bash
# Get Let's Encrypt certificate for magnets.karnagio.org
# Run AFTER the domain DNS points to this server's IP (178.105.237.98)
# and port 80 is open in Hetzner firewall.
set -euo pipefail

DOMAIN="magnets.karnagio.org"
EMAIL="admin@karnagio.org"

echo "Installing certbot..."
apt-get install -y certbot python3-certbot-nginx

echo "Obtaining certificate via HTTP challenge..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $EMAIL

echo "Switching Nginx to full SSL config..."
rm -f /etc/nginx/sites-enabled/$DOMAIN
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
nginx -t && systemctl reload nginx

# Auto-renewal
echo "0 3 * * * root certbot renew --quiet --post-hook 'systemctl reload nginx'" \
  > /etc/cron.d/certbot-renew

echo ""
echo "SSL certificate installed. Test: curl https://$DOMAIN/api/auth/me"
