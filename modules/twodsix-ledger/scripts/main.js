/**
 * Twodsix Ledger: a transaction ledger for the Finances tab of the Twodsix traveller sheet.
 */

import { MODULE_ID, recordLedgerAdjustments } from "./store.js";
import { createLedgerSheet, findSystemTravellerSheet } from "./sheet.js";
import { applyConfig, registerSettings } from "./settings.js";
import { getFinanceValueFixes, parseLocaleNumber } from "./financeText.js";

/**
 * Register the ledger sheet as the default traveller sheet. Foundry fills in its sheet registry (which is where the
 * system's own sheet class is found) after the `setup` hook has run, so this is done when the game is ready.
 */
function registerLedgerSheet() {
  const SystemSheet = findSystemTravellerSheet();
  if (!SystemSheet) {
    console.error(`${MODULE_ID} | Could not find the Twodsix traveller sheet, so the ledger sheet is not registered.`);
    return;
  }
  console.info(`${MODULE_ID} | Registering the ledger sheet on top of`, SystemSheet.name);
  foundry.documents.collections.Actors.registerSheet(MODULE_ID, createLedgerSheet(SystemSheet), {
    types: ["traveller"],
    label: "TWODSIX_LEDGER.SHEET_NAME",
    makeDefault: true
  });
}

Hooks.once("init", registerSettings);
// World settings are available from `setup`; the ledger uses the saved accounts and categories from then on
Hooks.once("setup", applyConfig);
Hooks.once("ready", () => {
  applyConfig();
  registerLedgerSheet();
});

/** Balance changes made outside the ledger (typing in a field, a macro, another module) get an adjustment entry. */
Hooks.on("preUpdateActor", (actor, data, options) => {
  recordLedgerAdjustments(actor, data, options);
});

/** Characters from chargen or imports can have finance text without the matching numbers. */
Hooks.on("preCreateActor", actor => {
  if (actor.type !== "traveller") {
    return;
  }
  const fixes = getFinanceValueFixes(actor.system.finances, actor.system.financeValues, parseLocaleNumber);
  if (!foundry.utils.isEmpty(fixes)) {
    actor.updateSource({"system.financeValues": fixes});
  }
});

/** One-time fill-in of the numbers for travellers that already exist. Numbers that are not 0 are never changed. */
Hooks.once("ready", async () => {
  if (!game.user.isGM) {
    return;
  }
  game.settings.register(MODULE_ID, "financeValuesSynced", {scope: "world", config: false, type: Boolean, default: false});
  if (game.settings.get(MODULE_ID, "financeValuesSynced")) {
    return;
  }
  for (const actor of game.actors.filter(candidate => candidate.type === "traveller")) {
    const fixes = getFinanceValueFixes(actor.system._source.finances, actor.system._source.financeValues, parseLocaleNumber);
    if (!foundry.utils.isEmpty(fixes)) {
      await actor.update({"system.financeValues": fixes}, {twodsixLedger: true});
    }
  }
  await game.settings.set(MODULE_ID, "financeValuesSynced", true);
});
