/**
 * Inventory tab: the parts that do not need Foundry. Which items are carried, what a weapon has loaded, how full the
 * magazine is and which magazines a reload can use.
 *
 * A magazine in Twodsix is one consumable item that stands for a stack: `quantity` is the number of magazines (the one
 * in the weapon included) and `currentCount`/`max` is the loaded one. The weapon lists the consumables that fit it in
 * `system.consumableData` and the loaded one in `system.useConsumableForAttack`.
 */

/** The location value of an item that is carried and ready (the system calls it "equipped"). */
export const EQUIPPED = "equipped";

/** Locations the sheet's eye button hides (the system's `twodsix_hideItem` helper). */
export const STORED_LOCATIONS = ["ship", "vehicle", "base"];

/** At or below this share of a full magazine the ammo is shown as low. */
export const LOW_AMMO_SHARE = 0.25;

/** The sheet's lists and the key in `system.hideStoredItems` that hides their stored items. */
export const INVENTORY_LISTS = {
  weapon: "weapon",
  armor: "armor",
  augment: "augment",
  equipmentAndTools: "equipment",
  storageAndJunk: "junk",
  consumable: "consumable"
};

/**
 * @param {object} item
 * @returns {boolean} whether the item is carried and ready
 */
export function isEquipped(item) {
  return item?.system?.equipped === EQUIPPED;
}

/**
 * Whether the sheet shows an item, the same test as the system's `twodsix_hideItem` helper.
 * @param {object} item
 * @param {boolean} hideStored - the list's eye button
 * @returns {boolean}
 */
export function isShown(item, hideStored) {
  return !(hideStored && STORED_LOCATIONS.includes(item?.system?.equipped));
}

/**
 * Carried items first. The order within each part is kept (the system has already sorted by name or by hand).
 * @param {Array<object>} items
 * @returns {Array<object>} a new array
 */
export function sortEquippedFirst(items) {
  const list = Array.isArray(items) ? items : [];
  return [...list.filter(isEquipped), ...list.filter(item => !isEquipped(item))];
}

/**
 * The first shown item that is not carried, when shown carried items come before it. That is where the list gets a
 * "Not carried" line. A list with only carried or only other items gets no line.
 * @param {Array<object>} items - sorted with sortEquippedFirst
 * @param {boolean} hideStored
 * @returns {string|null} the item id
 */
export function firstNotEquippedId(items, hideStored) {
  const shown = (Array.isArray(items) ? items : []).filter(item => isShown(item, hideStored));
  const index = shown.findIndex(item => !isEquipped(item));
  return index > 0 ? shown[index].id : null;
}

/**
 * @param {number} current
 * @param {number} max
 * @returns {"empty"|"low"|"ok"}
 */
export function ammoState(current, max) {
  if (!(current > 0)) {
    return "empty";
  }
  if (max > 0 && current <= max * LOW_AMMO_SHARE) {
    return "low";
  }
  return "ok";
}

/**
 * @param {object} consumable
 * @returns {{current: number, max: number, quantity: number}}
 */
function counts(consumable) {
  const system = consumable?.system ?? {};
  return {
    current: Math.max(0, Number(system.currentCount) || 0),
    max: Math.max(0, Number(system.max) || 0),
    quantity: Math.max(0, Number(system.quantity) || 0)
  };
}

/**
 * Magazines that are not linked to any item but match one of the weapon's own: same name, same subtype and the same
 * size. The system's Reload puts a part-used magazine aside as a new item without linking it to the weapon, so this is
 * how such a magazine is found again.
 * @param {Array<object>} linked - the weapon's own magazines
 * @param {Array<object>} unlinked - consumables of the actor that no item links to
 * @returns {Array<object>}
 */
export function matchingUnlinked(linked, unlinked) {
  const keys = new Set(linked.map(item => `${item.name}|${item.system?.subtype}|${Number(item.system?.max) || 0}`));
  return (Array.isArray(unlinked) ? unlinked : []).filter(item => item && !item.system?.isAttachment
    && keys.has(`${item.name}|${item.system?.subtype}|${Number(item.system?.max) || 0}`));
}

