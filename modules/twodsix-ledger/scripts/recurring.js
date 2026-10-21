/**
 * Recurring items: the costs and income a traveller has again and again (rent, ship payments, a pension).
 * Pure logic with no Foundry globals, so it can be unit tested in Node.
 *
 * An item is paid by hand: the player presses Pay (or Receive), which adds an ordinary ledger entry. Nothing here
 * knows about dates or the calendar.
 *
 * The Third Imperium calendar has 13 months of 28 days and one extra day, Holiday, at the start of the year. A "month"
 * item is paid once per such month and a "year" item once per year, which is what the totals below are based on.
 */

import { LEDGER_ACCOUNTS, roundMoney, roundUpCr } from "./ledger.js";

export const FREQUENCIES = ["month", "year"];
export const DEFAULT_FREQUENCY = "month";
export const MONTHS_PER_YEAR = 13;
export const DAYS_PER_MONTH = 28;
export const DAYS_PER_YEAR = MONTHS_PER_YEAR * DAYS_PER_MONTH + 1; // 365: the 13 months and Holiday

/**
 * @typedef {object} RecurringItem
 * @property {string} id
 * @property {string} name
 * @property {number} amount - signed, in whole Cr: negative is a cost, positive is income
 * @property {string} account - "cash" or "digital"
 * @property {string} category - a ledger category
 * @property {string} frequency - "month" or "year"
 * @property {boolean} active - items that are off are kept in the list but never paid or counted
 * @property {boolean} reducesDebt - paying this item also lowers the traveller's debt
 */

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
    category: String(data.category || "other"),
    frequency: FREQUENCIES.includes(data.frequency) ? data.frequency : DEFAULT_FREQUENCY,
    active: data.active !== false,
    reducesDebt: data.reducesDebt === true
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
 * Debt is not an item: it stays a single number, and a debt payment is an item that reduces it.
 * @param {{pension?: number, payments?: number, livingCosts?: number}} values - numbers from the old fields
 * @param {Function} localize - turns a key into text
 * @returns {RecurringItem[]}
 */
export function seedRecurringItems({pension = 0, payments = 0, livingCosts = 0} = {}, localize = key => key) {
  const items = [];
  const add = (id, key, amount, category, frequency) => {
    const value = Math.abs(Number(amount));
    if (Number.isFinite(value) && value > 0) {
      items.push(createRecurringItem({
        name: localize(key), amount: category === "income" ? value : -value, account: "digital", category, frequency
      }, id));
    }
  };
  add("seed-living", "TWODSIX_LEDGER.SEED_LIVING", livingCosts, "living", "month");
  add("seed-ship", "TWODSIX_LEDGER.SEED_SHIP", payments, "ship", "month");
  add("seed-pension", "TWODSIX_LEDGER.SEED_PENSION", pension, "income", "year");
  return items;
}

/**
 * Totals of the active items, for the summary line.
 * @param {RecurringItem[]} items
 * @returns {{monthly: {net: number, costs: number, income: number, count: number}, yearly: {net: number, count: number}}}
 */
export function summarizeRecurring(items) {
  const monthly = {net: 0, costs: 0, income: 0, count: 0};
  const yearly = {net: 0, count: 0};
  for (const item of items) {
    if (!item.active) {
      continue;
    }
    if (item.frequency === "year") {
      yearly.net += item.amount;
      yearly.count += 1;
    } else {
      monthly.net += item.amount;
      monthly.count += 1;
      if (item.amount < 0) {
        monthly.costs += item.amount;
      } else {
        monthly.income += item.amount;
      }
    }
  }
  return {
    monthly: {net: roundMoney(monthly.net), costs: roundMoney(monthly.costs), income: roundMoney(monthly.income), count: monthly.count},
    yearly: {net: roundMoney(yearly.net), count: yearly.count}
  };
}

/**
 * What pressing Pay on one item does: the ledger entry to add and how much the debt goes down.
 * An item that reduces debt never pays more than what is owed. Returns null when there is nothing to do.
 * @param {RecurringItem} item
 * @param {{debt?: number}} [context] - the traveller's current debt
 * @returns {{amount: number, account: string, category: string, description: string, debtChange: number, itemId: string}|null}
 */
export function planPayment(item, {debt = 0} = {}) {
  if (!item?.active || !Number.isFinite(item.amount) || item.amount === 0) {
    return null;
  }
  let amount = item.amount;
  let debtChange = 0;
  if (item.reducesDebt) {
    const owed = Math.max(Number(debt) || 0, 0);
    const paid = Math.min(Math.abs(amount), owed);
    if (paid === 0) {
      return null;
    }
    amount = amount < 0 ? -paid : paid;
    debtChange = -paid;
  }
  return {amount, account: item.account, category: item.category, description: item.name, debtChange, itemId: item.id};
}

/**
 * What "Pay all" does: every active monthly item, in list order. Yearly items are left out on purpose, because they
 * are paid out at a different time, and so is anything with nothing to pay.
 * @param {RecurringItem[]} items
 * @param {{debt?: number}} [context]
 * @returns {Array<ReturnType<typeof planPayment>>}
 */
export function planPayAll(items, {debt = 0} = {}) {
  const plans = [];
  let owed = Number(debt) || 0;
  for (const item of items) {
    if (item.frequency !== "month") {
      continue;
    }
    const plan = planPayment(item, {debt: owed});
    if (plan) {
      plans.push(plan);
      owed += plan.debtChange;
    }
  }
  return plans;
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
 * Text for the Pay button of an item, as a key and the amount, so the sheet can write "Pay" or "Receive".
 * @param {RecurringItem} item
 * @returns {"pay"|"receive"}
 */
export function getPayKind(item) {
  return item.amount > 0 ? "receive" : "pay";
}
