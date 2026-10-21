/**
 * The ledger sheet: the system's own traveller sheet with the Finances tab replaced.
 *
 * The sheet is created as a subclass of the system's `TwodsixTravellerSheet` (found in Foundry's sheet registry), so
 * everything else on the sheet keeps coming from the system and follows its updates. The Finances tab is a partial
 * template that the system includes by a fixed path; this file puts a small wrapper under that path which shows the
 * ledger when the sheet has ledger data and the system's own tab otherwise (for example when someone switches back to
 * the system's sheet).
 */

import { MODULE_ID } from "./store.js";
import { bindFinanceTab, financeActions, prepareFinanceContext } from "./financeTab.js";

export const SYSTEM_PARTIAL = "systems/twodsix/templates/actors/parts/actor/actor-finances.hbs";
export const OWN_PARTIAL = `modules/${MODULE_ID}/templates/actor-finances.hbs`;
export const ORIGINAL_PARTIAL = `${MODULE_ID}.original-finances`;
const WRAPPER_SOURCE = `{{#if finance}}{{> "${OWN_PARTIAL}"}}{{else}}{{> "${ORIGINAL_PARTIAL}"}}{{/if}}`;

let wrapper = null;

/**
 * Load a template (which also registers it as a partial under its path), using whichever helper this Foundry has.
 * @param {string} path
 * @returns {Promise<Function>}
 */
async function loadTemplate(path) {
  const getTemplate = foundry.applications?.handlebars?.getTemplate ?? globalThis.getTemplate;
  return getTemplate(path);
}

/**
 * Make sure the Finances partial the system includes is the module's wrapper. Safe to call before every render: it only
 * does work the first time, or if the system registered its own partial again.
 * @returns {Promise<void>}
 */
export async function ensureFinancePartial() {
  const hb = globalThis.Handlebars;
  if (!hb.partials[SYSTEM_PARTIAL]) {
    await loadTemplate(SYSTEM_PARTIAL);
  }
  if (!hb.partials[OWN_PARTIAL]) {
    await loadTemplate(OWN_PARTIAL);
  }
  wrapper ??= hb.compile(WRAPPER_SOURCE);
  if (hb.partials[SYSTEM_PARTIAL] !== wrapper) {
    hb.registerPartial(ORIGINAL_PARTIAL, hb.partials[SYSTEM_PARTIAL]);
    hb.registerPartial(SYSTEM_PARTIAL, wrapper);
  }
}

/**
 * Find the system's traveller sheet class in Foundry's registry.
 * @returns {Function|null}
 */
export function findSystemTravellerSheet() {
  const registry = CONFIG.Actor.sheetClasses?.traveller ?? {};
  const entries = Object.entries(registry).map(([key, entry]) => ({key, ...entry}));
  const isClass = entry => typeof entry.cls === "function";
  // The registry key/id is "<scope>.<class name>", but a built (minified) system can have another class name than the
  // source, so fall back on the label the system gives its sheet, and then on any sheet from the twodsix scope.
  const own = entries.find(entry => isClass(entry) && (entry.id ?? entry.key) === "twodsix.TwodsixTravellerSheet")
    ?? entries.find(entry => isClass(entry) && entry.label === "TWODSIX.SheetTypes.TravellerSheet")
    ?? entries.find(entry => isClass(entry) && String(entry.id ?? entry.key).startsWith("twodsix.")
      && entry.label !== "TWODSIX.SheetTypes.NPCSheet");
  if (!own) {
    console.warn(`${MODULE_ID} | Sheet registry for travellers:`, entries.map(entry => ({
      key: entry.key, id: entry.id, label: entry.label, hasClass: isClass(entry)
    })));
  }
  return own?.cls ?? null;
}

/**
 * Create the ledger sheet class on top of the system's sheet.
 * @param {Function} SystemSheet - the system's TwodsixTravellerSheet
 * @returns {Function} the new class
 */
export function createLedgerSheet(SystemSheet) {
  return class TwodsixLedgerTravellerSheet extends SystemSheet {
    static DEFAULT_OPTIONS = {
      actions: {...financeActions}
    };

    static PARTS = {
      main: {
        ...SystemSheet.PARTS.main,
        scrollable: [...(SystemSheet.PARTS.main.scrollable ?? []), ".fl-scroll"]
      }
    };

    /** @override */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      prepareFinanceContext(this, context);
      return context;
    }

    /** @override */
    async _renderHTML(context, options) {
      await ensureFinancePartial();
      return super._renderHTML(context, options);
    }

    /** @override */
    async _onRender(context, options) {
      await super._onRender(context, options);
      bindFinanceTab(this);
    }
  };
}
