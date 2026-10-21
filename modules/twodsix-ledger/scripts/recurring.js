/**
 * Recurring items: the costs and income a traveller has again and again (rent, ship payments, a pension).
 * Pure logic with no Foundry globals, so it can be unit tested in Node.
 *
 * An item belongs to one of three groups that match the old fields of the sheet: pension, living costs and ship
 * payments. (Debts are not items: they are loans, see loans.js.) An item is paid by hand: the player presses Pay (or
 * Receive), which adds an ordinary ledger entry. Nothing here knows about dates or the calendar.
 *
 * The Third Imperium calendar has 13 months of 28 days and one extra day, Holiday, at the start of the year. A "month"
 * item is paid once per such month and a "year" item once per year, which is what the totals below are based on.
 */

import { LEDGER_ACCOUNTS, roundMoney, roundUpCr, secondaryAccount } from "./ledger.js";

export const GROUPS = ["pension", "living", "ship"];
const DEFAULT_GROUP = "living";
/** The history category an item is booked under, decided by its group */
export const GROUP_CATEGORY = {pension: "income", living: "living", ship: "ship"};
export const FREQUENCIES = ["month", "year"];
const DEFAULT_FREQUENCY = "month";
export const MONTHS_PER_YEAR = 13;
const DAYS_PER_MONTH = 28;
export const DAYS_PER_YEAR = MONTHS_PER_YEAR * DAYS_PER_MONTH + 1; // 365: the 13 months and Holiday

/**
 * @typedef {object} RecurringItem
 * @property {string} id
 * @property {string} name
 * @property {number} amount - signed, in whole Cr: negative is a cost, positive is income
 * @property {string} account - the key of one of the ledger accounts
 * @property {string} group - "pension", "living" or "ship"
 * @property {string} frequency - "month" or "year"
 * @property {boolean} active - items that are off are kept in the list but never paid or counted
 */

/**
 * Items saved by the first version of the module had a category instead of a group.
 * @param {object} data
 * @returns {string}
 */
function inferGroup(data) {
  if (GROUPS.includes(data.group)) {
    return data.group;
  }
  if (data.category === "income") {
    return "pension";
  }
  return data.category === "ship" ? "ship" : DEFAULT_GROUP;
}

/**
 * Build a clean item from loose data. Unknown values fall back to defaults, so stored or typed data can never produce
 * an item the rest of the code cannot handle.
 * @param {object} data
 * @param {string} id
 * @returns {RecurringItem}
 */
export function createRecurringItem(data = {}, id) {
  const amount = roundUpCr(Number(data.amount));
  return {
    id: String(id),
    name: String(data.name ?? "").trim(),
    amount: Number.isFinite(amount) ? amount : 0,
    account: LEDGER_ACCOUNTS.includes(data.account) ? data.account : "cash",
    group: inferGroup(data),
    frequency: FREQUENCIES.includes(data.frequency) ? data.frequency : DEFAULT_FREQUENCY,
    active: data.active !== false
  };
}

/**
 * Clean up a stored list: anything that is not an item with an id is dropped, and ids are kept unique.
 * @param {unknown} raw
 * @returns {RecurringItem[]}
 */
export function normalizeRecurringItems(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set();
  const items = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || !entry.id || seen.has(String(entry.id))) {
      continue;
    }
    seen.add(String(entry.id));
    items.push(createRecurringItem(entry, entry.id));
  }
  return items;
}

/**
 * The items a traveller starts with: what was in the sheet's old Pension, Ship payments and Living costs fields.
 * Ids are fixed so that the list looks the same each time it is built, until it is saved.
 * @param {{pension?: number, payments?: number, livingCosts?: number}} values - numbers from the old fields
 * @param {Function} localize - turns a key into text
 * @returns {RecurringItem[]}
 */
export function seedRecurringItems({pension = 0, payments = 0, livingCosts = 0} = {}, localize = key => key) {
  const items = [];
  const add = (id, key, amount, group, frequency) => {
    const value = Math.abs(Number(amount));
    if (Number.isFinite(value) && value > 0) {
      items.push(createRecurringItem({
        name: localize(key), amount: group === "pension" ? value : -value, account: secondaryAccount(), group, frequency
      }, id));
    }
  };
  add("seed-living", "TWODSIX_LEDGER.SEED_LIVING", livingCosts, "living", "month");
  add("seed-ship", "TWODSIX_LEDGER.SEED_SHIP", payments, "ship", "month");
  add("seed-pension", "TWODSIX_LEDGER.SEED_PENSION", pension, "pension", "year");
  return items;
}

/**
 * @param {RecurringItem[]} items
 * @param {string} group
 * @returns {RecurringItem[]}
 */
export function itemsInGroup(items, group) {
  return items.filter(item => item.group === group);
}

/**
 * Totals of the active items of one group, kept apart by how often they are paid.
 * @param {RecurringItem[]} items - the items of the group (or all of them)
 * @returns {{monthly: {net: number, count: number}, yearly: {net: number, count: number}, count: number}}
 */
export function summarizeItems(items) {
  const monthly = {net: 0, count: 0};
  const yearly = {net: 0, count: 0};
  for (const item of items) {
    if (!item.active) {
      continue;
    }
    const target = item.frequency === "year" ? yearly : monthly;
    target.net += item.amount;
    target.count += 1;
  }
  return {
    monthly: {net: roundMoney(monthly.net), count: monthly.count},
    yearly: {net: roundMoney(yearly.net), count: yearly.count},
    count: monthly.count + yearly.count
  };
}

/**
 * What pressing Pay on one item does: the ledger entry to add. Returns null when there is nothing to do.
 * @param {RecurringItem} item
 * @returns {{amount: number, account: string, category: string, description: string, itemId: string}|null}
 */
export function planPayment(item) {
  if (!item?.active || !Number.isFinite(item.amount) || item.amount === 0) {
    return null;
  }
  return {
    amount: item.amount,
    account: item.account,
    category: GROUP_CATEGORY[item.group] ?? "other",
    description: item.name,
    itemId: item.id
  };
}

/**
 * Change one item. Only known fields in the patch are used, and they go through the same cleaning as a new item.
 * @param {RecurringItem[]} items
 * @param {string} id
 * @param {object} patch
 * @returns {RecurringItem[]} a new list; the same items if the id is unknown
 */
export function updateRecurringItem(items, id, patch) {
  return items.map(item => item.id === id ? createRecurringItem({...item, ...patch}, item.id) : item);
}

/**
 * @param {RecurringItem[]} items
 * @param {string} id
 * @returns {RecurringItem[]}
 */
export function removeRecurringItem(items, id) {
  return items.filter(item => item.id !== id);
}

/**
 * Whether Pay means paying out or receiving, so the sheet can write "Pay" or "Receive".
 * @param {RecurringItem} item
 * @returns {"pay"|"receive"}
 */
export function getPayKind(item) {
  return item.amount > 0 ? "receive" : "pay";
}

/**
 * What a typed amount means for an item. Living costs and Ship payments are costs, so a number typed without a sign is
 * a cost; a "+" makes it income. Pension is income, so there a number without a sign is income and a "-" a cost.
 * @param {string} text - what was typed
 * @param {number} amount - the parsed, signed amount
 * @param {string} group
 * @returns {number}
 */
export function signedItemAmount(text, amount, group) {
  if (!Number.isFinite(amount) || /^\s*[+\-\u2212\u2013\u2014]/.test(String(text))) {
    return amount;
  }
  return group === "pension" ? amount : -Math.abs(amount);
}
