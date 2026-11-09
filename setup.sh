#!/usr/bin/env bash
# Paper - avvio del wizard su Linux:  ./setup.sh
# Se manca Node.js (serve per il wizard) chiede il permesso e lo installa.
set -euo pipefail
cd "$(dirname "$0")"

node_major() {
  if command -v node >/dev/null 2>&1; then node -p 'process.versions.node.split(".")[0]'; else echo 0; fi
}

if [ "$(node_major)" -lt 20 ]; then
  echo
  echo "  Node.js 20+ non trovato: serve per far partire il wizard."
  . /etc/os-release
  case "${ID:-} ${ID_LIKE:-}" in
    *fedora*|*rhel*) CMD="sudo dnf install -y nodejs npm" ;;
    *debian*|*ubuntu*) CMD="curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs" ;;
    *arch*) CMD="sudo pacman -S --needed --noconfirm nodejs npm" ;;
    *) echo "  Installa Node.js 20+ (https://nodejs.org) e rilancia ./setup.sh"; exit 1 ;;
  esac
  echo "  Comando: $CMD"
  read -rp "  Lo installo io? [S/n] " answer
  if [[ -n "$answer" && ! "$answer" =~ ^[sSyY] ]]; then exit 1; fi
  bash -c "$CMD"
fi

exec node scripts/wizard.mjs "$@"
