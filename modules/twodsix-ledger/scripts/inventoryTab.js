/**
 * Inventory tab on the ledger sheet: carried items first, fire mode buttons, the loaded magazine under each weapon and a
 * Reload that can choose between magazines. The template is the module's copy of the system's `actor-items.hbs`; the
 * system's own actions (attack, equip, edit, delete, the magazine's - and + and the green check) are used as they are.
 */

import { MODULE_ID } from "./store.js";
import {
  INVENTORY_LISTS,
  describeWeaponAmmo,
  fireModeKey,
  firstNotEquippedId,
  loadedConsumableIds,
  reloadChoices,
  sortEquippedFirst
} from "./inventory.js";

export const INVENTORY_SETTING = "improvedInventory";
const PREFIX = "TWODSIX_LEDGER.INVENTORY";

/** The last fire mode used per weapon, on this client only, until the page is reloaded. Key: "<actor id>.<item id>". */
const lastFireModes = new Map();

/** Whether this sheet shows the loaded magazines in the Consumables list too (per open sheet). */
const SHOW_LOADED = Symbol("twodsixLedgerShowLoaded");

/**
 * @returns {boolean} whether the player uses the module's Inventory tab
 */
export function inventoryEnabled() {
  try {
    return game.settings.get(MODULE_ID, INVENTORY_SETTING) !== false;
  } catch {
    return true;
  }
}

/**
 * @param {string} key
 * @param {object} [data]
 * @returns {string}
 */
function t(key, data) {
  return data ? game.i18n.format(`${PREFIX}.${key}`, data) : game.i18n.localize(`${PREFIX}.${key}`);
}

/**
 * The text after the magazine's name ("2 in reserve · 1 other magazine") or, when nothing is loaded, what there is.
 * @param {object} ammo - from describeWeaponAmmo
 * @returns {string}
 */
export function ammoText(ammo) {
  if (!ammo.loaded) {
    if (!ammo.magazines) {
      return t("NO_MAGAZINE");
    }
    return t(ammo.magazines === 1 ? "MAGAZINES_ONE" : "MAGAZINES_MANY", {count: ammo.magazines});
  }
  const parts = [t("RESERVE", {count: ammo.reserve})];
  if (ammo.others > 0) {
    parts.push(t(ammo.others === 1 ? "OTHERS_ONE" : "OTHERS_MANY", {count: ammo.others}));
  }
  return parts.join(" · ");
}

/**
 * Add what the module's Inventory template needs. Leaves the context alone when the player has switched it off, so the
 * system's own tab is shown.
 * @param {object} sheet
 * @param {object} context
 */
export function prepareInventoryContext(sheet, context) {
  if (!inventoryEnabled() || !context?.container) {
    return;
  }
  const hide = context.system?.hideStoredItems ?? sheet.actor?.system?.hideStoredItems ?? {};
  // context.container is the actor's own itemTypes object, so the sorted lists go in a copy
  const container = {...context.container};
  const groupStart = {};
  const markGroup = (items, hideStored) => {
    const id = firstNotEquippedId(items, hideStored);
    if (id) {
      groupStart[id] = true;
    }
  };

  for (const [list, hideKey] of Object.entries(INVENTORY_LISTS)) {
    if (Array.isArray(container[list])) {
      container[list] = sortEquippedFirst(container[list]);
      if (list !== "consumable") {
        markGroup(container[list], hide[hideKey]);
      }
    }
  }

  const loadedIds = loadedConsumableIds(container.weapon);
  const showLoaded = Boolean(sheet[SHOW_LOADED]);
  const consumables = container.consumable ?? [];
  const loadedInList = consumables.filter(item => !item.system?.isAttachment && loadedIds.has(item.id));
  markGroup(consumables.filter(item => !item.system?.isAttachment && (showLoaded || !loadedIds.has(item.id))), hide.consumable);
  markGroup(consumables.filter(item => item.system?.isAttachment), hide.attachment);

  const ammo = {};
  for (const weapon of container.weapon ?? []) {
    const info = describeWeaponAmmo(weapon);
    if (info) {
      ammo[weapon.id] = {...info, text: ammoText(info)};
    }
  }

  context.container = container;
  context.inventory = {
    groupStart,
    ammo,
    loadedHidden: showLoaded ? {} : Object.fromEntries(loadedInList.map(item => [item.id, true])),
    loadedCount: loadedInList.length,
    loadedNote: t(loadedInList.length === 1 ? "LOADED_HIDDEN_ONE" : "LOADED_HIDDEN_MANY", {count: loadedInList.length}),
    showLoaded
  };
}

/**
 * Mark the last used fire mode of every weapon on the sheet.
 * @param {object} sheet
 */
export function markFireModes(sheet) {
  const root = sheet.element;
  if (!root?.querySelectorAll) {
    return;
  }
  for (const button of root.querySelectorAll(".tl-fire-mode")) {
    const itemId = button.closest(".item")?.dataset.itemId;
    const last = lastFireModes.get(`${sheet.actor?.id}.${itemId}`);
    button.classList.toggle("is-active", last === fireModeKey(button.dataset.attackType, button.dataset.rof));
  }
}

