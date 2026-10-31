/**
 * The ledger sheet: the system's own traveller sheet with the Finances and Inventory tabs replaced.
 *
 * The sheet is created as a subclass of the system's `TwodsixTravellerSheet` (found in Foundry's sheet registry), so
 * everything else on the sheet keeps coming from the system and follows its updates. Each tab is a partial template
 * that the system includes by a fixed path; this file puts a small wrapper under that path which shows the module's tab
 * when the sheet has the module's data for it and the system's own tab otherwise (for example when someone switches back
 * to the system's sheet, or turns the module's Inventory off).
 */

import { MODULE_ID } from "./store.js";
import { bindFinanceTab, financeActions, prepareFinanceContext } from "./financeTab.js";
import { bindInventoryTab, handleEquipDrop, inventoryActions, prepareInventoryContext } from "./inventoryTab.js";

export const SYSTEM_PARTIAL = "systems/twodsix/templates/actors/parts/actor/actor-finances.hbs";
export const OWN_PARTIAL = `modules/${MODULE_ID}/templates/actor-finances.hbs`;
export const ORIGINAL_PARTIAL = `${MODULE_ID}.original-finances`;

export const SYSTEM_ITEMS_PARTIAL = "systems/twodsix/templates/actors/parts/actor/actor-items.hbs";
export const OWN_ITEMS_PARTIAL = `modules/${MODULE_ID}/templates/actor-items.hbs`;
export const ORIGINAL_ITEMS_PARTIAL = `${MODULE_ID}.original-items`;

/** The tabs the module replaces: the system's path, the module's template, where the system's one is kept, and the
 * context key that says the module's tab has its data. */
export const PARTIAL_OVERRIDES = [
  {system: SYSTEM_PARTIAL, own: OWN_PARTIAL, original: ORIGINAL_PARTIAL, key: "finance"},
  {system: SYSTEM_ITEMS_PARTIAL, own: OWN_ITEMS_PARTIAL, original: ORIGINAL_ITEMS_PARTIAL, key: "inventory"}
];

const wrappers = new Map();

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
 * Make sure the partials the system includes for Finances and Inventory are the module's wrappers. Safe to call before
 * every render: it only does work the first time, or if the system registered its own partial again.
 * @returns {Promise<void>}
 */
export async function ensureSheetPartials() {
  const hb = globalThis.Handlebars;
  for (const override of PARTIAL_OVERRIDES) {
    if (!hb.partials[override.system]) {
      await loadTemplate(override.system);
    }
    if (!hb.partials[override.own]) {
      await loadTemplate(override.own);
    }
    if (!wrappers.has(override.system)) {
      const source = `{{#if ${override.key}}}{{> "${override.own}"}}{{else}}{{> "${override.original}"}}{{/if}}`;
      wrappers.set(override.system, hb.compile(source));
    }
    const wrapper = wrappers.get(override.system);
    if (hb.partials[override.system] !== wrapper) {
      hb.registerPartial(override.original, hb.partials[override.system]);
      hb.registerPartial(override.system, wrapper);
    }
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
      actions: {...financeActions, ...inventoryActions}
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
      prepareInventoryContext(this, context);
      return context;
    }

    /** @override */
    async _renderHTML(context, options) {
      await ensureSheetPartials();
      return super._renderHTML(context, options);
    }

    /**
     * An item of the character dropped on its own Inventory list: the system sorts it as before, and the module carries
     * it or puts it in the backpack depending on where it lands.
     * @override
     */
    async processDroppedItem(event, item) {
      const result = await super.processDroppedItem(event, item);
      const moved = await handleEquipDrop(this, event, item);
      return result || moved;
    }

    /** @override */
    async _onRender(context, options) {
      await super._onRender(context, options);
      bindFinanceTab(this);
      bindInventoryTab(this);
    }
  };
}
