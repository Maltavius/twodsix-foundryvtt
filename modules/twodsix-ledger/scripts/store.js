/**
 * Foundry-aware operations on a traveller's finance ledger, stored as flags on the actor.
 * The pure logic lives in ./ledger.js; this file reads and writes actor data.
 *
 * Storage (all on the actor):
 * - cash:     system.financeValues.cash (the system's own number, kept in sync with its text field by the system)
 * - digital:  flags.twodsix-ledger.digital
 * - ledger:   flags.twodsix-ledger.transactions
 *
 * All writes pass `{twodsixLedger: true}` so that the `preUpdateActor` hook knows the ledger is being kept up to date
 * and does not add an automatic "adjustment" entry for the balance change.
 */

import {
  applyTransaction,
  buildAdjustmentEntries,
  createTransaction,
  DEFAULT_LEDGER_ACCOUNT,
  DEFAULT_LEDGER_CATEGORY,
  LEDGER_ACCOUNTS,
  revertTransaction,
  roundUpCr
} from './ledger.js';

import { financeTextToNumber, parseLocaleNumber } from './financeText.js';
import {
  createRecurringItem,
  normalizeRecurringItems,
  planPayAll,
  planPayment,
  removeRecurringItem,
  seedRecurringItems,
  updateRecurringItem
} from './recurring.js';

export const MODULE_ID = "twodsix-ledger";

/** @typedef {import("../../entities/TwodsixActor").default} TwodsixActor */

/**
 * @param {number} year
 * @param {number} month - 1 based
 * @param {number} day - 1 based
 * @returns {string} e.g. "3026-10-15"
 */
function formatDateParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The Simple Calendar API, if a Simple Calendar module is loaded. The original module and its forks (for example
 * "Simple Calendar Reborn") have different module ids but all provide the global `SimpleCalendar.api`, which only
 * exists while the module is running.
 * @returns {object|null}
 */
function getSimpleCalendarApi() {
  const api = globalThis.SimpleCalendar?.api;
  return typeof api?.timestamp === "function" && typeof api?.timestampToDate === "function" ? api : null;
}

/**
 * The date as Simple Calendar itself shows it (for example "Holiday 01, 1105"), so the ledger matches the calendar
 * window. Returns "" if no such text can be found.
 * @param {object} api - the Simple Calendar API
 * @param {object} date - date parts from the API
 * @returns {string}
 */
