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
  hasFunds,
  LEDGER_ACCOUNTS,
  revertTransaction,
  roundUpCr
} from './ledger.js';

import { financeTextToNumber, parseLocaleNumber } from './financeText.js';
import {
  createRecurringItem,
  normalizeRecurringItems,
  planPayment,
  removeRecurringItem,
  seedRecurringItems,
  updateRecurringItem
} from './recurring.js';
import {
  applyLoanChange,
  createLoan,
  normalizeLoans,
  planLoanPayment,
  planNewLoan,
  removeLoan,
  revertLoanChange,
  seedLoans,
  totalOwed,
  updateLoan
} from './loans.js';

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
 * @returns {number|null} the number of the in-game month (the first is 1), or null if the world has no calendar
 */
export function getCurrentGameMonth() {
  try {
    const api = getSimpleCalendarApi();
    if (api) {
      const date = api.timestampToDate(api.timestamp());
      // Simple Calendar Reborn counts months from 1 (the date it shows is 1005-01-17 when `month` is 1), so the number is
      // used as it is. The shown month is preferred when it is a number.
      const shown = Number(date?.display?.month);
      if (Number.isFinite(shown) && shown > 0) {
        return shown;
      }
      if (Number.isFinite(date?.month)) {
        return date.month;
      }
    }
  } catch (err) {
    console.warn("twodsix | Could not read the in-game month for the finance ledger", err);
  }
  return null;
}

/**
 * Add the in-game month to the note of a payment that is made every month, when it is known: "Rent (month 3)".
 * @param {string} text
 * @returns {string}
 */
function withMonth(text) {
  const month = getCurrentGameMonth();
  return month === null ? text : `${text} (${game.i18n.format("TWODSIX_LEDGER.MONTH_NOTE", {month})})`;
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
  if (removed.loan) {
    // The entry was a loan payment or a new loan: change the loan back as well
    Object.assign(extra, loanUpdate(revertLoanChange(getLoans(actor), removed.loan)));
  }
  await writeLedger(actor, revertTransaction(getStoredBalances(actor), removed), transactions, extra);
  return removed;
}

/**
 * The loans. A traveller who has never had a list gets one built from the sheet's old Debt value; it is only saved when
 * something is changed, so just opening the tab writes nothing.
 * @param {TwodsixActor} actor
 * @returns {Array<object>}
 */
export function getLoans(actor) {
  const stored = actor.getFlag(MODULE_ID, "loans");
  if (stored !== undefined && stored !== null) {
    return normalizeLoans(foundry.utils.deepClone(stored));
  }
  const debt = Number(actor.system?._source?.financeValues?.debt) || 0;
  return seedLoans(debt, game.i18n.localize("TWODSIX_LEDGER.SEED_DEBT"));
}

/**
 * @param {Array<object>} loans
 * @returns {object} update paths for the loans and for the sheet's own debt number, which is what is owed in total
 */
function loanUpdate(loans) {
  return {[`flags.${MODULE_ID}.loans`]: loans, "system.financeValues.debt": totalOwed(loans)};
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
 * Add one ledger entry, and in the same update anything else that must change with it (a loan), so that balances,
 * loans and history cannot drift apart.
 * @param {TwodsixActor} actor
 * @param {object} data - amount, account, category, description, and `loan` (what changed on a loan) if any
 * @param {object} [extra] - other update paths
 * @returns {Promise<object>} the entry
 */
async function postEntry(actor, {amount, account, category, description, loan}, extra = {}) {
  const entry = createTransaction({
    amount, account, category, description, gameDate: getCurrentGameDate(), userId: game.user?.id
  }, foundry.utils.randomID());
  if (loan) {
    entry.loan = loan;
  }
  const balances = applyTransaction(getStoredBalances(actor), entry);
  await writeLedger(actor, balances, [...getStoredTransactions(actor), entry], extra);
  return entry;
}

/**
 * Pay (or receive) one recurring item.
 * @param {TwodsixActor} actor
 * @param {string} id
 * @returns {Promise<object|null>} the entry, or null if there was nothing to pay
 */
export async function payRecurringItem(actor, id) {
  const item = getRecurringItems(actor).find(entry => entry.id === id);
  const plan = planPayment(item);
  if (!plan || !hasFunds(getStoredBalances(actor)[plan.account], plan.amount)) {
    return null;
  }
  return postEntry(actor, item.frequency === "month" ? {...plan, description: withMonth(plan.description)} : plan);
}

/**
 * Add a loan to the list without any money changing hands (for a debt the traveller already has).
 * @param {TwodsixActor} actor
 * @param {object} [data] - name, remaining, monthly, account
 * @returns {Promise<object>} the loan
 */
export async function addLoan(actor, data = {}) {
  const loan = createLoan(data, foundry.utils.randomID());
  await actor.update(loanUpdate([...getLoans(actor), loan]), {twodsixLedger: true});
  return loan;
}

/**
 * Take a new loan: the loan is created and the money arrives on the chosen account, with an entry in the history.
 * @param {TwodsixActor} actor
 * @param {object} data - name, amount, account, monthly
 * @returns {Promise<object|null>} the entry, or null if the amount was not usable
 */
export async function takeLoan(actor, data) {
  const plan = planNewLoan(data, foundry.utils.randomID());
  if (!plan) {
    return null;
  }
  const loans = applyLoanChange(getLoans(actor), plan.entryLoan, plan.loan);
  const name = plan.loan.name || game.i18n.localize("TWODSIX_LEDGER.LOAN");
  return postEntry(actor, {
    amount: plan.amount,
    account: plan.account,
    category: "loan",
    description: `${game.i18n.localize("TWODSIX_LEDGER.LOAN_TAKEN")}: ${name}`,
    loan: plan.entryLoan
  }, loanUpdate(loans));
}

/**
 * Pay back some of a loan.
 * @param {TwodsixActor} actor
 * @param {string} id
 * @param {number} [amount] - the loan's monthly amount if left out. Never more than what is owed.
 * @returns {Promise<object|null>} the entry, or null if there was nothing to pay
 */
export async function payLoan(actor, id, amount) {
  const loans = getLoans(actor);
  const loan = loans.find(entry => entry.id === id);
  const plan = planLoanPayment(loan, amount);
  if (!plan || !hasFunds(getStoredBalances(actor)[plan.account], plan.amount)) {
    return null;
  }
  const name = loan.name || game.i18n.localize("TWODSIX_LEDGER.LOAN");
  return postEntry(actor, {
    amount: plan.amount,
    account: plan.account,
    category: "loan",
    description: amount === undefined ? withMonth(`${game.i18n.localize("TWODSIX_LEDGER.LOAN_PAYMENT")}: ${name}`) : `${game.i18n.localize("TWODSIX_LEDGER.LOAN_PAYMENT")}: ${name}`,
    loan: plan.loan
  }, loanUpdate(applyLoanChange(loans, plan.loan)));
}

/**
 * @param {TwodsixActor} actor
 * @param {string} id
 * @param {object} patch - the fields to change
 * @returns {Promise<void>}
 */
export async function editLoan(actor, id, patch) {
  await actor.update(loanUpdate(updateLoan(getLoans(actor), id, patch)), {twodsixLedger: true});
}

/**
 * @param {TwodsixActor} actor
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteLoan(actor, id) {
  await actor.update(loanUpdate(removeLoan(getLoans(actor), id)), {twodsixLedger: true});
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
