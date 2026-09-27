#!/bin/sh
# Installs Umami (cookieless visitor statistics, compose.yml here) on the VPS, or updates it to the
# newest image. Run from the repository in Git Bash:
#
#   scp -i ~/Desktop/keys/pacedmind_vps deploy/umami/compose.yml ubuntu@<server>:/tmp/umami-compose.yml
#   ssh -i ~/Desktop/keys/pacedmind_vps ubuntu@<server> 'sudo sh -s' < deploy/umami/install.sh
#
# Docker comes from Ubuntu's own repositories. The secrets are generated here the first time and stay
# in the root-only /opt/umami/.env; they never leave the server. Umami listens on 127.0.0.1:3001, and
# only Caddy reaches it (deploy/Caddyfile).
set -eu

# Nothing below may read stdin: it's this script.
export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  apt-get -o DPkg::Lock::Timeout=300 update -q </dev/null
  apt-get -o DPkg::Lock::Timeout=300 install -y -q docker.io docker-compose-v2 </dev/null
fi

install -d -m 755 /opt/umami
if [ -f /tmp/umami-compose.yml ]; then
  install -m 644 /tmp/umami-compose.yml /opt/umami/compose.yml
  rm -f /tmp/umami-compose.yml
fi
if [ ! -f /opt/umami/.env ]; then
  (umask 077 && printf 'POSTGRES_PASSWORD=%s\nAPP_SECRET=%s\nTWO_FACTOR_ENCRYPTION_KEY=%s\n' \
    "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" >/opt/umami/.env)
fi

cd /opt/umami
docker compose pull -q </dev/null
docker compose up -d </dev/null

for _ in $(seq 60); do
  # While it starts, the port refuses connections.
  if curl -fs -o /dev/null http://127.0.0.1:3001/api/heartbeat; then
    echo "Umami is up on 127.0.0.1:3001"
    exit 0
  fi
  sleep 2
done
echo "Umami doesn't answer on 127.0.0.1:3001: sudo docker compose -f /opt/umami/compose.yml logs umami" >&2
exit 1
