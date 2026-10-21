/**
 * Loans: the debts a traveller keeps track of (a bank, a ship mortgage, a criminal who must be paid back).
 * Pure logic with no Foundry globals, so it can be unit tested in Node.
 *
 * Only amounts are tracked, no interest: a player who wants interest adds it as a recurring item. The sheet's own debt
 * number is the sum of the loans, so the rest of the sheet keeps showing the right debt.
 */

import { LEDGER_ACCOUNTS, roundMoney, roundUpCr } from "./ledger.js";

/**
 * @typedef {object} Loan
 * @property {string} id
 * @property {string} name - who it is owed to, or what it is for
 * @property {number} remaining - what is still owed, in whole Cr, never negative
 * @property {number} monthly - what the Pay button pays, in whole Cr; 0 if there is no fixed amount
 * @property {string} account - the account the payments are taken from
 */

/**
 * @param {unknown} value
 * @returns {number} a whole, non-negative number of Cr (anything unusable becomes 0)
 */
function wholeCr(value) {
  const rounded = roundUpCr(Math.abs(Number(value)));
  return Number.isFinite(rounded) ? rounded : 0;
}

/**
 * Build a clean loan from loose data.
 * @param {object} data
 * @param {string} id
 * @returns {Loan}
 */
export function createLoan(data = {}, id) {
  return {
    id: String(id),
    name: String(data.name ?? "").trim(),
    remaining: wholeCr(data.remaining),
    monthly: wholeCr(data.monthly),
    account: LEDGER_ACCOUNTS.includes(data.account) ? data.account : "cash"
  };
}

/**
 * Clean up a stored list: anything that is not a loan with an id is dropped, and ids are kept unique.
 * @param {unknown} raw
 * @returns {Loan[]}
 */
export function normalizeLoans(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set();
  const loans = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || !entry.id || seen.has(String(entry.id))) {
      continue;
    }
    seen.add(String(entry.id));
    loans.push(createLoan(entry, entry.id));
  }
  return loans;
}

/**
 * The loans a traveller starts with: one that holds the debt already written in the sheet's old Debt field.
 * @param {number} debt
 * @param {string} name - the name to give it
 * @returns {Loan[]}
 */
export function seedLoans(debt, name = "") {
  const remaining = wholeCr(debt);
  return remaining > 0 ? [createLoan({name, remaining}, "seed-debt")] : [];
}

/**
 * @param {Loan[]} loans
 * @returns {number} everything that is still owed
 */
export function totalOwed(loans) {
  return roundMoney(loans.reduce((sum, loan) => sum + loan.remaining, 0));
}

/**
 * What paying a loan does. Never pays more than what is owed. Returns null when there is nothing to pay.
 * @param {Loan} loan
 * @param {number} [amount] - how much to pay; the loan's monthly amount if left out
 * @returns {{amount: number, account: string, loan: {id: string, delta: number}}|null} `amount` is the signed ledger
 *   entry, `loan.delta` the change of what is owed
 */
export function planLoanPayment(loan, amount) {
  if (!loan) {
    return null;
  }
  const wanted = amount === undefined ? loan.monthly : wholeCr(amount);
  const paid = Math.min(wanted, loan.remaining);
  if (!(paid > 0)) {
    return null;
  }
  return {amount: -paid, account: loan.account, loan: {id: loan.id, delta: -paid}};
}

/**
 * What taking a new loan does: the loan itself, and the money that arrives.
 * @param {{name?: string, amount: number, account?: string, monthly?: number}} data
 * @param {string} id
 * @returns {{loan: Loan, amount: number, account: string, entryLoan: {id: string, delta: number, created: true}}|null}
 *   `amount` is the (positive) ledger entry; null if the amount is not usable
 */
export function planNewLoan(data, id) {
  const amount = wholeCr(data?.amount);
  if (amount === 0) {
    return null;
  }
  const loan = createLoan({name: data.name, remaining: amount, monthly: data.monthly, account: data.account}, id);
  return {loan, amount, account: loan.account, entryLoan: {id: loan.id, delta: amount, created: true}};
}

/**
 * Apply the loan change of a ledger entry to the list (used when the entry is added).
 * @param {Loan[]} loans
 * @param {{id: string, delta: number, created?: boolean}} change
 * @param {Loan} [newLoan] - the loan to add, for an entry that created one
 * @returns {Loan[]}
 */
export function applyLoanChange(loans, change, newLoan) {
  if (change.created && newLoan) {
    return [...loans, newLoan];
  }
  return loans.map(loan => loan.id === change.id ? {...loan, remaining: Math.max(roundMoney(loan.remaining + change.delta), 0)} : loan);
}

/**
 * Undo the loan change of a ledger entry (used by Undo). A loan that the entry created goes away again. If the loan
 * has since been removed, there is nothing to restore.
 * @param {Loan[]} loans
 * @param {{id: string, delta: number, created?: boolean}} change
 * @returns {Loan[]}
 */
export function revertLoanChange(loans, change) {
  if (change.created) {
    return loans.filter(loan => loan.id !== change.id);
  }
  return loans.map(loan => loan.id === change.id ? {...loan, remaining: Math.max(roundMoney(loan.remaining - change.delta), 0)} : loan);
}

/**
 * Change one loan. Only known fields in the patch are used, and they go through the same cleaning as a new loan.
 * @param {Loan[]} loans
 * @param {string} id
 * @param {object} patch
 * @returns {Loan[]}
 */
export function updateLoan(loans, id, patch) {
  return loans.map(loan => loan.id === id ? createLoan({...loan, ...patch}, loan.id) : loan);
}

/**
 * @param {Loan[]} loans
 * @param {string} id
 * @returns {Loan[]}
 */
export function removeLoan(loans, id) {
  return loans.filter(loan => loan.id !== id);
}
