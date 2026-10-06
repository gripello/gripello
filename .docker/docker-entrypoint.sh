#!/bin/bash
set -e

APP_VER="${APP_VERSION:-dev}"
OWNER="$(id -u):$(id -g)"

fail_permissions() {
    echo "[startup] ERROR: $1 is not $2 by uid $OWNER." >&2
    echo "[startup] Fix it on the host (adjust the path if you mount a different one), then restart:" >&2
    echo "" >&2
    echo "    sudo chown -R $OWNER $3" >&2
    echo "" >&2
    echo "[startup] On SELinux hosts (Fedora/RHEL) also append :Z to the volume, e.g. $3:$1:Z" >&2
    exit 1
}

write_probe="/pb/pb_data/.write-test-$$"
touch "$write_probe" 2>/dev/null && rm -f "$write_probe" || fail_permissions /pb/pb_data writable ./pb_data

if [ -f /etc/nginx/ssl/cert.pem ] && [ -f /etc/nginx/ssl/key.pem ]; then
    [ -r /etc/nginx/ssl/cert.pem ] && [ -r /etc/nginx/ssl/key.pem ] || fail_permissions /etc/nginx/ssl readable ./ssl
else
    write_probe="/etc/nginx/ssl/.write-test-$$"
    touch "$write_probe" 2>/dev/null && rm -f "$write_probe" || fail_permissions /etc/nginx/ssl writable ./ssl
fi

TRUSTED_PROXIES="${TRUSTED_PROXIES:-127.0.0.1 ::1}"
for proxy in ${TRUSTED_PROXIES//,/ }; do
    echo "set_real_ip_from ${proxy//[^0-9A-Fa-f.:\/]/};"
done > /etc/nginx/real-ip.conf

# Generate a self-signed TLS certificate if none is present.
# Mount real certs at /etc/nginx/ssl/cert.pem and /etc/nginx/ssl/key.pem to override.
SSL_CERT=/etc/nginx/ssl/cert.pem
SSL_KEY=/etc/nginx/ssl/key.pem
# SSL_DNS_NAMES adds comma-separated hostnames to the SAN, for callers that
# reach the container under a name of their own (the e2e harness does).
if [ ! -f "$SSL_CERT" ] || [ ! -f "$SSL_KEY" ]; then
    echo "[nginx] no TLS certificate found — generating self-signed certificate..."
    SAN="DNS:localhost,IP:127.0.0.1"
    if [ -n "$SSL_DNS_NAMES" ]; then
        IFS=',' read -ra EXTRA_NAMES <<< "$SSL_DNS_NAMES"
        for name in "${EXTRA_NAMES[@]}"; do
            SAN="$SAN,DNS:$name"
        done
    fi
    # CA:TRUE so the cert can be installed as a trust anchor; it signs only
    # itself, and nothing trusts it unless someone explicitly adds it.
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "$SSL_KEY" \
        -out "$SSL_CERT" \
        -subj "/CN=gripello/O=Gripello/C=DE" \
        -addext "subjectAltName=$SAN" \
        -addext "basicConstraints=critical,CA:TRUE" \
        2>/dev/null
    echo "[nginx] self-signed certificate generated (valid 10 years, SAN: $SAN)"
fi

echo ""
echo "========================================"
echo "  Gripello ${APP_VER}"
echo "  ──────────────────────────────────────"
echo "  HTTP   →  http://0.0.0.0:80   (→ 443)"
echo "  HTTPS  →  https://0.0.0.0:443"
echo "========================================"
echo ""

# Run pocketbase migrations
echo "[pocketbase] running migrations..."
/pb/pocketbase migrate

# Create/update the default superuser if credentials are provided via env.
# Set PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD in your docker-compose.yml.
if [ -n "$PB_SUPERUSER_EMAIL" ] && [ -n "$PB_SUPERUSER_PASSWORD" ]; then
    echo "[pocketbase] upserting superuser ${PB_SUPERUSER_EMAIL}..."
    /pb/pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD"
fi

# Start PocketBase
echo "[pocketbase] starting..."
/pb/pocketbase serve --http=0.0.0.0:8080 &

# Start Nuxt.js UI
CPUS="$(nproc)"
# nproc ignores a container CPU quota (docker --cpus), cgroup v2 exposes it here
if read -r QUOTA PERIOD < /sys/fs/cgroup/cpu.max 2>/dev/null && [ "$QUOTA" != "max" ]; then
    CPUS=$(( (QUOTA + PERIOD - 1) / PERIOD ))
fi
WORKERS=$(( CPUS < 2 ? 1 : CPUS / 2 ))
export NITRO_CLUSTER_WORKERS="${NITRO_CLUSTER_WORKERS:-$(( WORKERS > 8 ? 8 : WORKERS ))}"
echo "[nuxt] starting ${NITRO_CLUSTER_WORKERS} workers..."
node ui/server/index.mjs &

# Start Nginx
echo "[nginx] starting..."
exec nginx -e stderr -g "daemon off;"