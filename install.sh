#!/bin/sh
# Bygger Agentic Desktop fra kildekoden og legger appen i appbiblioteket for brukeren din:
#   ~/.local/opt/agentic-desktop, ~/.local/share/applications og ~/.local/share/icons.
# Uten sudo. Trådene og innstillingene dine i ~/.local/share/agentic-desktop og
# ~/.config/agentic-desktop blir ikke rørt.
#
#   ./install.sh               bygg og installer
#   ./install.sh --uninstall   fjern appen igjen (dataene dine blir liggende)
set -eu
cd "$(dirname -- "$(readlink -f -- "$0")")"

if [ "${1:-}" = --uninstall ]; then
  exec node scripts/install-local.ts --uninstall
fi

feil() { echo "Feil: $*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || feil "fant ikke Node. Agentic Desktop trenger Node 26 eller nyere."
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 26 ] || feil "Node $(node --version) er for gammel. Agentic Desktop trenger Node 26 eller nyere."
mangler=""
for verktoy in g++ make python3; do
  command -v "$verktoy" >/dev/null 2>&1 || mangler="$mangler $verktoy"
done
[ -z "$mangler" ] || feil "mangler$mangler. Installer med: sudo apt install build-essential python3"
command -v rg >/dev/null 2>&1 || echo "Merk: ripgrep (rg) mangler. Søk og @-menyen blir tregere. Installer med: sudo apt install ripgrep"

echo "1/4 Henter avhengigheter (npm ci)…"
npm ci
echo "2/4 Bygger grensesnittet…"
npm run build
echo "3/4 Pakker Electron-appen…"
npm run dist
echo "4/4 Installerer i appbiblioteket…"
node scripts/install-local.ts
echo
echo "Ferdig. Finn «Agentic Desktop» i Vis apper."
