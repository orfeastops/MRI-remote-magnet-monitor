#!/bin/bash
# Set up Cloudflare Tunnel for magnets.karnagio.org → this server
#
# Two options:
#   A) New tunnel via Cloudflare dashboard (recommended for fresh setup)
#   B) Reuse existing tunnel credentials from the local machine
#
# ── OPTION A: New tunnel token (from Cloudflare dashboard) ───────────────────
# 1. Go to https://one.dash.cloudflare.com → Networks → Tunnels
# 2. Create a tunnel → name it "mri-monitor-hetzner"
# 3. Choose "Docker" or "debian" → copy the token shown
# 4. Paste below and uncomment:
#
# TUNNEL_TOKEN="eyJhIjoiXX..."
# cloudflared service install $TUNNEL_TOKEN
# systemctl start cloudflared
# systemctl enable cloudflared
# echo "Tunnel running. Check status: systemctl status cloudflared"
# exit 0

# ── OPTION B: Existing tunnel credentials file ────────────────────────────────
# Copy the credentials JSON from the local machine:
#   scp ~/.cloudflared/c4f2768d-ca16-4827-8a78-91c26a699ef9.json root@178.105.237.98:/tmp/
# Then run this script.

TUNNEL_ID="c4f2768d-ca16-4827-8a78-91c26a699ef9"
CREDS_FILE="/tmp/$TUNNEL_ID.json"
CF_DIR="/etc/cloudflared"

if [ ! -f "$CREDS_FILE" ]; then
  echo "ERROR: Credentials file not found at $CREDS_FILE"
  echo "Copy it from the local machine:"
  echo "  scp ~/.cloudflared/$TUNNEL_ID.json root@178.105.237.98:/tmp/"
  exit 1
fi

mkdir -p $CF_DIR
mv "$CREDS_FILE" "$CF_DIR/$TUNNEL_ID.json"
chmod 600 "$CF_DIR/$TUNNEL_ID.json"

cat > $CF_DIR/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: $CF_DIR/$TUNNEL_ID.json
protocol: http2

ingress:
  - hostname: magnets.karnagio.org
    service: http://localhost:80
  - service: http_status:404
EOF

cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared
sleep 3
systemctl status cloudflared --no-pager | head -10

echo ""
echo "Tunnel running. Test: curl https://magnets.karnagio.org/api/auth/me"
echo ""
echo "NOTE: If reusing the existing tunnel, update the Cloudflare dashboard"
echo "  to point magnets.karnagio.org to the Hetzner server (not the local machine)."
