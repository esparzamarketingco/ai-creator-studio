#!/bin/sh
# Hosted disks are often mounted root-owned over /app/.storage. Started as root, hand the storage
# directory to the unprivileged `node` user, then drop privileges before running the app.
set -e
STORAGE="${STORAGE_DIR:-./.storage}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$STORAGE"
  chown node:node "$STORAGE"
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
