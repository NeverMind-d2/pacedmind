#!/bin/sh
# Deploys the hosted web app, the public site and docs when they are built, and the Caddy config to the
# VPS set up by deploy/provision.sh. Run from the repository (Git Bash on Windows):
#
#   deploy/deploy.sh ubuntu@<server>
#
# The app is built on the server (its dependencies include Linux binaries). The site and docs are static:
# build them first (npm run build in site/ and docs/); each out/ folder goes up whole and replaces the
# live one in one step (the previous one stays as site.old or docs.old). deploy/Caddyfile, the whole
# server config with its host names, replaces the live one only after `caddy validate` accepts it.
# PACEDMIND_KEY overrides the SSH key; SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, when set, are written
# to the server's /srv/pacedmind/web.env. APP_PLACEHOLDER=1, only before the app launches, leaves the app
# out and redirects app.pacedmind.com to the site for now (deploy/app-placeholder.caddy); once the app
# runs, it refuses. Several sessions may share a checkout, each with unfinished work in it: SITE_ONLY=1
# uploads the site, docs and Caddy config and leaves the running app alone, and APP_ONLY=1 rebuilds the
# app without uploading site/out or docs/out.
set -eu

SERVER=${1:?"usage: deploy/deploy.sh user@server"}
KEY=${PACEDMIND_KEY:-$HOME/Desktop/keys/pacedmind_vps}
PLACEHOLDER=${APP_PLACEHOLDER:-}
SITE_ONLY=${SITE_ONLY:-}
APP_ONLY=${APP_ONLY:-}
root=$(cd "$(dirname "$0")/.." && pwd)
remote() { ssh -i "$KEY" -o BatchMode=yes "$SERVER" "$@"; }

if [ -n "$SITE_ONLY" ] && { [ -n "$APP_ONLY" ] || [ -n "$PLACEHOLDER" ]; }; then
  echo "SITE_ONLY=1 goes alone: it leaves the app as it runs." >&2
  exit 1
fi
if [ -n "$SITE_ONLY" ] && ! remote 'systemctl is-active --quiet pacedmind-web'; then
  echo "SITE_ONLY=1 keeps the running app, but pacedmind-web isn't running." >&2
  exit 1
fi

# Only a checkout with the hosted mode (accounts, no terminals for browsers) may go up as the web app:
# an older one would put a single-user planner without sign-in on the internet.
if [ -z "$PLACEHOLDER" ] && [ -z "$SITE_ONLY" ] && [ ! -f "$root/src/server/supabase.ts" ]; then
  echo "This checkout has no hosted web mode (src/server/supabase.ts). Merge master into it first." >&2
  exit 1
fi

# Once the web app runs, the placeholder would hide it behind a redirect to the site.
if [ -n "$PLACEHOLDER" ] && remote 'systemctl is-active --quiet pacedmind-web'; then
  echo "The web app is live at app.pacedmind.com, and APP_PLACEHOLDER=1 would hide it. Deploy without it," >&2
  echo "from a checkout with current master: every deploy rebuilds the app from the checkout." >&2
  exit 1
fi

if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_PUBLISHABLE_KEY:-}" ]; then
  echo "> Writing web.env"
  printf 'SUPABASE_URL=%s\nSUPABASE_PUBLISHABLE_KEY=%s\n' "$SUPABASE_URL" "$SUPABASE_PUBLISHABLE_KEY" |
    remote 'sudo tee /srv/pacedmind/web.env >/dev/null'
fi

if [ -z "$PLACEHOLDER" ] && [ -z "$SITE_ONLY" ]; then
echo "> Uploading the app"
# The working tree without dependencies, builds, local data, or the separate site and docs projects.
tar -C "$root" -czf - --exclude=./node_modules --exclude=./.next --exclude=./data --exclude=./dist --exclude=./.git \
  --exclude=./.claude --exclude=./site --exclude=./docs --exclude='./.env*' . |
  remote 'sudo -u pacedmind sh -c "cd /srv/pacedmind && rm -rf app.new && mkdir app.new && tar -xzf - -C app.new"'

echo "> Building on the server"
remote 'cd /srv/pacedmind/app.new && sudo -u pacedmind npm ci --no-audit --no-fund && sudo -u pacedmind npm run build &&
  sudo -u pacedmind cp -r .next/static .next/standalone/.next/static && sudo -u pacedmind cp -r public .next/standalone/public'

echo "> Switching to the new build"
remote 'set -e
  cd /srv/pacedmind
  sudo rm -rf app.old
  if [ -d app/.next ]; then sudo mv app app.old; else sudo rm -rf app; fi
  sudo mv app.new app
  sudo cp app/deploy/pacedmind-web.service /etc/systemd/system/pacedmind-web.service
  sudo systemctl daemon-reload
  sudo systemctl enable pacedmind-web >/dev/null 2>&1
  sudo systemctl restart pacedmind-web'
fi

for part in site docs; do
  if [ -z "$APP_ONLY" ] && [ -d "$root/$part/out" ]; then
    echo "> Uploading $part/out"
    tar -C "$root/$part/out" -czf - . |
      remote "sudo -u pacedmind sh -c 'set -e; cd /srv/pacedmind; rm -rf $part.new; mkdir $part.new; tar -xzf - -C $part.new
        rm -rf $part.old; if [ -d $part ]; then mv $part $part.old; fi; mv $part.new $part'"
  fi
done

echo "> Caddy"
snippet=app.caddy
if [ -n "$PLACEHOLDER" ]; then snippet=app-placeholder.caddy; fi
tar -C "$root/deploy" -czf - Caddyfile "$snippet" |
  remote "set -e
    rm -rf /tmp/pacedmind-caddy && mkdir /tmp/pacedmind-caddy && tar -xzf - -C /tmp/pacedmind-caddy
    cd /tmp/pacedmind-caddy
    if [ $snippet != app.caddy ]; then mv $snippet app.caddy; fi
    sudo caddy validate --config Caddyfile --adapter caddyfile >/dev/null
    if [ -f /etc/caddy/Caddyfile ]; then sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.old; fi
    sudo install -m 644 Caddyfile app.caddy /etc/caddy/
    sudo systemctl enable caddy >/dev/null 2>&1
    sudo systemctl reload-or-restart caddy"

echo "> Checking"
sleep 3
if [ -n "$PLACEHOLDER" ]; then
  remote 'systemctl is-active caddy'
else
  # The app answers only to its public name (ORGANIZER_PUBLIC_ORIGIN in the unit).
  remote 'systemctl is-active pacedmind-web caddy; curl -s -o /dev/null -H "Host: app.pacedmind.com" -w "app on 127.0.0.1:3000: %{http_code}\n" http://127.0.0.1:3000/login'
fi
# printf for the newline: Git Bash turns a backslash in curl's -w argument into a slash.
for url in https://pacedmind.com/ https://pacedmind.com/docs https://app.pacedmind.com/; do
  printf '%s: %s\n' "$url" "$(curl -s -o /dev/null -w '%{http_code}' "$url" || echo 'no answer')"
done
