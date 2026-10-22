#!/usr/bin/env bash
# Växlar mellan din lokala kopia av modulen och den som Foundry har hämtat från GitHub.
#
#   ledger-switch.sh local    länkar Foundrys modulmapp till din lokala kopia (ändringar syns direkt, ladda om med F5)
#   ledger-switch.sh github   tar bort länken och ställer tillbaka den installerade versionen från GitHub
#   ledger-switch.sh status   visar vilket läge du är i
#
# Ändra de två sökvägarna nedan om de inte stämmer, eller sätt dem som miljövariabler när du kör scriptet.

FOUNDRY_MODULES="${FOUNDRY_MODULES:-$HOME/.local/share/FoundryVTT/Data/modules}"
LOCAL_MODULE="${LOCAL_MODULE:-$HOME/Projects/feature-finance-twodsix/modules/twodsix-ledger}"

set -euo pipefail

link="$FOUNDRY_MODULES/twodsix-ledger"
saved="$FOUNDRY_MODULES/twodsix-ledger.github"

[ -d "$FOUNDRY_MODULES" ] || { echo "Hittar inte $FOUNDRY_MODULES (sätt FOUNDRY_MODULES)" >&2; exit 1; }
[ -f "$LOCAL_MODULE/module.json" ] || { echo "Hittar inte $LOCAL_MODULE/module.json (sätt LOCAL_MODULE)" >&2; exit 1; }

case "${1:-status}" in
  local)
    if [ -L "$link" ]; then
      ln -sfn "$LOCAL_MODULE" "$link"
    else
      if [ -e "$link" ]; then
        [ ! -e "$saved" ] || { echo "$saved finns redan, flytta bort den först." >&2; exit 1; }
        mv "$link" "$saved"
      fi
      ln -s "$LOCAL_MODULE" "$link"
    fi
    echo "Lokalt läge: $link -> $LOCAL_MODULE"
    echo "Ladda om Foundry med F5."
    ;;
  github)
    if [ -L "$link" ]; then
      rm "$link"
    fi
    if [ -d "$saved" ]; then
      mv "$saved" "$link"
      echo "GitHub-läge: den hämtade versionen är tillbaka ($(jq -r .version "$link/module.json" 2>/dev/null || echo '?'))."
    else
      echo "GitHub-läge: länken är borta, men ingen hämtad version fanns sparad."
      echo "Installera modulen i Foundry med manifest-URL:en."
    fi
    echo "Ladda om Foundry med F5."
    ;;
  status)
    if [ -L "$link" ]; then
      echo "Lokalt läge: $link -> $(readlink "$link") (version $(jq -r .version "$link/module.json"))"
    elif [ -d "$link" ]; then
      echo "GitHub-läge: version $(jq -r .version "$link/module.json")"
    else
      echo "Modulen är inte installerad i $FOUNDRY_MODULES"
    fi
    ;;
  *)
    echo "Använd: $0 local | github | status" >&2
    exit 1
    ;;
esac
