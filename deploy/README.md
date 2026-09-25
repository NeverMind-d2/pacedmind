# Hosting PacedMind

The web app is the same Next.js app as the desktop one, run with `ORGANIZER_MODE=web`: every browser signs in with its own account, and the data is in Supabase. It never opens terminals. Agent sessions started in the browser are queued, and the desktop app signed in to the same account opens them.

The hosted web mode arrives with the cloud migration (branch `pacedmind-cloud`). Until it's merged and launched, `deploy.sh` goes up with `APP_PLACEHOLDER=1`: the site and the docs only (step 3).

The server is an OVH VPS (Ubuntu 26.04, `vps-60cf32b8.vps.ovh.net`, 57.131.192.185). It only accepts SSH keys; the key is `pacedmind_vps` (kept outside the repository). Caddy serves HTTPS and proxies to the app on 127.0.0.1:3000; the public site and the docs are static files next to it.

| Address | What |
| --- | --- |
| `https://app.pacedmind.com` | the web app |
| `https://pacedmind.com` | the public site (`site/out`) |
| `https://pacedmind.com/docs` | the docs (the docs app's static build) |
| `https://pacedmind.com/download/windows`, `/download/mac` | the current desktop installers (step 4) |
| `https://www.pacedmind.com` | redirects to `pacedmind.com` |

## 0. DNS

`pacedmind.com` uses OVH's DNS (ns111/dns111.ovh.net). In the OVH Control Panel, Domain names > pacedmind.com > DNS zone:

| Name | Type | Target |
| --- | --- | --- |
| (empty, the domain itself) | A | `57.131.192.185` (replaces OVH's default 213.186.33.5) |
| `www` | A | `57.131.192.185` (replaces 213.186.33.5) |
| `app` | A | `57.131.192.185` (new) |
| (empty), `www`, `app` | AAAA | `2001:41d0:601:1100::a36d` |

Also turn off OVH's web redirection for the domain (it's the `1|www.pacedmind.com` TXT record). Leave the MX and SPF records alone: they carry the domain's email. Caddy can only get HTTPS certificates once these records point at the server.

## 1. Supabase

In the project's dashboard (Authentication > URL Configuration):

- Site URL: `https://app.pacedmind.com`
- Redirect URLs: `https://app.pacedmind.com/**`, plus `http://127.0.0.1:4319/**` for the desktop app and `http://127.0.0.1:4320/**` for development. (Sign-in links come back to `/auth/callback?next=…`, so exact addresses without the wildcard don't match.)

Apply the schema (`supabase/migrations`) with `npx supabase link --project-ref <ref>` and `npx supabase db push`, or through the Supabase MCP server. Before real users sign up, set up custom SMTP (Authentication > Emails): the built-in sender is rate-limited and meant for testing. The domain already has OVH email, so an address like `noreply@pacedmind.com` through OVH's SMTP server works.

## 2. Set up the server (once)

```bash
ssh -i ~/Desktop/keys/pacedmind_vps ubuntu@57.131.192.185 'sudo sh -s' < deploy/provision.sh
```

It installs Node, npm and Caddy from Ubuntu's repositories and creates the `pacedmind` user with `/srv/pacedmind/{app,site,docs}` and `/srv/pacedmind/web.env`.

## 3. Deploy

Build the static parts first if they should go up too (`npm run build` in `site/` and `docs/`), then, from the repository in Git Bash:

```bash
SUPABASE_URL=https://pyoynjoyhpolijlvoalu.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... deploy/deploy.sh ubuntu@57.131.192.185
```

It uploads the working tree, builds the app on the server, switches `/srv/pacedmind/app` to the new build (the previous one stays in `app.old`), restarts `pacedmind-web`, and uploads `site/out` and `docs/out` when they exist, each replacing the live folder in one step (the previous one stays in `site.old` or `docs.old`). Then it installs `Caddyfile` and `app.caddy` in `/etc/caddy`, once `caddy validate` has accepted them, and reloads Caddy; the previous config stays in `/etc/caddy/Caddyfile.old`. The Supabase variables are only needed the first time (they're kept in `web.env`).

Until the web app launches, deploy only the site and docs, and send `app.pacedmind.com` to the site (`app-placeholder.caddy`):

```bash
APP_PLACEHOLDER=1 deploy/deploy.sh ubuntu@57.131.192.185
```

A checkout without the hosted web mode (`src/server/supabase.ts`) refuses to deploy the app: it would put a planner without sign-in on the internet.

New migrations go out with `npx supabase db push` before a deploy that needs them.

## 4. Release the desktop app

The site's download buttons lead to `/download/windows` and `/download/mac`, which the Caddyfile sends on to `PacedMind-Windows.exe` and `PacedMind-macOS.dmg` in `/srv/pacedmind/download`. `npm run release` builds each one on its own system and uploads it there, so run it once on a PC and once on a Mac (the one-time Mac signing setup is in the repository's README.md):

```bash
npm run release -- ubuntu@57.131.192.185
```

It creates the folder the first time, checks each upload against its checksum before switching to it, and keeps the previous file as `<name>.old`. `deploy.sh` never touches that folder. Until the first release, the buttons end on the site's 404 page.

## Firewall (optional)

Only SSH (22), and Caddy's 80 and 443 once deployed, listen on public addresses. To also block everything else, run on the server:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw --force enable
```

## Files

- `provision.sh`: the one-time server setup.
- `deploy.sh`: builds and switches the app, uploads the static parts, installs the Caddy config.
- `pacedmind-web.service`: the systemd unit (`HOSTNAME=127.0.0.1`, `PORT=3000`, `ORGANIZER_MODE=web`, `TZ=Europe/Warsaw`).
- `Caddyfile`: the server's whole Caddy config, for Caddy 2.6.2 as Ubuntu ships it: HTTPS, `www` and `http://` to `https://pacedmind.com`, one URL per page (no `.html`, no trailing slash), the site's and the docs' 404 pages with a 404 status, caching, and the docs' Markdown copies, search index and navigation files marked `noindex`. The docs need their own `/docs` block because a docs section has both `views.html` and a `views/` folder. `/download/*` serves the installers from `/srv/pacedmind/download` (step 4).
- `app.caddy` and `app-placeholder.caddy`: what `app.pacedmind.com` does, the app or a redirect to the site; `deploy.sh` installs one of them as `/etc/caddy/app.caddy`.

The steps for Google Search Console and Bing Webmaster Tools are in `site/deploy/README.md`.
