#!/usr/bin/env bash
#
# One-time preparation of a fresh Debian 12 GCE VM. Piped over SSH by
# `scripts/deploy.sh --setup`, since the checkout does not exist yet; LATTICE_REPO is the
# public clone URL it passes through sudo.
#
# Installs git and Docker (Docker's apt repository), lets the invoking user drive Docker,
# and clones the repo to ~/lattice. Idempotent. `.env` is written by hand after this
# from .env.production.example, then scripts/deploy.sh does the rest from the laptop.

set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
user=${SUDO_USER:?run with sudo, not as root}
repo_url=${LATTICE_REPO:?set LATTICE_REPO to the public clone URL}
home=$(getent passwd "$user" | cut -d: -f6)

if ! command -v docker >/dev/null; then
  apt-get update -q
  apt-get install -y -q ca-certificates curl git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker "$user"

# Docker's default json-file logs grow without bound; the stack's JSON log lines are chatty.
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "5" } }
EOF
systemctl restart docker

echo "docker $(docker --version | cut -d' ' -f3) ready; ${user} is in the docker group (re-login to pick it up)"

if [[ ! -d "${home}/lattice/.git" ]]; then
  sudo -u "$user" git clone --quiet "$repo_url" "${home}/lattice"
fi
