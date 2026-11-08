#!/usr/bin/env bash
# Växlar mellan det twodsix-system som Foundry har installerat och ett bygge av din egen utcheckning (till exempel för att
# prova en pull request). Det här gäller SYSTEMET (Data/systems/twodsix), inte ledger-modulen, som växlas med ledger-switch.sh.
#
#   system-switch.sh build       bygger din utcheckning till dist/ (pnpm run build:develop)
#   system-switch.sh dist        länkar Foundrys twodsix-mapp till dist/ och sparar den installerade som twodsix.orig
#   system-switch.sh installed   tar bort länken och ställer tillbaka den installerade versionen
#   system-switch.sh status      visar vilket läge du är i
#
# Stäng Foundry först, och starta om den helt efteråt (inte bara F5). Världar som öppnas med ett utvecklingsbygge kan
# migreras till det, så prova i en testvärld eller med en säkerhetskopia.
# Utcheckningen är den som scriptet ligger i (modules/twodsix-ledger/dev ligger tre steg under roten).

FOUNDRY_SYSTEMS="${FOUNDRY_SYSTEMS:-$HOME/.local/share/FoundryVTT/Data/systems}"
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"

set -euo pipefail

link="$FOUNDRY_SYSTEMS/twodsix"
saved="$FOUNDRY_SYSTEMS/twodsix.orig"

[ -d "$FOUNDRY_SYSTEMS" ] || { echo "Hittar inte $FOUNDRY_SYSTEMS (sätt FOUNDRY_SYSTEMS)" >&2; exit 1; }

case "${1:-status}" in
  build)
    cd "$REPO"
    [ -d node_modules ] || pnpm install
    pnpm run build:develop
    echo "Klart: $REPO/dist. Kör nu: $0 dist"
    ;;
  dist)
    [ -f "$REPO/dist/system.json" ] || { echo "Hittar inte $REPO/dist/system.json. Kör '$0 build' först." >&2; exit 1; }
    if [ -L "$link" ]; then
      ln -sfn "$REPO/dist" "$link"
    else
      if [ -e "$link" ]; then
        [ ! -e "$saved" ] || { echo "$saved finns redan, flytta bort den först." >&2; exit 1; }
        mv "$link" "$saved"
      fi
      ln -s "$REPO/dist" "$link"
    fi
    echo "Bygge-läge: $link -> $REPO/dist (gren: $(git -C "$REPO" branch --show-current 2>/dev/null || echo ?))"
    echo "Starta om Foundry helt."
    ;;
  installed)
    if [ -L "$link" ]; then
      rm "$link"
    fi
    if [ -d "$saved" ]; then
      mv "$saved" "$link"
      echo "Installerat läge: den installerade versionen är tillbaka ($(jq -r .version "$link/system.json" 2>/dev/null || echo '?'))."
    else
      echo "Länken är borta, men ingen installerad version fanns sparad. Installera twodsix i Foundry igen."
    fi
    echo "Starta om Foundry helt."
    ;;
  status)
    if [ -L "$link" ]; then
      echo "Bygge-läge: $link -> $(readlink "$link") (version $(jq -r .version "$link/system.json" 2>/dev/null || echo '?'))"
    elif [ -d "$link" ]; then
      echo "Installerat läge: version $(jq -r .version "$link/system.json" 2>/dev/null || echo '?')"
    else
      echo "Twodsix är inte installerat i $FOUNDRY_SYSTEMS"
    fi
    ;;
  *)
    echo "Använd: $0 build | dist | installed | status" >&2
    exit 1
    ;;
esac