/**
 * The magazines that fit a weapon, and the loaded one.
 * @param {object} weapon
 * @param {Array<object>} [unlinked] - consumables of the actor that no item links to
 * @returns {{magazines: Array<object>, loaded: object|null, extra: Array<object>}}
 */
function weaponMagazines(weapon, unlinked = []) {
  const magazines = (weapon?.system?.consumableData ?? []).filter(item => item && !item.system?.isAttachment);
  const loadedId = weapon?.system?.useConsumableForAttack;
  const loaded = loadedId ? magazines.find(item => item.id === loadedId) ?? null : null;
  return {magazines, loaded, extra: matchingUnlinked(magazines, unlinked)};
}

/**
 * What a reload can do for a weapon:
 * - `refill`: take a full magazine from the loaded stack (the system's Reload, which puts the part-used one aside as
 *   its own item);
 * - `select`: load another magazine that fits and has something in it, or more of them. `link` is set for a magazine
 *   that is not linked to the weapon yet.
 * @param {object} weapon
 * @param {Array<object>} [unlinked] - consumables of the actor that no item links to
 * @returns {Array<{kind: "refill"|"select", id: string, name: string, current: number, max: number, quantity: number,
 *   link?: boolean}>}
 */
export function reloadChoices(weapon, unlinked = []) {
  const {magazines, loaded, extra} = weaponMagazines(weapon, unlinked);
  const choices = [];
  if (loaded) {
    const {current, max, quantity} = counts(loaded);
    if (quantity > 1 && current < max) {
      choices.push({kind: "refill", id: loaded.id, name: loaded.name, current: max, max, quantity: quantity - 1});
    }
  }
  for (const magazine of [...magazines, ...extra]) {
    if (magazine === loaded) {
      continue;
    }
    const {current, max, quantity} = counts(magazine);
    if (current > 0 || quantity > 1) {
      const choice = {kind: "select", id: magazine.id, name: magazine.name, current, max, quantity};
      choices.push(extra.includes(magazine) ? {...choice, link: true} : choice);
    }
  }
  return choices;
}

/**
 * The ammunition of a weapon, or null for weapons that use no ammunition (no magazines and no ammo value).
 * `reserve` counts every magazine that is not loaded and has something in it (the rest of the loaded stack, other
 * stacks and part-used ones); `partial` is how many of them are not full.
 * @param {object} weapon
 * @param {Array<object>} [unlinked] - consumables of the actor that no item links to
 * @returns {object|null}
 */
export function describeWeaponAmmo(weapon, unlinked = []) {
  const {magazines, loaded, extra} = weaponMagazines(weapon, unlinked);
  if (!magazines.length && !(Number(weapon?.system?.ammo) > 0)) {
    return null;
  }
  const choices = reloadChoices(weapon, unlinked);
  let reserve = 0;
  let partial = 0;
  for (const magazine of [...magazines, ...extra]) {
    const {current, max, quantity} = counts(magazine);
    if (magazine === loaded) {
      reserve += Math.max(0, quantity - 1);
    } else if (current > 0) {
      reserve += Math.max(1, quantity);
      partial += current < max ? 1 : 0;
    } else if (quantity > 1) {
      reserve += quantity - 1;
    }
  }
  const common = {
    magazines: magazines.length + extra.length, choices, canReload: choices.length > 0, multiple: choices.length > 1,
    reserve, partial
  };
  if (!loaded) {
    return {...common, loaded: null, state: "unloaded"};
  }
  const {current, max} = counts(loaded);
  return {
    ...common,
    loaded: {id: loaded.id, name: loaded.name},
    current,
    max,
    percent: max > 0 ? Math.min(100, Math.round(current / max * 100)) : 0,
    state: ammoState(current, max),
    full: max > 0 && current >= max
  };
}

