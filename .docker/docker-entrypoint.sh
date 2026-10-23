#!/bin/bash
set -e

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

writable() { touch "$1/.write-test-$$" 2>/dev/null && rm -f "$1/.write-test-$$"; }

writable /data/storage || fail_permissions /data/storage writable ./storage
# Backups are optional: an unwritable folder (e.g. a bind mount Docker created as root) only disables them.
if [ -d "${BACKUP_DIR:-}" ] && ! writable "$BACKUP_DIR"; then
    echo "[startup] WARNING: $BACKUP_DIR is not writable, backups will fail. Fix with: sudo chown -R $OWNER ./backups" >&2
fi

TRUSTED_PROXIES="${TRUSTED_PROXIES:-127.0.0.1 ::1}"
for proxy in ${TRUSTED_PROXIES//,/ }; do
    echo "set_real_ip_from ${proxy//[^0-9A-Fa-f.:\/]/};"
done > /etc/nginx/real-ip.conf

RATE_LIMIT_KEY='$binary_remote_addr'
[ "${RATE_LIMITS:-on}" = "off" ] && RATE_LIMIT_KEY='""'
echo "map \$remote_addr \$rl_key { default $RATE_LIMIT_KEY; }" > /etc/nginx/rate-limit.conf

# Mount real certs at /etc/nginx/ssl/cert.pem and key.pem; without them a self-signed one is generated.
SSL=/etc/nginx/ssl
if [ -f $SSL/cert.pem ] && [ -f $SSL/key.pem ]; then
    [ -r $SSL/cert.pem ] && [ -r $SSL/key.pem ] || fail_permissions $SSL readable ./ssl
else
    writable $SSL || fail_permissions $SSL writable ./ssl
    # SSL_DNS_NAMES (comma-separated) adds names callers reach the container under (the e2e harness does).
    SAN="DNS:localhost,IP:127.0.0.1"
    for name in ${SSL_DNS_NAMES//,/ }; do SAN="$SAN,DNS:$name"; done
    echo "[nginx] no TLS certificate found, generating a self-signed one (SAN: $SAN)"
    # CA:TRUE so the cert can be installed as a trust anchor; it signs only
    # itself, and nothing trusts it unless someone explicitly adds it.
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout $SSL/key.pem -out $SSL/cert.pem \
        -subj "/CN=gripello/O=Gripello/C=DE" \
        -addext "subjectAltName=$SAN" \
        -addext "basicConstraints=critical,CA:TRUE" \
        2>/dev/null
fi

# Bash as PID 1 forwards docker stop to every process (QUIT is nginx's graceful stop); any process exiting stops the container.
stop_all() {
    # Nuxt's whole process group: Nitro's cluster primary waits for its workers on SIGTERM but never signals them.
    kill -TERM $API_PID -$UI_PID 2>/dev/null || true
    kill -QUIT $NGINX_PID 2>/dev/null || true
}
trap stop_all TERM INT

gripello serve --http=:8080 &
API_PID=$!

CPUS="$(nproc)"
# nproc ignores a container CPU quota (docker --cpus), cgroup v2 exposes it here
if read -r QUOTA PERIOD < /sys/fs/cgroup/cpu.max 2>/dev/null && [ "$QUOTA" != "max" ]; then
    CPUS=$(( (QUOTA + PERIOD - 1) / PERIOD ))
fi
WORKERS=$(( CPUS < 2 ? 1 : CPUS / 2 ))
export NITRO_CLUSTER_WORKERS="${NITRO_CLUSTER_WORKERS:-$(( WORKERS > 8 ? 8 : WORKERS ))}"
setsid node ui/server/index.mjs &
UI_PID=$!

# Until both listen, visitors get a refused connection (the service worker's offline fallback) instead of a 502.
for port in 8080 3000; do
    until (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; do
        # one kill -0 per pid: with several it succeeds while any one of them is alive
        kill -0 $API_PID 2>/dev/null && kill -0 $UI_PID 2>/dev/null || break 2
        sleep 0.05
    done
done

nginx -e stderr -g "daemon off;" &
NGINX_PID=$!

wait -n || true
stop_all
wait