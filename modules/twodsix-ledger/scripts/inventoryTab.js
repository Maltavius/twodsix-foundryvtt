/**
 * Inventory tab on the ledger sheet: carried items first, fire mode buttons, the loaded magazine under each weapon and a
 * Reload that can choose between magazines. The template is the module's copy of the system's `actor-items.hbs`; the
 * system's own actions (attack, equip, edit, delete, the magazine's - and + and the green check) are used as they are.
 */

import { MODULE_ID } from "./store.js";
import {
  EQUIPPED,
  INVENTORY_LISTS,
  autoRate,
  describeWeaponAmmo,
  equipStateForDrop,
  fireModeKey,
  fireRules,
  firstNotEquippedId,
  hasFireModes,
  isEquipped,
  loadedConsumableIds,
  reloadChoices,
  sortEquippedFirst,
  unlinkedConsumables
} from "./inventory.js";

export const INVENTORY_SETTING = "improvedInventory";
export const EXPAND_SETTING = "inventoryExpandWeapons";
export const PORTRAIT_SETTING = "portraitKeepAspect";
export const PORTRAIT_CLASS = "twodsix-ledger-portrait-contain";
const PREFIX = "TWODSIX_LEDGER.INVENTORY";

/** The last fire mode used per weapon, on this client only, until the page is reloaded. Key: "<actor id>.<item id>". */
const lastFireModes = new Map();

/** Weapons the player opened or closed by hand, on this client until the page is reloaded. Key as above. */
const openedWeapons = new Map();

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

/** Forget which weapons were opened or closed by hand, so they all follow the Automatically expand weapons setting again. */
export function forgetOpenedWeapons() {
  openedWeapons.clear();
}

/**
 * @returns {boolean} whether the rows under a weapon (fire modes and magazine) start open
 */
export function weaponsExpanded() {
  try {
    return game.settings.get(MODULE_ID, EXPAND_SETTING) === true;
  } catch {
    return false;
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
  if (ammo.partial > 0) {
    return t(ammo.partial === 1 ? "RESERVE_PARTIAL_ONE" : "RESERVE_PARTIAL_MANY", {count: ammo.reserve, partial: ammo.partial});
  }
  return t("RESERVE", {count: ammo.reserve});
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

  const rules = fireRules(context.settings);
  const expanded = weaponsExpanded();
  const unlinked = unlinkedConsumables(sheet.actor?.items?.values?.() ?? []);
  const weapons = {};
  for (const weapon of container.weapon ?? []) {
    const info = describeWeaponAmmo(weapon, unlinked);
    const ammo = info ? {...info, text: ammoText(info)} : null;
    const hasDetails = Boolean(ammo) || hasFireModes(weapon, rules);
    const open = hasDetails && (openedWeapons.get(`${sheet.actor?.id}.${weapon.id}`) ?? expanded);
    weapons[weapon.id] = {
      ammo,
      auto: autoRate(weapon, rules),
      hasDetails,
      open,
      toggleTooltip: t(open ? "HIDE_DETAILS" : "SHOW_DETAILS")
    };
  }

  const armor = {};
  const damageTypes = context.settings?.damageTypes ?? {};
  for (const item of container.armor ?? []) {
    const secondary = Number(item.system?.secondaryArmor?.value) || 0;
    if (secondary) {
      const types = (item.system.secondaryArmor.protectionTypes ?? [])
        .map(type => game.i18n.localize(damageTypes[type] ?? type));
      armor[item.id] = {
        secondary,
        tooltip: types.length ? t("SECONDARY_TYPES", {types: types.join(", ")}) : t("SECONDARY")
      };
    }
  }

  // The system writes the weapon's name after a linked magazine; leave it out when the name already says it
  const parentSuffix = {};
  for (const item of consumables) {
    const parent = item.system?.parentName;
    if (parent && !String(item.name ?? "").includes(parent)) {
      parentSuffix[item.id] = parent;
    }
  }

  context.container = container;
  context.inventory = {
    parentSuffix,
    groupStart,
    weapons,
    armor,
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

/** A list leaves out TL and Qty when its name column would be narrower than this (in em). */
export const NARROW_NAME_EM = 8;

/**
 * @param {HTMLElement} section
 * @returns {number} the laid-out width of the name column in pixels, or NaN while the tab is hidden
 */
function nameColumnWidth(section) {
  return Number.parseFloat(getComputedStyle(section).gridTemplateColumns.split(" ")[1]);
}

/**
 * Lay out the lists one by one, top down:
 * - a list whose name column would be narrower than NARROW_NAME_EM leaves out TL and Qty (class tl-narrow), each list
 *   on its own, so a crowded list does not take columns from the others;
 * - a list with no items takes its name column from the list above it (in pixels as laid out), so empty lists line up
 *   with it instead of sizing their columns from the headings alone.
 * @param {HTMLElement} root - the sheet's element
 */
export function layoutSections(root) {
  const sections = root?.querySelectorAll?.(".tl-inventory .tl-section") ?? [];
  let previousName = null;
  for (const section of sections) {
    section.classList.remove("tl-narrow");
    section.style.removeProperty("--tl-name-match");
    section.style.removeProperty("--tl-icons-match");
    const empty = !section.querySelector(".item-list .item");
    if (empty && previousName) {
      section.style.setProperty("--tl-name-match", previousName);
      section.style.setProperty("--tl-icons-match", "1fr");
    }
    let name = nameColumnWidth(section);
    // A hidden tab gives no pixel widths; this is done again when the tab is shown
    if (!(name > 0)) {
      continue;
    }
    const em = Number.parseFloat(getComputedStyle(section).fontSize) || 16;
    if (!empty && name < NARROW_NAME_EM * em && section.querySelector(".tl-col-tl, .tl-col-qty")) {
      section.classList.add("tl-narrow");
      name = nameColumnWidth(section);
    }
    previousName = `${name}px`;
  }
}

/** The observer that lines up empty lists again when the tab is shown or the sheet is resized (one per sheet). */
const SECTION_OBSERVER = Symbol("twodsixLedgerSectionObserver");

/**
 * @returns {boolean} whether the portrait keeps its aspect ratio (fits inside its frame instead of being stretched)
 */
export function portraitKeepsAspect() {
  try {
    return game.settings.get(MODULE_ID, PORTRAIT_SETTING) === true;
  } catch {
    return false;
  }
}

/**
 * @param {object} sheet
 */
export function bindInventoryTab(sheet) {
  sheet.element?.classList?.toggle(PORTRAIT_CLASS, portraitKeepsAspect());
  markFireModes(sheet);
  sheet[SECTION_OBSERVER]?.disconnect();
  const inventory = sheet.element?.querySelector?.(".tl-inventory");
  if (!inventory) {
    return;
  }
  layoutSections(sheet.element);
  if (typeof ResizeObserver === "function") {
    let frame = null;
    sheet[SECTION_OBSERVER] = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => layoutSections(sheet.element));
    });
    sheet[SECTION_OBSERVER].observe(inventory);
  }
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
    if (choice.link) {
      await weapon.addConsumable(magazine.id);
    }
    await weapon.update({"system.useConsumableForAttack": magazine.id});
    if (!(Number(magazine.system.currentCount) > 0) && Number(magazine.system.quantity) > 1) {
      await refillWithLink(actor, weapon, magazine);
    }
    return;
  }
  await refillWithLink(actor, weapon, magazine);
}

