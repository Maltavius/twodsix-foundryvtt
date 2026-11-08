/**
 * Import of the money a character got in character generation.
 *
 * The module "Twodsix Chargen MgT2e" saves the result of the money part of character generation as a flag on the
 * actor (`flags.twodsix-chargen-mgt2e.finances`). This file reads that flag and works out what to put in the ledger.
 * Nothing is shared with the chargen module: the ledger only reads the flag, and works without it.
 * Pure logic with no Foundry globals, so it can be unit tested in Node.
 *
 * The flag (version 1) has `entries`, each with a `kind` (income, expense, debt, pension, shipShares), a `source`, a
 * `label` and a positive `amount`. The sheet's own Cash, Debt and Pension fields already hold the totals: the ledger
 * never changes the cash balance when importing, it only adds the history that explains it.
 */

import { LEDGER_ACCOUNTS, buildAdjustmentEntries, computeRunningBalances, createTransaction, secondaryAccount } from "./ledger.js";
import { createLoan, totalOwed } from "./loans.js";
import { createRecurringItem } from "./recurring.js";

export const CHARGEN_MODULE_ID = "twodsix-chargen-mgt2e";
/** The newest version of the flag that this code understands */
export const SUPPORTED_VERSION = 1;

const KINDS = ["income", "expense", "debt", "pension", "shipShares"];
/** History category of an expense, by what it was for. Anything else is "other". */
const EXPENSE_CATEGORY = {medicalCare: "medical", anagathics: "medical", medicalBills: "medical", lawyer: "other"};

/**
 * @typedef {object} ChargenEntry
 * @property {string} id
 * @property {string} kind - income, expense, debt, pension or shipShares
 * @property {string} source
 * @property {string} label
 * @property {number} amount - always positive
 */

/**
 * Read and check the flag.
 * @param {unknown} raw - the flag as saved on the actor
 * @returns {{ok: true, createdAt: number, entries: ChargenEntry[]} | {ok: false, reason: "missing"|"version"|"invalid"}}
 *   `version` means the flag is from a newer version than this code understands: it is left alone.
 */
export function readChargenFinances(raw) {
  if (!raw || typeof raw !== "object") {
    return {ok: false, reason: "missing"};
  }
  const version = Number(raw.version);
  if (!Number.isFinite(version) || version < 1) {
    return {ok: false, reason: "invalid"};
  }
  if (version > SUPPORTED_VERSION) {
    return {ok: false, reason: "version"};
  }
  const seen = new Set();
  const entries = [];
  for (const entry of Array.isArray(raw.entries) ? raw.entries : []) {
    const amount = Math.abs(Number(entry?.amount));
    if (!KINDS.includes(entry?.kind) || !Number.isFinite(amount) || amount === 0) {
      continue;
    }
    const source = String(entry.source ?? "");
    const id = String(entry.id ?? `${entry.kind}-${source}`);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    entries.push({id, kind: entry.kind, source, label: String(entry.label ?? "").trim() || source || entry.kind, amount});
  }
  const createdAt = Date.parse(raw.createdAt);
  return {ok: true, createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(), entries};
}

/**
 * @param {string|undefined} activeGmId - id of the GM who is online, if any
 * @param {string[]} ownerIds - ids of the online users who own the actor
 * @returns {string|undefined} the one user whose client does the import, so that two clients never book the same thing:
 *   the GM if there is one online, otherwise the owner with the lowest id
 */
export function chooseImporterId(activeGmId, ownerIds) {
  return activeGmId ?? [...ownerIds].sort()[0];
}

/**
 * @param {string} text
 * @returns {string} text that is safe inside HTML
 */
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Work out what to add to the ledger.
 * @param {ChargenEntry[]} entries
 * @param {object} state - what the actor has now
 * @param {Array<object>} state.transactions - ledger entries, oldest first
 * @param {Record<string, number>} state.balances - the balance of each account
 * @param {Array<object>|undefined} state.storedLoans - the saved loans; undefined if the list was never saved
 * @param {Array<object>} state.recurring - the recurring items (the list that would be shown)
 * @param {string} state.notes - the sheet's financial notes (HTML)
 * @param {object} text
 * @param {string} text.prefix - for example "Character generation"
 * @param {string} text.opening - for example "opening balance"
 * @param {number} [createdAt] - when the character was generated (ms); not used for the history, which gets no date
 * @param {Function} makeId - returns a fresh unique id
 * @returns {{transactions: Array<object>|null, loans: Array<object>|null, recurring: Array<object>|null,
 *   notes: string|null, counts: object}} what to save; null means "leave as it is"
 */
export function planChargenImport(entries, state, text, createdAt, makeId) {
  // The entries get no date at all (timestamp 0 shows as an empty date): the real date of character generation is not an
  // in-game date, and an in-game date would have to be guessed. The order of the history is the order of the list.
  const time = 0;

  // History: income and expenses of the cash account, oldest of all. The cash balance itself is not touched.
  const money = entries.filter(entry => entry.kind === "income" || entry.kind === "expense");
  const imported = money.map(entry => createTransaction({
    amount: entry.kind === "income" ? entry.amount : -entry.amount,
    account: "cash",
    category: entry.kind === "income" ? "income" : (EXPENSE_CATEGORY[entry.source] ?? "other"),
    description: `${text.prefix}: ${entry.label}`
  }, makeId(), time));
  let transactions = null;
  if (imported.length) {
    // If the history and the balance do not add up (cash changed before the ledger ran), one entry makes up the difference
    const combined = [...imported, ...state.transactions];
    const {opening} = computeRunningBalances(combined, state.balances);
    const zero = Object.fromEntries(LEDGER_ACCOUNTS.map(account => [account, 0]));
    const balancing = buildAdjustmentEntries(zero, opening, makeId, {description: `${text.prefix}: ${text.opening}`})
      .map(entry => ({...entry, timestamp: time}));
    transactions = [...balancing, ...combined];
  }

  // Debts: loans without any money changing hands. A list that has been saved is the player's own and is left alone.
  const debts = entries.filter(entry => entry.kind === "debt");
  let loans = null;
  if (debts.length && state.storedLoans === undefined) {
    loans = debts.map(entry => createLoan({name: entry.label, remaining: entry.amount}, makeId()));
  }

  // Pension: a yearly recurring item, unless the list already has one for that amount (a list that was never saved
  // is built from the sheet's Pension field, which holds the same pension)
  let recurring = null;
  const list = [...state.recurring];
  for (const entry of entries.filter(candidate => candidate.kind === "pension")) {
    const present = list.some(item => item.group === "pension" && item.active && item.amount === entry.amount);
    if (!present) {
      list.push(createRecurringItem({
        name: entry.label, amount: entry.amount, account: secondaryAccount(), group: "pension", frequency: "year"
      }, makeId()));
      recurring = list;
    }
  }

  // Ship shares are not money: a line in the financial notes
  let notes = null;
  for (const entry of entries.filter(candidate => candidate.kind === "shipShares")) {
    const line = `<p>${escapeHtml(entry.label)}: ${entry.amount} (${escapeHtml(text.prefix)})</p>`;
    if (!(notes ?? state.notes).includes(line)) {
      notes = `${notes ?? state.notes}${line}`;
    }
  }

  return {
    transactions, loans, recurring, notes,
    counts: {money: imported.length, debts: loans ? loans.length : 0, debtTotal: loans ? totalOwed(loans) : 0}
  };
}
