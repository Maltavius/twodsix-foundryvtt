/**
 * Twodsix Ledger: a transaction ledger for the Finances tab of the Twodsix traveller sheet.
 */

import { MODULE_ID, hasPendingChargenImport, importChargenFinances, recordLedgerAdjustments } from "./store.js";
import { CHARGEN_MODULE_ID as CHARGEN_FLAG_SCOPE, chooseImporterId } from "./chargenImport.js";
import { createLedgerSheet, findSystemTravellerSheet } from "./sheet.js";
import { applyConfig, registerSettings } from "./settings.js";
import { getCleanFinanceTexts, getFinanceValueFixes, parseLocaleNumber } from "./financeText.js";

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
  keepFinanceTextClean(actor, data);
});

/**
 * The system rewrites a finance text whenever its number changes, and with a space as thousands separator (Swedish,
 * French, ...) it misreads its own text and adds a group of digits to the end every time. This writes a clean text
 * after the system has made its change. See formatFinanceText.
 */
function keepFinanceTextClean(actor, data) {
  if (actor.type !== "traveller") {
    return;
  }
  const source = actor.system._source;
  const texts = getCleanFinanceTexts(data, source.finances, source.financeValues, game.i18n.lang);
  if (!foundry.utils.isEmpty(texts)) {
    foundry.utils.setProperty(data, "system.finances", {...data.system?.finances, ...texts});
  }
}

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

/**
 * Money from the MgT2e character generation module is imported into the ledger once. Only one client does it for an
 * actor: the GM if one is online, otherwise the online owner with the lowest id. The marker flag is checked again just
 * before importing.
 */
async function importChargenFor(actor) {
  if (!hasPendingChargenImport(actor)) {
    return;
  }
  const owners = game.users.filter(user => user.active && actor.testUserPermission(user, "OWNER")).map(user => user.id);
  if (chooseImporterId(game.users.activeGM?.id, owners) !== game.user.id) {
    return;
  }
  try {
    await importChargenFinances(actor);
  } catch (error) {
    console.error(`${MODULE_ID} | Could not import character generation money for ${actor.name}`, error);
  }
}

Hooks.once("ready", async () => {
  for (const actor of game.actors.filter(candidate => candidate.type === "traveller")) {
    await importChargenFor(actor);
  }
});
Hooks.on("createActor", actor => importChargenFor(actor));
// The chargen module may write its flag after the actor exists
Hooks.on("updateActor", (actor, change) => {
  if (change?.flags?.[CHARGEN_FLAG_SCOPE]?.finances !== undefined) {
    importChargenFor(actor);
  }
});