/**
 * Refill, and link the part-used magazine the system puts aside to the weapon, so it is still counted and can be loaded.
 * @param {object} actor
 * @param {object} weapon
 * @param {object} magazine
 * @returns {Promise<void>}
 */
async function refillWithLink(actor, weapon, magazine) {
  const before = new Set(actor.items.keys());
  await refillMagazine(magazine);
  for (const item of actor.items.values()) {
    if (!before.has(item.id) && item.type === "consumable") {
      await weapon.addConsumable(item.id);
    }
  }
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
    const choices = reloadChoices(weapon, unlinkedConsumables(this.actor.items.values()));
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
   * Open or close the rows under a weapon (fire modes and the loaded magazine).
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target
   */
  inventoryToggleDetails(event, target) {
    event?.stopPropagation?.();
    const item = rowItem(this, target);
    if (!item) {
      return;
    }
    const key = `${this.actor.id}.${item.id}`;
    const open = openedWeapons.get(key) ?? weaponsExpanded();
    openedWeapons.set(key, !open);
    this.render();
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

/**
 * Carry an item, or put it in the backpack, together with its magazines (as the system's equip button does).
 * @param {object} actor
 * @param {object} item
 * @param {string} state
 * @returns {Promise<void>}
 */
export async function setEquipped(actor, item, state) {
  const updates = [{_id: item.id, "system.equipped": state}];
  for (const id of item.system?.consumables ?? []) {
    if (actor.items.get(id)) {
      updates.push({_id: id, "system.equipped": state});
    }
  }
  await actor.updateEmbeddedDocuments("Item", updates);
}

/**
 * An item of the actor dropped on a row of its own list: carried rows carry it, other rows put it in the backpack.
 * @param {object} sheet
 * @param {DragEvent} event
 * @param {object} dropped - the dropped item
 * @returns {Promise<boolean>} whether the item was moved
 */
export async function handleEquipDrop(sheet, event, dropped) {
  if (!inventoryEnabled()) {
    return false;
  }
  const item = sheet.actor?.items.get(dropped?.id ?? dropped?._id);
  const target = event?.target?.closest?.(
    ".tl-inventory .item[data-item-id], .tl-inventory .tl-group-divider, .tl-inventory .gear-header, .tl-inventory .item-title"
  );
  if (!item || !target || target.dataset?.itemId === item.id) {
    return false;
  }
  // The list heading and the column headings count as the top of the list, where the carried items are
  const isHeading = target.classList.contains("gear-header") || target.classList.contains("item-title");
  const list = isHeading ? target.parentElement?.querySelector(":scope > .item-list") : target.closest(".item-list");
  // Only within the item's own list (a weapon dropped among armour does nothing)
  if (!list?.querySelector(`.item[data-item-id="${item.id}"]`)) {
    return false;
  }
  const state = equipStateForDrop({
    itemEquipped: isEquipped(item),
    targetEquipped: isHeading || target.classList.contains("tl-equipped")
  });
  if (!state) {
    return false;
  }
  await setEquipped(sheet.actor, item, state === EQUIPPED ? EQUIPPED : "backpack");
  return true;
}
