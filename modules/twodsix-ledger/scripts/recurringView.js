/**
 * Builds what the group cards and their panels in the Finances tab need to show, as plain data. Pure (no Foundry
 * globals), like financeView.js, so it can be unit tested in Node.
 *
 * There are four groups, matching the old fields of the sheet: Pension, Living costs, Ship payments and Debt. The first
 * three hold recurring items, the last one holds loans. Each group is a card; the one that is open shows its panel.
 */

import { LEDGER_ACCOUNTS, accountLabel, formatLedgerNumber, hasFunds } from "./ledger.js";
import { FREQUENCIES, getPayKind, itemsInGroup, summarizeItems } from "./recurring.js";
import { totalOwed } from "./loans.js";

const PREFIX = "TWODSIX_LEDGER";
const DEBT_GROUP = "debt";
const CARD_ORDER = ["pension", "living", "ship", DEBT_GROUP];

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
 * "-800/month", "+500/year", both of them, or "0" when there is nothing.
 * @param {{monthly: {net: number, count: number}, yearly: {net: number, count: number}}} summary
 * @param {string} locale
 * @param {(key: string) => string} localize
 * @returns {string}
 */
function formatSummary(summary, locale, localize) {
  const parts = [];
  if (summary.monthly.count) {
    parts.push(`${formatLedgerNumber(summary.monthly.net, locale, true)}${localize(`${PREFIX}.PER_MONTH`)}`);
  }
  if (summary.yearly.count) {
    parts.push(`${formatLedgerNumber(summary.yearly.net, locale, true)}${localize(`${PREFIX}.PER_YEAR`)}`);
  }
  return parts.length ? parts.join(" ") : "0";
}

/**
 * The amounts of a group as separate parts, so the sheet can show the number big and "/month" small and grey.
 * @param {{monthly: {net: number, count: number}, yearly: {net: number, count: number}}} summary
 * @param {string} locale
 * @param {(key: string) => string} localize
 * @returns {Array<{value: string, unit: string, className: string}>} "0" with no unit if there is nothing
 */
function summaryParts(summary, locale, localize) {
  const parts = [];
  if (summary.monthly.count) {
    parts.push({value: formatLedgerNumber(summary.monthly.net, locale, true), unit: localize(`${PREFIX}.PER_MONTH`), className: signClass(summary.monthly.net)});
  }
  if (summary.yearly.count) {
    parts.push({value: formatLedgerNumber(summary.yearly.net, locale, true), unit: localize(`${PREFIX}.PER_YEAR`), className: signClass(summary.yearly.net)});
  }
  return parts.length ? parts : [{value: "0", unit: "", className: ""}];
}

/**
 * @param {number} count
 * @param {string} oneKey
 * @param {string} manyKey
 * @param {(key: string) => string} localize
 * @returns {string} e.g. "2 items"
 */
function countText(count, oneKey, manyKey, localize) {
  return `${count} ${localize(`${PREFIX}.${count === 1 ? oneKey : manyKey}`)}`;
}

/**
 * @param {object} args
 * @param {Array<object>} args.items - recurring items
 * @param {Array<object>} args.loans
 * @param {string} [args.locale]
 * @param {(key: string) => string} args.localize
 * @param {string} [args.gameDate] - the current in-game date, "" if the world has no calendar
 * @param {string|null} [args.openGroup] - the group whose panel is open
 * @param {Record<string, number>} [args.balances] - what is on each account; a payment that is more than that
 *   cannot be paid. Left out, nothing is checked.
 * @returns {object}
 */