function formatWithSimpleCalendar(api, date) {
  // The date parts already carry the text the calendar shows
  const displayed = date?.display?.date;
  if (typeof displayed === "string" && displayed.trim()) {
    return displayed.trim();
  }
  // Older versions: ask the calendar to format it. A failure here must not lose the date, so it is contained.
  try {
    const formatted = typeof api.formatDateTime === "function" ? api.formatDateTime(date) : undefined;
    const text = typeof formatted === "string" ? formatted : formatted?.date;
    return typeof text === "string" ? text.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Current in-game date as text, or "" if the world has no usable calendar.
 * Uses Simple Calendar (the original or a fork such as Simple Calendar Reborn) if it is active, written the way the
 * calendar shows it. Without such a calendar there is no in-game date, and the history shows the real date instead.
 * (The core calendar is not used: by default it is the Gregorian calendar, which gives meaningless dates in a game
 * set in another era.)
 * @returns {string}
 */
export function getCurrentGameDate() {
  try {
    const api = getSimpleCalendarApi();
    if (api) {
      const date = api.timestampToDate(api.timestamp());
      const formatted = formatWithSimpleCalendar(api, date);
      if (formatted) {
        return formatted;
      }
      // Simple Calendar's month and day are zero based.
      if ([date?.year, date?.month, date?.day].every(Number.isFinite)) {
        return formatDateParts(date.year, date.month + 1, date.day + 1);
      }
    }
  } catch (err) {
    console.warn("twodsix | Could not read the in-game date for the finance ledger", err);
  }
  return "";
}

/**
 * @param {TwodsixActor} actor
 * @returns {Record<string, number>} the stored balance of each ledger account
 */
export function getStoredBalances(actor) {
  return {
    cash: Number(actor.system?._source?.financeValues?.cash) || 0,
    digital: Number(actor.getFlag(MODULE_ID, "digital")) || 0
  };
}

/**
 * @param {TwodsixActor} actor
 * @returns {Array<object>} plain copy of the stored ledger entries, oldest first
 */
export function getStoredTransactions(actor) {
  return foundry.utils.deepClone(actor.getFlag(MODULE_ID, "transactions") ?? []);
}

/**
 * Write new balances and the ledger in one update, so that they cannot drift apart.
 * @param {TwodsixActor} actor
 * @param {Record<string, number>} newBalances
 * @param {Array<object>} newTransactions
 * @param {object} [extra] - other update paths to write in the same update (for example the debt)
 * @returns {Promise<TwodsixActor>}
 */
async function writeLedger(actor, newBalances, newTransactions, extra = {}) {
  const oldBalances = getStoredBalances(actor);
  const update = {...extra, [`flags.${MODULE_ID}.transactions`]: newTransactions};
  if (newBalances.cash !== oldBalances.cash) {
    update["system.financeValues.cash"] = newBalances.cash;
  }
  if (newBalances.digital !== oldBalances.digital) {
    update[`flags.${MODULE_ID}.digital`] = newBalances.digital;
  }
  return actor.update(update, {twodsixLedger: true});
}

/**
 * Add income (positive amount) or an expense (negative amount) to one account.
 * @param {TwodsixActor} actor
 * @param {object} data
 * @param {number} data.amount - signed, in Cr. Rounded up to whole Cr. Must not be zero.
 * @param {string} [data.account] - "cash" or "digital"
 * @param {string} [data.category]
 * @param {string} [data.description]
 * @param {string} [data.gameDate] - defaults to the current in-game date, if any
 * @returns {Promise<object>} the transaction that was added
 */
export async function addTransaction(actor, {amount, account = DEFAULT_LEDGER_ACCOUNT, category = DEFAULT_LEDGER_CATEGORY, description = "", gameDate} = {}) {
  amount = roundUpCr(amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new TypeError("A transaction needs a non-zero amount");
  }
  if (!LEDGER_ACCOUNTS.includes(account)) {
    throw new TypeError(`Unknown finance account: ${account}`);
  }
  const transaction = createTransaction({
    amount, account, category, description,
    gameDate: gameDate ?? getCurrentGameDate(),
    userId: game.user?.id
  }, foundry.utils.randomID());
  const balances = applyTransaction(getStoredBalances(actor), transaction);
  await writeLedger(actor, balances, [...getStoredTransactions(actor), transaction]);
  return transaction;
}

/**
 * Move money between a traveller's own accounts. The total funds do not change.
 * @param {TwodsixActor} actor
 * @param {object} data
 * @param {number} data.amount - positive, in Cr. Rounded up to whole Cr.
 * @param {string} data.from - source account
 * @param {string} data.to - destination account
 * @param {string} [data.description]
 * @param {string} [data.gameDate]
 * @returns {Promise<object>} the transaction that was added
 */
export async function moveMoney(actor, {amount, from, to, description = "", gameDate} = {}) {
  amount = roundUpCr(amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new TypeError("Moving money needs a positive amount");
  }
  if (!LEDGER_ACCOUNTS.includes(from) || !LEDGER_ACCOUNTS.includes(to) || from === to) {
    throw new TypeError("Moving money needs two different accounts");
  }
  const transaction = createTransaction({
    amount, account: from, toAccount: to, description,
    gameDate: gameDate ?? getCurrentGameDate(),
    userId: game.user?.id
  }, foundry.utils.randomID());
  const balances = applyTransaction(getStoredBalances(actor), transaction);
  await writeLedger(actor, balances, [...getStoredTransactions(actor), transaction]);
  return transaction;
}

/**
 * Remove the newest ledger entry and undo its effect on the balances.
 * @param {TwodsixActor} actor
 * @returns {Promise<object|null>} the removed entry, or null if the ledger is empty
 */
export async function undoLastTransaction(actor) {
  const transactions = getStoredTransactions(actor);
  const removed = transactions.pop();
  if (!removed) {
    return null;
  }
  const extra = {};
  if (removed.debtChange) {
    // The entry was a debt payment: put the debt back as well
    extra["system.financeValues.debt"] = Math.max(getStoredDebt(actor) - removed.debtChange, 0);
  }
  await writeLedger(actor, revertTransaction(getStoredBalances(actor), removed), transactions, extra);
  return removed;
}

/**
 * @param {TwodsixActor} actor
 * @returns {number} the traveller's current debt, as a number
 */
export function getStoredDebt(actor) {
  return Number(actor.system?._source?.financeValues?.debt) || 0;
}

/**
 * The recurring items. A traveller who has never had a list gets one built from the sheet's old fields (Pension, Ship
 * payments, Living costs); it is only saved when something is changed, so just opening the tab writes nothing.
 * @param {TwodsixActor} actor
 * @returns {Array<object>}
 */
export function getRecurringItems(actor) {
  const stored = actor.getFlag(MODULE_ID, "recurring");
  if (stored !== undefined && stored !== null) {
    return normalizeRecurringItems(foundry.utils.deepClone(stored));
  }
  const finances = actor.system?._source?.finances ?? {};
  const number = key => financeTextToNumber(finances[key], parseLocaleNumber) || 0;
  return seedRecurringItems(
    {pension: number("pension"), payments: number("payments"), livingCosts: number("livingCosts")},
    key => game.i18n.localize(key)
  );
}

/**
 * @param {TwodsixActor} actor
 * @param {Array<object>} items
 * @returns {Promise<TwodsixActor>}
 */
async function saveRecurringItems(actor, items) {
  return actor.update({[`flags.${MODULE_ID}.recurring`]: items}, {twodsixLedger: true});
}

/**
 * Add a new item to the list.
 * @param {TwodsixActor} actor
 * @param {object} [data] - fields of the item; anything missing gets a default
 * @returns {Promise<object>} the item that was added
 */
export async function addRecurringItem(actor, data = {}) {
  const item = createRecurringItem(data, foundry.utils.randomID());
  await saveRecurringItems(actor, [...getRecurringItems(actor), item]);
  return item;
}

/**
 * @param {TwodsixActor} actor
 * @param {string} id
 * @param {object} patch - the fields to change
 * @returns {Promise<void>}
 */
export async function editRecurringItem(actor, id, patch) {
  await saveRecurringItems(actor, updateRecurringItem(getRecurringItems(actor), id, patch));
}

/**
 * @param {TwodsixActor} actor
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteRecurringItem(actor, id) {
  await saveRecurringItems(actor, removeRecurringItem(getRecurringItems(actor), id));
}

/**
 * Make the ledger entries for some payments in a single update, so that balances, debt and history cannot drift apart.
 * @param {TwodsixActor} actor
 * @param {Array<object>} plans - from planPayment / planPayAll
 * @param {string} [gameDate]
 * @returns {Promise<Array<object>>} the entries that were added
 */
async function postPayments(actor, plans, gameDate) {
  if (!plans.length) {
    return [];
  }
  const date = gameDate ?? getCurrentGameDate();
  let balances = getStoredBalances(actor);
  const entries = plans.map(plan => {
    const entry = createTransaction({
      amount: plan.amount, account: plan.account, category: plan.category, description: plan.description,
      gameDate: date, userId: game.user?.id
    }, foundry.utils.randomID());
    if (plan.debtChange) {
      entry.debtChange = plan.debtChange;
    }
    balances = applyTransaction(balances, entry);
    return entry;
  });
  const debtChange = plans.reduce((sum, plan) => sum + plan.debtChange, 0);
  const extra = debtChange ? {"system.financeValues.debt": Math.max(getStoredDebt(actor) + debtChange, 0)} : {};
  await writeLedger(actor, balances, [...getStoredTransactions(actor), ...entries], extra);
  return entries;
}

/**
 * Pay (or receive) one item.
 * @param {TwodsixActor} actor
 * @param {string} id
 * @returns {Promise<object|null>} the entry, or null if there was nothing to pay
 */
export async function payRecurringItem(actor, id) {
  const item = getRecurringItems(actor).find(entry => entry.id === id);
  const plan = item ? planPayment(item, {debt: getStoredDebt(actor)}) : null;
  const [entry] = plan ? await postPayments(actor, [plan]) : [];
  return entry ?? null;
}

/**
 * Pay every active monthly item.
 * @param {TwodsixActor} actor
 * @returns {Promise<Array<object>>} the entries that were added
 */
export async function payAllRecurring(actor) {
  return postPayments(actor, planPayAll(getRecurringItems(actor), {debt: getStoredDebt(actor)}));
}

/**
 * Called from the `preUpdateActor` hook, which runs after the system has reconciled the finance text and numeric values.
 * If a balance changes without going through the ledger (the player typed into the Cash or Digital field, a macro,
 * another module such as Item Piles) an "adjustment" entry is appended to the same update so that the history stays honest.
 * @param {TwodsixActor} actor
 * @param {object} data - the (expanded) update data, modified in place
 * @param {object} options - update options
 * @returns {void}
 */
export function recordLedgerAdjustments(actor, data, options) {
  if (options?.twodsixLedger || actor.type !== "traveller") {
    return;
  }
  const ledgerChanges = data?.flags?.[MODULE_ID];
  if (ledgerChanges?.transactions) {
    return; // the caller is managing the ledger itself
  }
  const newValues = {};
  if (data?.system?.financeValues && "cash" in data.system.financeValues) {
    newValues.cash = data.system.financeValues.cash;
  }
  if (ledgerChanges && "digital" in ledgerChanges) {
    newValues.digital = ledgerChanges.digital;
  }
  if (Object.keys(newValues).length === 0) {
    return;
  }
  const entries = buildAdjustmentEntries(getStoredBalances(actor), newValues, () => foundry.utils.randomID(), {
    description: game.i18n.localize("TWODSIX_LEDGER.MANUAL_ADJUSTMENT"),
    gameDate: getCurrentGameDate(),
    userId: game.user?.id
  });
  if (entries.length) {
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.transactions`, [...getStoredTransactions(actor), ...entries]);
  }
}
