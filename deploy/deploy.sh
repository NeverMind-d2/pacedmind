#!/bin/sh
# Deploys the hosted web app, the public site and docs when they are built, the Caddy config, and the timer that
# keeps the site's GitHub star count, to the VPS set up by deploy/provision.sh. Run from the repository (Git Bash
# on Windows):
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
# app without uploading site/out or docs/out. It refuses a checkout that doesn't contain master or has
# uncommitted changes (as scripts/landed.mjs does for installs and releases); ALLOW_UNLANDED=1 skips that,
# for a test.
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

# Every deploy replaces what's live with this checkout, so one that doesn't contain master takes work that already
# landed there off the server, and uncommitted work would go live without being in git. A copy without git, or
# without a master branch, isn't checked.
if [ -z "${ALLOW_UNLANDED:-}" ] && git -C "$root" rev-parse --verify --quiet master >/dev/null 2>&1; then
  if ! git -C "$root" merge-base --is-ancestor master HEAD; then
    echo "This checkout doesn't contain master, so it would take work that already landed there off the server." >&2
    echo "Merge master into it first, or use ALLOW_UNLANDED=1 for a test." >&2
    exit 1
  fi
  if [ -n "$(git -C "$root" status --porcelain)" ]; then
    echo "This checkout has uncommitted changes, which would go live without being in git." >&2
    echo "Commit them first, or use ALLOW_UNLANDED=1 for a test." >&2
    exit 1
  fi
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

# Caddy is restarted, never reloaded: after a reload, Caddy 2.6.2 keeps answering HTTP/3 (QUIC) connections without
# serving them, so browsers that use HTTP/3 hang on every page while curl, on HTTP/1.1 and HTTP/2, sees nothing wrong
# (2026-09-27). A restart drops the requests in flight for about a second, so it happens only when the config changed.
echo "> Caddy"
snippet=app.caddy
if [ -n "$PLACEHOLDER" ]; then snippet=app-placeholder.caddy; fi
tar -C "$root/deploy" -czf - Caddyfile "$snippet" |
  remote "set -e
    rm -rf /tmp/pacedmind-caddy && mkdir /tmp/pacedmind-caddy && tar -xzf - -C /tmp/pacedmind-caddy
    cd /tmp/pacedmind-caddy
    if [ $snippet != app.caddy ]; then mv $snippet app.caddy; fi
    sudo caddy validate --config Caddyfile --adapter caddyfile >/dev/null
    if cmp -s Caddyfile /etc/caddy/Caddyfile && cmp -s app.caddy /etc/caddy/app.caddy && systemctl is-active --quiet caddy; then
      echo 'Unchanged, left running'
    else
      if [ -f /etc/caddy/Caddyfile ]; then sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.old; fi
      sudo install -m 644 Caddyfile app.caddy /etc/caddy/
      sudo systemctl enable caddy >/dev/null 2>&1
      sudo systemctl restart caddy
    fi"

# The site's GitHub star count, which the server copies every ten minutes (github-stars.mjs) and Caddy serves as
# /github.json. Nothing else depends on it, so a failure here only warns: the page keeps the count from its build.
echo "> GitHub star count"
if ! tar -C "$root/deploy" -czf - github-stars.mjs pacedmind-github.service pacedmind-github.timer |
  remote "set -e
    rm -rf /tmp/pacedmind-github && mkdir /tmp/pacedmind-github && tar -xzf - -C /tmp/pacedmind-github
    cd /tmp/pacedmind-github
    sudo install -d -o pacedmind -g pacedmind /srv/pacedmind/github
    sudo install -D -m 644 github-stars.mjs /usr/local/lib/pacedmind/github-stars.mjs
    sudo install -m 644 pacedmind-github.service pacedmind-github.timer /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now pacedmind-github.timer >/dev/null 2>&1
    sudo systemctl start pacedmind-github.service"; then
  echo "The star count didn't update; see: journalctl -u pacedmind-github" >&2
fi

echo "> Checking"
sleep 3
if [ -n "$PLACEHOLDER" ]; then
  remote 'systemctl is-active caddy'
else
  # The app answers only to its public name (ORGANIZER_PUBLIC_ORIGIN in the unit).
  remote 'systemctl is-active pacedmind-web caddy; curl -s -o /dev/null -H "Host: app.pacedmind.com" -w "app on 127.0.0.1:3000: %{http_code}\n" http://127.0.0.1:3000/login'
fi
# printf for the newline: Git Bash turns a backslash in curl's -w argument into a slash.
for url in https://pacedmind.com/ https://pacedmind.com/docs https://app.pacedmind.com/ https://pacedmind.com/github.json; do
  printf '%s: %s\n' "$url" "$(curl -s -o /dev/null -w '%{http_code}' "$url" || echo 'no answer')"
done