export function buildGroupsView({items = [], loans = [], locale = "en", localize, gameDate = "", openGroup = null, balances = null}) {
  const affordable = (account, amount) => !balances || hasFunds(balances[account] ?? 0, amount);
  const select = (options, selected) => options.map(option => ({...option, selected: option.key === selected}));
  const accountOptions = LEDGER_ACCOUNTS.map(key => ({key, label: accountLabel(key, localize)}));
  const frequencyOptions = FREQUENCIES.map(key => ({key, label: localize(`${PREFIX}.${key.toUpperCase()}`)}));
  const open = CARD_ORDER.includes(openGroup) ? openGroup : null;

  const cards = CARD_ORDER.map(key => {
    const label = localize(`${PREFIX}.GROUP_${key.toUpperCase()}`);
    if (key === DEBT_GROUP) {
      const owed = totalOwed(loans);
      const monthly = loans.reduce((sum, loan) => sum + (loan.remaining > 0 ? Math.min(loan.monthly, loan.remaining) : 0), 0);
      return {
        key, label, isDebt: true, open: open === key,
        amounts: [{value: formatLedgerNumber(owed, locale), unit: "Cr", className: owed > 0 ? "negative" : ""}],
        subText: monthly > 0
          ? `${countText(loans.length, "LOAN_ONE", "LOAN_MANY", localize)} · ${formatLedgerNumber(-monthly, locale, true)}${localize(`${PREFIX}.PER_MONTH`)}`
          : countText(loans.length, "LOAN_ONE", "LOAN_MANY", localize)
      };
    }
    const summary = summarizeItems(itemsInGroup(items, key));
    return {
      key, label, isDebt: false, open: open === key,
      amounts: summaryParts(summary, locale, localize),
      subText: countText(summary.count, "ITEM_ONE", "ITEM_MANY", localize)
    };
  });

  let panel = null;
  if (open === DEBT_GROUP) {
    panel = {
      key: DEBT_GROUP,
      label: localize(`${PREFIX}.GROUP_DEBT`),
      isDebt: true,
      rows: loans.map(loan => {
        const due = Math.min(loan.monthly, loan.remaining);
        const hasMoney = affordable(loan.account, -due);
        const canPay = loan.monthly > 0 && loan.remaining > 0 && hasMoney;
        return {
          id: loan.id,
          name: loan.name,
          remainingText: formatLedgerNumber(loan.remaining, locale),
          monthlyText: loan.monthly > 0 ? formatLedgerNumber(loan.monthly, locale) : "",
          accounts: select(accountOptions, loan.account),
          canPay,
          payLabel: canPay ? `${localize(`${PREFIX}.PAY`)} ${formatLedgerNumber(Math.min(loan.monthly, loan.remaining), locale)}` : localize(`${PREFIX}.PAY`),
          payHint: canPay ? "" : localize(`${PREFIX}.${loan.remaining <= 0 ? "PAY_NO_DEBT" : (loan.monthly > 0 ? "PAY_NO_FUNDS" : "PAY_NO_AMOUNT")}`),
          canPayCustom: loan.remaining > 0
        };
      }),
      hasRows: loans.length > 0,
      footerText: `${localize(`${PREFIX}.TOTAL_OWED`)} ${formatLedgerNumber(totalOwed(loans), locale)} Cr`
    };
  } else if (open) {
    const groupItems = itemsInGroup(items, open);
    const summary = summarizeItems(groupItems);
    panel = {
      key: open,
      label: localize(`${PREFIX}.GROUP_${open.toUpperCase()}`),
      isDebt: false,
      rows: groupItems.map(item => {
        const canPay = item.active && item.amount !== 0 && affordable(item.account, item.amount);
        return {
          id: item.id,
          name: item.name,
          active: item.active,
          amountText: formatLedgerNumber(item.amount, locale, true),
          amountClass: item.active ? signClass(item.amount) : "",
          accounts: select(accountOptions, item.account),
          frequencies: select(frequencyOptions, item.frequency),
          payLabel: localize(`${PREFIX}.${getPayKind(item) === "receive" ? "RECEIVE" : "PAY"}`),
          canPay,
          payHint: canPay ? "" : localize(`${PREFIX}.${!item.active ? "PAY_OFF" : (item.amount === 0 ? "PAY_NO_AMOUNT" : "PAY_NO_FUNDS")}`)
        };
      }),
      hasRows: groupItems.length > 0,
      footerText: summary.count ? `${localize(`${PREFIX}.SUM`)} ${formatSummary(summary, locale, localize)}` : ""
    };
  }

  return {gameDate, cards, panel, hasPanel: panel !== null};
}
