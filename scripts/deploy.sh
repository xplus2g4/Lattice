#!/usr/bin/env bash
#
# Deploy a git ref to the VM: fast-forward the checkout, build both images there, run the
# migration as its own step, then restart the stack. Run from anywhere on a machine with
# gcloud access to the project; nothing is built locally.
#
#   scripts/deploy.sh            # origin/main
#   scripts/deploy.sh v0.3.0     # any ref origin knows
#   scripts/deploy.sh --setup    # once, on a fresh VM: git, Docker, the clone
#
# The target comes from .env.deploy at the repo root (.env.deploy.example lists the keys).
# After --setup, write server/.env on the VM from server/.env.production.example.

set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
[[ -f "$root/.env.deploy" ]] || { echo ".env.deploy is missing; copy .env.deploy.example" >&2; exit 1; }
set -a; . "$root/.env.deploy"; set +a
: "${LATTICE_PROJECT:?}" "${LATTICE_ZONE:?}" "${LATTICE_VM:?}" "${LATTICE_REPO:?}"

ssh_vm() {
  gcloud compute ssh "$LATTICE_VM" --zone "$LATTICE_ZONE" --project "$LATTICE_PROJECT" \
    --tunnel-through-iap --quiet --command "$1"
}

if [[ ${1:-} == --setup ]]; then
  exec ssh_vm "sudo LATTICE_REPO='$LATTICE_REPO' bash -s" < "$root/server/ops/vm-setup.sh"
fi

REF=${1:-main}
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
# The Caddy config directory is a bind mount; a changed file needs a reload, not a recreate.
\$compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
docker image prune -f >/dev/null
\$compose ps
EOF
)

exec ssh_vm "$remote"