/**
 * The consumables of an actor that no item links to.
 * @param {Iterable<object>} items - all the actor's items
 * @returns {Array<object>}
 */
export function unlinkedConsumables(items) {
  const all = Array.from(items ?? []);
  const linked = new Set(all.flatMap(item => item.system?.consumables ?? []));
  return all.filter(item => item.type === "consumable" && !linked.has(item.id));
}

/**
 * The consumables that sit loaded in one of the weapons. They are shown under the weapon, so the Consumables list
 * leaves them out.
 * @param {Array<object>} weapons
 * @returns {Set<string>}
 */
export function loadedConsumableIds(weapons) {
  const ids = new Set();
  for (const weapon of Array.isArray(weapons) ? weapons : []) {
    const {loaded} = weaponMagazines(weapon);
    if (loaded) {
      ids.add(loaded.id);
    }
  }
  return ids;
}

/**
 * One fire mode button: the attack type and the rate of fire the system's attack takes.
 * @param {string} attackType
 * @param {string|number} rof
 * @returns {string}
 */
export function fireModeKey(attackType, rof) {
  return `${attackType || "single"}:${Number.parseInt(rof, 10) || 1}`;
}

/**
 * The autofire rules the world uses, from the sheet's settings (the same flags the system's template reads).
 * @param {object} [settings] - context.settings
 * @returns {{ce: boolean, cel: boolean, ct: boolean, cu: boolean, rider: boolean, showDoubleTap: boolean}}
 */
export function fireRules(settings = {}) {
  return {
    ce: Boolean(settings.useCEAutofireRules),
    cel: Boolean(settings.useCELAutofireRules),
    ct: Boolean(settings.useCTAutofireRules),
    cu: Boolean(settings.useCUAutofireRules),
    rider: Boolean(settings.useRIDERFireRules),
    showDoubleTap: Boolean(settings.ShowDoubleTap)
  };
}

/**
 * @param {object} weapon
 * @returns {Array<string>} the rate of fire split like the system's helpers do ("1-3" → ["1", "3"])
 */
function rateParts(weapon) {
  return String(weapon?.system?.rateOfFire ?? "").split(/[-/]/);
}

/**
 * Whether the weapon gets fire mode buttons, the same tests as the system's template.
 * @param {object} weapon
 * @param {object} rules - from fireRules
 * @returns {boolean}
 */
export function hasFireModes(weapon, rules) {
  const system = weapon?.system ?? {};
  const rof = Number.parseInt(system.rateOfFire, 10);
  if (rules.ce || rules.ct) {
    return rateParts(weapon).length > 1;
  }
  if (rules.cel) {
    return rof > 1 || Boolean(system.doubleTap && rules.showDoubleTap);
  }
  if (rules.cu) {
    return rof > 1;
  }
  if (rules.rider) {
    return rof > 1 || Boolean(system.isSingleAction);
  }
  return false;
}

/**
 * The "Auto N" status after the weapon's name, for the rules where the system shows one rate of fire (CEL and CU).
 * @param {object} weapon
 * @param {object} rules - from fireRules
 * @returns {number|null}
 */
export function autoRate(weapon, rules) {
  const rof = Number.parseInt(weapon?.system?.rateOfFire, 10);
  if (!(rof > 1)) {
    return null;
  }
  if (rules.cel) {
    return weapon.system.doubleTap && rules.showDoubleTap ? null : rof;
  }
  return rules.cu ? rof : null;
}

/**
 * What dropping an item of the actor on a row of its own list does to where it is carried: on a carried row it becomes
 * carried, on another row (or the "Not equipped" line) it goes to the backpack. Nothing changes when it is already there.
 * @param {{itemEquipped: boolean, targetEquipped: boolean}} drop
 * @returns {"equipped"|"backpack"|null}
 */
export function equipStateForDrop({itemEquipped, targetEquipped}) {
  if (targetEquipped && !itemEquipped) {
    return EQUIPPED;
  }
  if (!targetEquipped && itemEquipped) {
    return "backpack";
  }
  return null;
}
