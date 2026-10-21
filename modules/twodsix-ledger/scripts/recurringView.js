/**
 * Builds what the "Recurring" part of the Finances tab needs to show, as plain data. Pure (no Foundry globals), like
 * financeView.js, so it can be unit tested in Node.
 */

import { LEDGER_ACCOUNTS, LEDGER_CATEGORIES, formatLedgerNumber } from "./ledger.js";
import { FREQUENCIES, getPayKind, planPayAll, planPayment, summarizeRecurring } from "./recurring.js";

const PREFIX = "TWODSIX_LEDGER";

/**
 * @param {number} value
 * @returns {"positive"|"negative"|""}
 */
function signClass(value) {
  if (value > 0) {
    return "positive";
  }
  return value < 0 ? "negative" : "";
}

/**
 * @param {object} args
 * @param {Array<object>} args.items - recurring items
 * @param {number} [args.debt] - current debt, which decides whether a debt payment can be made
 * @param {string} [args.locale]
 * @param {(key: string) => string} args.localize
 * @param {string} [args.gameDate] - the current in-game date, "" if the world has no calendar
 * @returns {object}
 */
export function buildRecurringView({items = [], debt = 0, locale = "en", localize, gameDate = ""}) {
  const select = (options, selected) => options.map(option => ({...option, selected: option.key === selected}));
  const accountOptions = LEDGER_ACCOUNTS.map(key => ({key, label: localize(`${PREFIX}.${key.toUpperCase()}`)}));
  const categoryOptions = LEDGER_CATEGORIES.map(key => ({key, label: localize(`${PREFIX}.CATEGORIES.${key}`)}));
  const frequencyOptions = FREQUENCIES.map(key => ({key, label: localize(`${PREFIX}.PER_${key.toUpperCase()}`)}));

  const rows = items.map(item => {
    const plan = planPayment(item, {debt});
    const kind = getPayKind(item);
    return {
      id: item.id,
      name: item.name,
      active: item.active,
      reducesDebt: item.reducesDebt,
      isYearly: item.frequency === "year",
      amountText: formatLedgerNumber(item.amount, locale, true),
      amountClass: item.active ? signClass(item.amount) : "",
      accounts: select(accountOptions, item.account),
      categories: select(categoryOptions, item.category),
      frequencies: select(frequencyOptions, item.frequency),
      payLabel: localize(`${PREFIX}.${kind === "receive" ? "RECEIVE" : "PAY"}`),
      canPay: plan !== null,
      /** Why the button is off, for its tooltip */
      payHint: plan !== null ? "" : localize(`${PREFIX}.${!item.active ? "PAY_OFF" : item.amount === 0 ? "PAY_NO_AMOUNT" : "PAY_NO_DEBT"}`)
    };
  });

  const summary = summarizeRecurring(items);
  const plans = planPayAll(items, {debt});
  const payAllTotal = plans.reduce((sum, plan) => sum + plan.amount, 0);
  return {
    rows,
    hasItems: rows.length > 0,
    gameDate,
    monthText: formatLedgerNumber(summary.monthly.net, locale, true),
    monthClass: signClass(summary.monthly.net),
    showYear: summary.yearly.count > 0,
    yearText: formatLedgerNumber(summary.yearly.net, locale, true),
    yearClass: signClass(summary.yearly.net),
    canPayAll: plans.length > 0,
    payAllCount: plans.length,
    payAllTotalText: formatLedgerNumber(payAllTotal, locale, true)
  };
}