/**
 * @param {object} sheet
 */
export function bindInventoryTab(sheet) {
  markFireModes(sheet);
}

/**
 * @param {string} actorId
 * @param {string} itemId
 * @returns {string|undefined} the last fire mode key used with the weapon on this client
 */
export function lastFireMode(actorId, itemId) {
  return lastFireModes.get(`${actorId}.${itemId}`);
}

/**
 * @param {string} text
 * @returns {string}
 */
function escape(text) {
  const escapeHTML = foundry.utils?.escapeHTML;
  return escapeHTML ? escapeHTML(String(text)) : String(text).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
}

/**
 * A button label for a reload choice.
 * @param {object} choice - from reloadChoices
 * @returns {string}
 */
export function reloadChoiceLabel(choice) {
  if (choice.kind === "refill") {
    return t("CHOICE_REFILL", {count: choice.quantity});
  }
  const label = `${choice.name} (${choice.current}/${choice.max})`;
  return choice.quantity > 1 ? `${label} ×${choice.quantity}` : label;
}

/**
 * Ask which magazine to load.
 * @param {object} weapon
 * @param {Array<object>} choices
 * @returns {Promise<object|null>}
 */
async function chooseMagazine(weapon, choices) {
  const action = await foundry.applications.api.DialogV2.wait({
    window: {title: t("RELOAD_TITLE", {weapon: weapon.name})},
    classes: ["twodsix-ledger-reload"],
    content: `<p>${escape(t("RELOAD_PROMPT"))}</p>`,
    buttons: choices.map((choice, index) => ({
      action: String(index),
      label: escape(reloadChoiceLabel(choice)),
      icon: choice.kind === "refill" ? "fa-solid fa-layer-group" : "fa-solid fa-box",
      default: index === 0
    })),
    rejectClose: false
  });
  return action === null || action === undefined ? null : choices[Number(action)] ?? null;
}

/**
 * The system's Reload: a full magazine from the stack, keeping a part-used one as its own item.
 * @param {object} magazine
 * @returns {Promise<void>}
 */
async function refillMagazine(magazine) {
  try {
    await magazine.refill();
  } catch (err) {
    if (err?.name === "TooLowQuantityError") {
      ui.notifications.warn(t("RELOAD_NONE"));
    } else {
      throw err;
    }
  }
}

/**
 * Carry out a reload choice.
 * @param {object} actor
 * @param {object} weapon
 * @param {object} choice - from reloadChoices
 * @returns {Promise<void>}
 */
export async function applyReload(actor, weapon, choice) {
  const magazine = actor.items.get(choice.id);
  if (!magazine) {
    return;
  }
  if (choice.kind === "select") {
    await weapon.update({"system.useConsumableForAttack": magazine.id});
    if (!(Number(magazine.system.currentCount) > 0) && Number(magazine.system.quantity) > 1) {
      await refillMagazine(magazine);
    }
    return;
  }
  await refillMagazine(magazine);
}

/**
 * @param {object} sheet
 * @param {HTMLElement} target
 * @returns {object|undefined} the item of the row the target sits in
 */
function rowItem(sheet, target) {
  return sheet.actor?.items.get(target.closest(".item")?.dataset.itemId);
}

export const inventoryActions = {
  /**
   * Attack in the fire mode of the button, and remember it as this weapon's last mode.
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target
   * @returns {Promise<void>}
   */
  async inventoryFireMode(event, target) {
    const item = rowItem(this, target);
    if (!item) {
      return;
    }
    lastFireModes.set(`${this.actor.id}.${item.id}`, fireModeKey(target.dataset.attackType, target.dataset.rof));
    markFireModes(this);
    const attack = this.options?.actions?.performAttack;
    const handler = typeof attack === "function" ? attack : attack?.handler;
    await handler?.call(this, event, target);
  },

  /**
   * Reload: straight away when there is one way to do it, otherwise ask which magazine.
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target
   * @returns {Promise<void>}
   */
  async inventoryReload(event, target) {
    if (!this.actor?.isOwner) {
      ui.notifications.warn("TWODSIX.Warnings.LackPermissionToEdit", {localize: true});
      return;
    }
    const weapon = rowItem(this, target);
    if (!weapon) {
      return;
    }
    const choices = reloadChoices(weapon);
    if (!choices.length) {
      ui.notifications.warn(t("RELOAD_NONE"));
      return;
    }
    const choice = choices.length === 1 ? choices[0] : await chooseMagazine(weapon, choices);
    if (choice) {
      await applyReload(this.actor, weapon, choice);
    }
  },

  /**
   * Show or hide the loaded magazines in the Consumables list.
   * @this {object} the sheet
   */
  inventoryToggleLoaded() {
    this[SHOW_LOADED] = !this[SHOW_LOADED];
    this.render();
  }
};
