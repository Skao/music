#!/usr/bin/env bash
# One-time setup of an Ubuntu 24.04 box as the Pianoscribe transcription server. Run as root AFTER
# push.sh has put the code in /opt/pianoscribe:
#
#   bash /opt/pianoscribe/server/deploy/setup.sh music.catchweir.com
#
# It installs Python, ffmpeg and Caddy, makes the `pianoscribe` user, a 2 GB swap file, a venv with
# CPU-only torch and the model package, writes /etc/pianoscribe/music.env with a fresh random token,
# installs the systemd unit, adds the host to Caddy (appending, so it can share a box with the road
# server), opens the firewall, and starts everything. Safe to run again.
#
# Sizing: CPU inference of the ByteDance model peaks around 1.2-1.5 GB. A 2 GB box runs it without
# touching swap; on the 1 GB roads box it will work for short recordings but lean on swap and slow
# the road server while a transcription runs. PIANOSCRIBE_MODEL=basicpitch in the env file is the
# light alternative (set it, pip install basic-pitch into the venv, restart).
set -euo pipefail
HOST_NAME="${1:?usage: setup.sh <host name, e.g. music.catchweir.com>}"
APP=/opt/pianoscribe
DEPLOY=$APP/server/deploy
VENV=$APP/venv
[ -f "$APP/server/pianoscribe_server.py" ] || { echo "No code at $APP: run push.sh from the PC first."; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw \
  python3 python3-venv python3-pip ffmpeg libsndfile1

if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id pianoscribe >/dev/null 2>&1 || useradd --system --home-dir /var/lib/pianoscribe --shell /usr/sbin/nologin pianoscribe
mkdir -p /var/lib/pianoscribe /etc/pianoscribe
chown -R pianoscribe:pianoscribe /var/lib/pianoscribe "$APP"

if [ ! -x "$VENV/bin/pip" ]; then
  sudo -u pianoscribe python3 -m venv "$VENV"
fi
sudo -u pianoscribe "$VENV/bin/pip" install -q --upgrade pip
sudo -u pianoscribe "$VENV/bin/pip" install -q torch --index-url https://download.pytorch.org/whl/cpu
sudo -u pianoscribe "$VENV/bin/pip" install -q -r "$APP/server/requirements.txt"

if [ ! -f /etc/pianoscribe/music.env ]; then
  TOKEN=$(openssl rand -hex 24)
  sed -e "s/^PIANOSCRIBE_TOKEN=.*/PIANOSCRIBE_TOKEN=$TOKEN/" "$APP/server/.env.example" | tr -d '\r' > /etc/pianoscribe/music.env
  chmod 640 /etc/pianoscribe/music.env && chown root:pianoscribe /etc/pianoscribe/music.env
  echo ">> Token for the app (also in /etc/pianoscribe/music.env): $TOKEN"
fi

install -m 644 "$DEPLOY/pianoscribe.service" /etc/systemd/system/pianoscribe.service

# Caddy: add this host's block if the Caddyfile does not already mention it.
mkdir -p /etc/caddy
touch /etc/caddy/Caddyfile
if ! grep -q "^$HOST_NAME" /etc/caddy/Caddyfile; then
  { echo; sed "s/^MUSIC_HOST /$HOST_NAME /" "$DEPLOY/Caddyfile"; } >> /etc/caddy/Caddyfile
fi

ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw --force enable >/dev/null

systemctl daemon-reload
systemctl enable --now pianoscribe caddy
systemctl restart pianoscribe
systemctl reload caddy || systemctl restart caddy
sleep 3
curl -fsS http://127.0.0.1:8765/health && echo
echo ">> Up. First transcription downloads the model checkpoint (~165 MB) and takes a minute longer."
echo ">> Service URL for the app: https://$HOST_NAME   logs: journalctl -u pianoscribe -f"
