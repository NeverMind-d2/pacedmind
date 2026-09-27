#!/bin/sh
# One-time setup of the VPS for the hosted PacedMind web app. Run it on the server as a sudoer, e.g.:
#   ssh pacedmind 'sudo sh -s' < deploy/provision.sh      (the ssh alias in deploy/README.md)
# Installs Node and Caddy from Ubuntu's own repositories, and creates the user and folders the service uses.
set -eu

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nodejs npm caddy rsync

# Caddy starts with a demo page on port 80; keep it stopped until deploy.sh gives it the real Caddyfile.
systemctl disable --now caddy

id pacedmind >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/pacedmind --shell /usr/sbin/nologin pacedmind
# Ubuntu makes home folders private; Caddy (its own user) must pass through to serve site/ and docs/.
chmod 711 /srv/pacedmind
install -d -o pacedmind -g pacedmind /srv/pacedmind/app /srv/pacedmind/site /srv/pacedmind/docs
touch /srv/pacedmind/web.env
chown root:pacedmind /srv/pacedmind/web.env
chmod 640 /srv/pacedmind/web.env

echo "Node $(node --version), npm $(npm --version), $(caddy version | cut -d' ' -f1)"
echo "Next: put SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in /srv/pacedmind/web.env, then run deploy/deploy.sh."
