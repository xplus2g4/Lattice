#!/usr/bin/env bash
#
# Deploy a git ref to the VM: fast-forward the checkout, build both images there, run the
# migration as its own step, then restart the stack. Run from anywhere on a machine with
# gcloud access to the project; nothing is built locally.
#
#   scripts/deploy.sh          # origin/main
#   scripts/deploy.sh v0.3.0   # any ref origin knows
#
# Expects the VM prepared by server/ops/vm-setup.sh (Docker, repo at ~/lattice, .env).

set -euo pipefail

REF=${1:-main}
VM=${LATTICE_VM:-lattice}
ZONE=${LATTICE_ZONE:-asia-southeast1-b}
PROJECT=${LATTICE_PROJECT:-jianxi-experiments}

remote=$(cat <<EOF
set -euo pipefail
cd ~/lattice
git fetch --quiet origin
git checkout --quiet --detach "origin/${REF}" 2>/dev/null || git checkout --quiet --detach "${REF}"
echo "deploying \$(git log -1 --format='%h %s')"
cd server
compose="docker compose -f compose.yaml -f compose.prod.yaml"
\$compose build --pull
\$compose up -d postgres
\$compose run --rm --no-deps -e DATABASE_AUTO_MIGRATE=false api alembic upgrade head
\$compose up -d --remove-orphans
# The Caddyfile is a bind mount, so a changed file does not recreate the container.
\$compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
docker image prune -f >/dev/null
\$compose ps
EOF
)

exec gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap \
  --command "$remote"
