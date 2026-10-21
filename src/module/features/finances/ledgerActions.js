/**
 * Foundry-aware operations on a traveller's finance ledger.
 * The pure logic lives in ./ledger.js; this file reads and writes actor data.
 *
 * All writes pass `{twodsixLedger: true}` so that the actor's `_preUpdate` knows the ledger is being kept up to date
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
function getStoredBalances(actor) {
  const stored = actor.system._source.financeValues ?? {};
  return Object.fromEntries(LEDGER_ACCOUNTS.map(account => [account, Number(stored[account]) || 0]));
}

/**
 * @param {TwodsixActor} actor
 * @returns {Array<object>} plain copy of the stored ledger entries, oldest first
 */
function getStoredTransactions(actor) {
  return foundry.utils.deepClone(actor.system._source.ledger?.transactions ?? []);
}

/**
 * Write new balances and the ledger in one update, so that they cannot drift apart.
 * @param {TwodsixActor} actor
 * @param {Record<string, number>} newBalances
 * @param {Array<object>} newTransactions
 * @returns {Promise<TwodsixActor>}
 */
async function writeLedger(actor, newBalances, newTransactions) {
  const oldBalances = getStoredBalances(actor);
  const update = {"system.ledger.transactions": newTransactions};
  for (const account of LEDGER_ACCOUNTS) {
    if (newBalances[account] !== oldBalances[account]) {
      update[`system.financeValues.${account}`] = newBalances[account];
    }
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
  await writeLedger(actor, revertTransaction(getStoredBalances(actor), removed), transactions);
  return removed;
}

/**
 * Called from the actor's `_preUpdate` after the finance text and numeric values have been reconciled.
 * If a balance changes without going through the ledger (the player typed into the Cash field, a macro, another
 * module such as Item Piles) an "adjustment" entry is appended to the same update so that the history stays honest.
 * @param {TwodsixActor} actor
 * @param {object} data - the (expanded) update data, modified in place
 * @param {object} options - update options
 * @returns {void}
 */
export function recordLedgerAdjustments(actor, data, options) {
  if (options?.twodsixLedger || actor.type !== "traveller") {
    return;
  }
  const newValues = data?.system?.financeValues;
  if (!newValues || data.system.ledger?.transactions) {
    return; // nothing changed, or the caller is managing the ledger itself
  }
  const entries = buildAdjustmentEntries(getStoredBalances(actor), newValues, () => foundry.utils.randomID(), {
    description: game.i18n.localize("TWODSIX.Actor.Finances.MANUAL_ADJUSTMENT"),
    gameDate: getCurrentGameDate(),
    userId: game.user?.id
  });
  if (entries.length) {
    foundry.utils.setProperty(data, "system.ledger.transactions", [...getStoredTransactions(actor), ...entries]);
  }
}
