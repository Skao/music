#!/usr/bin/env bash
# Copy the server to the box and restart the service.
# Run from the repository root on the PC (Git Bash is fine):
#
#   bash server/deploy/push.sh root@music.catchweir.com
#
# The first time, follow it with setup.sh on the box (see that file). Later runs just update the
# code, reinstall Python dependencies if requirements changed, and restart. The model checkpoint
# cached under /var/lib/pianoscribe stays.
set -euo pipefail
TARGET="${1:?usage: push.sh <user@host>}"
cd "$(dirname "$0")/../.."
[ -f server/pianoscribe_server.py ] || { echo "run from the repository root"; exit 1; }
tar -czf - server/pianoscribe_server.py server/cli.py server/requirements.txt server/.env.example server/deploy \
  | ssh "$TARGET" 'set -e; mkdir -p /opt/pianoscribe && tar -xzf - -C /opt/pianoscribe
    if id pianoscribe >/dev/null 2>&1 && [ -x /opt/pianoscribe/venv/bin/pip ]; then
      chown -R pianoscribe:pianoscribe /opt/pianoscribe
      sudo -u pianoscribe /opt/pianoscribe/venv/bin/pip install -q -r /opt/pianoscribe/server/requirements.txt
      systemctl restart pianoscribe && sleep 3 && curl -fsS http://127.0.0.1:8765/health && echo
    else
      echo ">> Code copied. Now on the box: bash /opt/pianoscribe/server/deploy/setup.sh music.catchweir.com"
    fi'
