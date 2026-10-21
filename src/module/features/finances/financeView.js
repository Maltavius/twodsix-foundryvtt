/**
 * Builds everything the Finances tab template needs to show, as plain data.
 * Pure (no Foundry globals) so it can be unit tested in Node. The sheet passes in what it knows: the actor's stored
 * values, the state of the filter and search boxes, the locale and the localized labels.
 */

import {
  LEDGER_ACCOUNTS,
  LEDGER_CATEGORIES,
  buildLedgerRows,
  formatLedgerNumber,
  getTotalFunds,
  parseLedgerAmount,
  roundMoney
} from "./ledger.js";

export const DEFAULT_ROW_LIMIT = 50;
export const ROW_LIMIT_STEP = 50;

/**
 * @typedef {object} FinanceUiState
 * @property {string} [filter] - "all", "cash" or "digital"
 * @property {string} [search]
 * @property {number} [limit] - number of history rows to show
 * @property {string} [mode] - "add" or "move"
 */

/**
 * Pick the label of the button for the add form from the text currently typed in the amount box.
 * @param {string} amountText
 * @param {string} [locale]
 * @returns {{kind: "neutral"|"income"|"expense", labelKey: string}}
 */
export function getAddButtonState(amountText, locale = "en") {
  const value = parseLedgerAmount(String(amountText ?? ""), locale);
  if (Number.isFinite(value) && value > 0) {
    return {kind: "income", labelKey: "TWODSIX.Actor.Finances.ADD_INCOME"};
  }
  if (Number.isFinite(value) && value < 0) {
    return {kind: "expense", labelKey: "TWODSIX.Actor.Finances.ADD_EXPENSE"};
  }
  return {kind: "neutral", labelKey: "TWODSIX.Actor.Finances.ADD"};
}

/**
 * @param {object} transaction
 * @returns {{text: string, isRealDate: boolean}}
 */
function formatRowDate(transaction) {
  if (transaction.gameDate) {
    return {text: transaction.gameDate, isRealDate: false};
  }
  const timestamp = Number(transaction.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    // Same year-month-day order as the in-game dates, so the column looks the same whichever kind of date a row has
    const date = new Date(timestamp);
    const pad = value => String(value).padStart(2, "0");
    return {text: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, isRealDate: true};
  }
  return {text: "", isRealDate: true};
}

/**
 * @param {number} value
 * @returns {"positive"|"negative"|"zero"}
 */
function signClass(value) {
  if (value > 0) {
    return "positive";
  }
  return value < 0 ? "negative" : "zero";
}

/**
 * Build the view model for the Finances tab.
 * @param {object} args
 * @param {Array<object>} args.transactions - stored ledger, oldest first
 * @param {Record<string, number>} args.balances - current numeric balances, e.g. {cash: 12000, digital: 300}
 * @param {number} [args.debt] - current numeric debt, for "net of debt"
 * @param {FinanceUiState} [args.ui]
 * @param {string} [args.locale]
 * @param {(key: string) => string} args.localize
 * @returns {object}
 */
export function buildFinanceView({transactions = [], balances = {}, debt = 0, ui = {}, locale = "en", localize}) {
  const filter = ["all", ...LEDGER_ACCOUNTS].includes(ui.filter) ? ui.filter : "all";
  const search = String(ui.search ?? "");
  const limit = Number.isFinite(ui.limit) && ui.limit > 0 ? ui.limit : DEFAULT_ROW_LIMIT;
  const mode = ui.mode === "move" ? "move" : "add";
  const prefix = "TWODSIX.Actor.Finances";

  const current = Object.fromEntries(LEDGER_ACCOUNTS.map(account => [account, roundMoney(Number(balances[account]) || 0)]));
  const total = getTotalFunds(current);
  const netOfDebt = roundMoney(total - (Number(debt) || 0));

  const categoryLabels = Object.fromEntries(
    [...LEDGER_CATEGORIES, "transfer", "adjustment"].map(category => [category, localize(`${prefix}.CATEGORIES.${category}`)])
  );
  const accountLabels = {cash: localize(`${prefix}.CASH`), digital: localize(`${prefix}.DIGITAL`)};

  const {rows, totalMatching, opening} = buildLedgerRows(transactions, current, {filter, search, categoryLabels, limit});

  const viewRows = rows.map(row => {
    const {transaction} = row;
    const date = formatRowDate(transaction);
    const accountKey = row.isTransfer ? "transfer" : transaction.account;
    const accountText = row.isTransfer
      ? `${accountLabels[transaction.account]} → ${accountLabels[transaction.toAccount]}`
      : accountLabels[transaction.account];
    const showTransferSize = row.isTransfer && filter === "all";
    const amount = showTransferSize ? row.transferAmount : row.viewAmount;
    return {
      id: row.id,
      dateText: date.text,
      isRealDate: date.isRealDate,
      description: transaction.description || categoryLabels[transaction.category] || "",
      categoryLabel: categoryLabels[transaction.category] ?? "",
      showCategory: Boolean(transaction.description) && Boolean(categoryLabels[transaction.category]),
      accountKey,
      accountText,
      isTransfer: row.isTransfer,
      amountText: showTransferSize ? formatLedgerNumber(amount, locale) : formatLedgerNumber(amount, locale, true),
      amountClass: showTransferSize ? "transfer" : signClass(amount),
      balanceText: formatLedgerNumber(row.viewBalance, locale)
    };
  });

  return {
    mode,
    isMoveMode: mode === "move",
    filter,
    search,
    filters: ["all", ...LEDGER_ACCOUNTS].map(key => ({
      key,
      label: key === "all" ? localize(`${prefix}.ALL`) : accountLabels[key],
      active: key === filter
    })),
    totals: {
      total: formatLedgerNumber(total, locale),
      cash: formatLedgerNumber(current.cash, locale),
      digital: formatLedgerNumber(current.digital, locale),
      netOfDebt: formatLedgerNumber(netOfDebt, locale),
      showNetOfDebt: (Number(debt) || 0) !== 0,
      totalClass: signClass(total),
      cashClass: signClass(current.cash),
      digitalClass: signClass(current.digital)
    },
    categories: LEDGER_CATEGORIES.map(key => ({key, label: categoryLabels[key]})),
    accounts: LEDGER_ACCOUNTS.map(key => ({key, label: accountLabels[key]})),
    rows: viewRows,
    hasTransactions: transactions.length > 0,
    noMatches: transactions.length > 0 && viewRows.length === 0,
    opening: opening === null ? null : {text: formatLedgerNumber(opening, locale)},
    canUndo: transactions.length > 0,
    hasMore: totalMatching > viewRows.length,
    hiddenCount: Math.max(0, totalMatching - viewRows.length),
    nextLimit: limit + ROW_LIMIT_STEP
  };
}
