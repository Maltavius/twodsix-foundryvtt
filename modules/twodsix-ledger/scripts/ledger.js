/**
 * Pure helper functions for the traveller finance ledger.
 *
 * Nothing in this file touches Foundry globals (`game`, `foundry`, ...), so it can be unit tested in plain Node.
 *
 * Data conventions:
 * - A transaction has a signed `amount` (positive = money in, negative = money out) in Cr.
 * - A transfer between a traveller's own accounts has `account` (source), `toAccount` (destination)
 *   and a positive `amount`; it changes neither the total nor the sign convention above.
 * - Balances are never stored in the ledger. They are derived from the current account balances
 *   (`system.financeValues.<account>`) by walking the ledger backwards, so the table can never disagree
 *   with the balance, even for characters whose ledger starts part-way through their history.
 */

export const LEDGER_ACCOUNTS = ["cash", "digital"];

/** Categories a player can pick when adding a transaction. Order is the order shown in the form. */
export const LEDGER_CATEGORIES = ["other", "income", "living", "equipment", "medical", "ship", "trade", "loan"];

/** Categories created by the system itself. */
export const SYSTEM_CATEGORIES = ["transfer", "adjustment"];

/** The most accounts a traveller can have (the layout of the sheet is made for this many). */
export const MAX_LEDGER_ACCOUNTS = 4;

/** Categories that come with the module. They can be renamed, but not removed, because other parts of the ledger use them. */
export const BUILTIN_CATEGORIES = [...LEDGER_CATEGORIES];

const DEFAULT_ACCOUNTS = [...LEDGER_ACCOUNTS];
const customNames = {accounts: {}, categories: {}};

/**
 * Change which accounts and categories the ledger has, and what they are called. LEDGER_ACCOUNTS and LEDGER_CATEGORIES
 * are changed in place, so everything that reads them follows. Cash is always the first account. Anything unusable is
 * ignored, and there are never more than MAX_LEDGER_ACCOUNTS accounts.
 * @param {{accounts?: Array<{key: string, name?: string}>, categories?: Array<{key: string, name?: string}>}} [config]
 * @returns {void}
 */
export function configureLedger(config = {}) {
  const clean = value => String(value ?? "").trim();
  const accounts = [];
  const accountNames = {};
  const listed = Array.isArray(config.accounts) ? config.accounts : [];
  const cashEntry = listed.find(entry => clean(entry?.key) === "cash");
  for (const entry of [{key: "cash", name: cashEntry?.name}, ...listed]) {
    const key = clean(entry?.key);
    if (!/^[A-Za-z0-9_-]+$/.test(key) || accounts.includes(key) || accounts.length >= MAX_LEDGER_ACCOUNTS) {
      continue;
    }
    accounts.push(key);
    if (clean(entry.name)) {
      accountNames[key] = clean(entry.name);
    }
  }
  // Without a list the ledger has the two accounts it started with
  const useDefault = !Array.isArray(config.accounts) || config.accounts.length === 0;
  const finalAccounts = useDefault ? [...DEFAULT_ACCOUNTS] : accounts;
  LEDGER_ACCOUNTS.splice(0, LEDGER_ACCOUNTS.length, ...finalAccounts);

  const categories = [...BUILTIN_CATEGORIES];
  const categoryNames = {};
  for (const entry of Array.isArray(config.categories) ? config.categories : []) {
    const key = clean(entry?.key);
    if (!/^[A-Za-z0-9_-]+$/.test(key) || ["transfer", "adjustment"].includes(key)) {
      continue;
    }
    if (!categories.includes(key)) {
      categories.push(key);
    }
    if (clean(entry.name)) {
      categoryNames[key] = clean(entry.name);
    }
  }
  LEDGER_CATEGORIES.splice(0, LEDGER_CATEGORIES.length, ...categories);
  customNames.accounts = accountNames;
  customNames.categories = categoryNames;
}

/**
 * @param {string} key
 * @param {(key: string) => string} localize
 * @returns {string} the name given in the settings, else the name that comes with the module, else the key
 */
export function accountLabel(key, localize) {
  if (customNames.accounts[key]) {
    return customNames.accounts[key];
  }
  return key === "cash" || key === "digital" ? localize(`TWODSIX_LEDGER.${key.toUpperCase()}`) : String(key);
}

/**
 * @param {string} key
 * @param {(key: string) => string} localize
 * @returns {string} the name given in the settings, else the name that comes with the module, else "" for an unknown key
 */
export function categoryLabel(key, localize) {
  if (customNames.categories[key]) {
    return customNames.categories[key];
  }
  return BUILTIN_CATEGORIES.includes(key) || SYSTEM_CATEGORIES.includes(key) ? localize(`TWODSIX_LEDGER.CATEGORIES.${key}`) : "";
}

/**
 * @param {string} key
 * @returns {string} a name for the colour of the account: cash and digital keep theirs, the others take one by position
 */
export function accountTone(key) {
  if (key === "cash" || key === "digital") {
    return key;
  }
  return `tone-${Math.max(LEDGER_ACCOUNTS.indexOf(key), 0)}`;
}

/**
 * @returns {string} the account that is used for things that are not cash: Digital if there is one, else Cash
 */
export function secondaryAccount() {
  return LEDGER_ACCOUNTS.includes("digital") ? "digital" : "cash";
}

export const DEFAULT_LEDGER_ACCOUNT = "cash";
export const DEFAULT_LEDGER_CATEGORY = "other";

/**
 * Round to two decimals to keep floating point noise (0.1 + 0.2) out of balances.
 * @param {number} value
 * @returns {number}
 */
export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Round an amount entered by a player up to whole Cr, away from zero: 199.2 becomes 200 and -199.2 becomes -200.
 * Prices in the games are whole Cr, so the ledger does not take decimals from players.
 * Amounts below one hundredth count as zero, so 200.004 stays 200.
 * @param {number} value
 * @returns {number}
 */
export function roundUpCr(value) {
  const rounded = roundMoney(value);
  const result = rounded < 0 ? -Math.ceil(-rounded) : Math.ceil(rounded);
  return result === 0 ? 0 : result; // turns -0 into 0 and leaves NaN as NaN
}

/**
 * Effect of one transaction on each account.
 * @param {{amount: number, account: string, toAccount?: string|null}} transaction
 * @returns {Record<string, number>} effect per account, e.g. {cash: -200, digital: 0}
 */
export function getTransactionEffects(transaction) {
  const effects = Object.fromEntries(LEDGER_ACCOUNTS.map(account => [account, 0]));
  const amount = Number(transaction?.amount) || 0;
  const {account, toAccount} = transaction ?? {};
  if (toAccount && toAccount !== account) {
    if (account in effects) {
      effects[account] -= amount;
    }
    if (toAccount in effects) {
      effects[toAccount] += amount;
    }
  } else if (account in effects) {
    effects[account] += amount;
  }
  return effects;
}

/**
 * @param {Record<string, number>} balances
 * @returns {number} sum of all accounts
 */
export function getTotalFunds(balances) {
  return roundMoney(LEDGER_ACCOUNTS.reduce((sum, account) => sum + (Number(balances?.[account]) || 0), 0));
}

/**
 * Balances after applying a transaction.
 * @param {Record<string, number>} balances
 * @param {{amount: number, account: string, toAccount?: string|null}} transaction
 * @returns {Record<string, number>}
 */
export function applyTransaction(balances, transaction) {
  const effects = getTransactionEffects(transaction);
  return Object.fromEntries(LEDGER_ACCOUNTS.map(account => [account, roundMoney((Number(balances?.[account]) || 0) + effects[account])]));
}

/**
 * Balances before a transaction happened, given the balances after it.
 * @param {Record<string, number>} balances
 * @param {{amount: number, account: string, toAccount?: string|null}} transaction
 * @returns {Record<string, number>}
 */
export function revertTransaction(balances, transaction) {
  const effects = getTransactionEffects(transaction);
  return Object.fromEntries(LEDGER_ACCOUNTS.map(account => [account, roundMoney((Number(balances?.[account]) || 0) - effects[account])]));
}

/**
 * Walk the ledger backwards from the current balances to find the balances after each entry.
 * @param {Array<object>} transactions - in chronological order (oldest first)
 * @param {Record<string, number>} currentBalances - the balances right now
 * @returns {{after: Array<{balances: Record<string, number>, total: number}>, opening: Record<string, number>}}
 *   `after[i]` are the balances right after transaction i; `opening` are the balances before the first entry.
 */
export function computeRunningBalances(transactions, currentBalances) {
  const after = new Array(transactions.length);
  let balances = Object.fromEntries(LEDGER_ACCOUNTS.map(account => [account, roundMoney(Number(currentBalances?.[account]) || 0)]));
  for (let i = transactions.length - 1; i >= 0; i--) {
    after[i] = {balances, total: getTotalFunds(balances)};
    balances = revertTransaction(balances, transactions[i]);
  }
  return {after, opening: balances};
}

/**
 * Does a transaction touch the given account?
 * @param {object} transaction
 * @param {string} account
 * @returns {boolean}
 */
function touchesAccount(transaction, account) {
  return transaction.account === account || transaction.toAccount === account;
}

/**
 * Build the rows for the history table: newest first, filtered, searched and limited.
 * Amount and balance shown depend on the filter: with "all" the amount is the transaction itself and the balance
 * is the total funds; with an account selected they are that account's change and balance.
 * @param {Array<object>} transactions - chronological order (oldest first)
 * @param {Record<string, number>} currentBalances
 * @param {object} [options]
 * @param {string} [options.filter] - "all" or an account key
 * @param {string} [options.search] - case-insensitive text matched against description and category label
 * @param {Record<string, string>} [options.categoryLabels] - localized category labels (used for search only)
 * @param {number} [options.limit] - max rows returned (default no limit)
 * @returns {{rows: Array<object>, totalMatching: number, opening: number|null}}
 *   `opening` is the balance (for the current filter) before the oldest entry, or null if it is zero or the
 *   oldest entry is not part of this result because of search.
 */
export function buildLedgerRows(transactions, currentBalances, options = {}) {
  const {filter = "all", search = "", categoryLabels = {}, limit = Infinity} = options;
  const {after, opening} = computeRunningBalances(transactions, currentBalances);
  const isAccountFilter = LEDGER_ACCOUNTS.includes(filter);
  const needle = String(search ?? "").trim().toLocaleLowerCase();

  const all = transactions.map((transaction, index) => {
    const effects = getTransactionEffects(transaction);
    const isTransfer = Boolean(transaction.toAccount) && transaction.toAccount !== transaction.account;
    const effectInView = isAccountFilter ? effects[filter] : (isTransfer ? 0 : Number(transaction.amount) || 0);
    return {
      id: transaction.id,
      transaction,
      effects,
      isTransfer,
      /** Signed amount in the current view. For a transfer in the "all" view this is 0 (nothing left or entered). */
      viewAmount: effectInView,
      /** Unsigned size of a transfer, for display. */
      transferAmount: isTransfer ? Math.abs(Number(transaction.amount) || 0) : 0,
      viewBalance: isAccountFilter ? after[index].balances[filter] : after[index].total,
      index
    };
  });

  const matching = all.filter(row => {
    if (isAccountFilter && !touchesAccount(row.transaction, filter)) {
      return false;
    }
    if (needle) {
      const haystack = [row.transaction.description, categoryLabels[row.transaction.category], row.transaction.category]
        .filter(Boolean).join(" ").toLocaleLowerCase();
      return haystack.includes(needle);
    }
    return true;
  });

  const rows = matching.slice().reverse().slice(0, limit);
  const openingValue = isAccountFilter ? opening[filter] : getTotalFunds(opening);
  const showsOldest = !needle && transactions.length > 0 && rows.length === matching.length;
  return {
    rows,
    totalMatching: matching.length,
    opening: showsOldest && openingValue !== 0 ? openingValue : null
  };
}

/**
 * The ways numbers can be written, chosen by each player in the module settings. Each one stands for a locale that
 * writes numbers that way ("auto" follows the language of the interface).
 */
export const NUMBER_FORMATS = {
  auto: null,
  space: "sv-SE",
  comma: "en-US",
  dot: "de-DE",
  apostrophe: "de-CH"
};

/**
 * @param {string} [choice] - a key of NUMBER_FORMATS
 * @param {string} [interfaceLang] - the language of the interface, used for "auto" and for an unknown choice
 * @returns {string} the locale numbers are written and read in
 */
export function numberLocale(choice, interfaceLang = "en") {
  return NUMBER_FORMATS[choice] ?? interfaceLang;
}

/**
 * Parse an amount typed by a player.
 * Accepts a leading + or - (also the typographic minus), spaces and non-breaking spaces as thousand separators,
 * the locale's decimal separator (a dot is accepted as well), and an optional k/M/G suffix, optionally followed by "Cr".
 * The result is rounded up to whole Cr (see roundUpCr).
 * @param {string} text
 * @param {string} [locale] - BCP 47 tag used to decide which of "." and "," is the decimal separator
 * @returns {number} the signed whole amount, or NaN if the text is not a valid amount
 */
export function parseLedgerAmount(text, locale = "en") {
  if (typeof text !== "string") {
    return NaN;
  }
  const cleaned = text
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\u2019/g, "'")
    .replace(/[\s\u00a0\u202f]/g, "");
  const match = /^(?<sign>[+-]?)(?<num>[0-9.,']+)(?<units>[kKMG]?)(?:Cr|cr)?$/.exec(cleaned);
  if (!match) {
    return NaN;
  }

  const parts = new Intl.NumberFormat(locale).formatToParts(11111.1);
  const localeThousand = parts.find(part => part.type === "group")?.value ?? ",";
  const localeDecimal = parts.find(part => part.type === "decimal")?.value ?? ".";
  const digits = match.groups.num.replace(/'/g, "");
  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  let normalized;

  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal separator.
    const decimalChar = lastDot > lastComma ? "." : ",";
    const groupChar = decimalChar === "." ? "," : ".";
    normalized = digits.split(groupChar).join("").replace(decimalChar, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const occurrences = digits.split(sep).length - 1;
    const afterLast = digits.length - digits.lastIndexOf(sep) - 1;
    if (occurrences > 1) {
      normalized = digits.split(sep).join("");
    } else if (afterLast === 3 && sep === localeThousand && sep !== localeDecimal) {
      normalized = digits.replace(sep, "");
    } else {
      normalized = digits.replace(sep, ".");
    }
  } else {
    normalized = digits;
  }

  const base = Number(normalized);
  if (!Number.isFinite(base)) {
    return NaN;
  }
  const multiplier = {k: 1e3, K: 1e3, M: 1e6, G: 1e9}[match.groups.units] ?? 1;
  const value = roundUpCr(base * multiplier);
  return match.groups.sign === "-" ? 0 - value : value;
}

/**
 * Format a number for display in the player's locale.
 * @param {number} value
 * @param {string} [locale]
 * @param {boolean} [showSign] - prefix + for positive values (negative values always get a minus)
 * @returns {string}
 */
export function formatLedgerNumber(value, locale = "en", showSign = false) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    signDisplay: showSign ? "exceptZero" : "auto"
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Create a normalized transaction object.
 * @param {object} data
 * @param {number} data.amount - signed for normal entries, positive for transfers
 * @param {string} [data.account]
 * @param {string|null} [data.toAccount]
 * @param {string} [data.category]
 * @param {string} [data.description]
 * @param {string} [data.gameDate]
 * @param {string} [data.userId]
 * @param {string} id - unique id for the entry
 * @param {number} [timestamp] - real-world time in ms
 * @returns {object}
 */
export function createTransaction(data, id, timestamp = Date.now()) {
  const account = LEDGER_ACCOUNTS.includes(data.account) ? data.account : DEFAULT_LEDGER_ACCOUNT;
  const isTransfer = LEDGER_ACCOUNTS.includes(data.toAccount) && data.toAccount !== account;
  return {
    id,
    amount: roundMoney(isTransfer ? Math.abs(Number(data.amount)) : Number(data.amount)),
    account,
    toAccount: isTransfer ? data.toAccount : null,
    category: isTransfer ? "transfer" : (data.category || DEFAULT_LEDGER_CATEGORY),
    description: String(data.description ?? "").trim(),
    gameDate: String(data.gameDate ?? "").trim(),
    timestamp,
    userId: data.userId ?? ""
  };
}

/**
 * Build "adjustment" entries for balances that changed outside the ledger (a direct edit of the cash field,
 * a macro or another module).
 * @param {Record<string, number>} oldBalances
 * @param {Record<string, number>} newBalances - accounts missing here are treated as unchanged
 * @param {Function} makeId - returns a fresh unique id
 * @param {object} [extra] - description, gameDate, userId
 * @returns {Array<object>}
 */
export function buildAdjustmentEntries(oldBalances, newBalances, makeId, extra = {}) {
  const entries = [];
  for (const account of LEDGER_ACCOUNTS) {
    const newValue = newBalances?.[account];
    const oldValue = oldBalances?.[account];
    if (!Number.isFinite(newValue) || !Number.isFinite(oldValue)) {
      continue;
    }
    const difference = roundMoney(newValue - oldValue);
    if (difference !== 0) {
      entries.push(createTransaction({...extra, amount: difference, account, category: "adjustment"}, makeId()));
    }
  }
  return entries;
}

/**
 * @param {number} balance - what is on the account
 * @param {number} amount - the signed change (negative is a payment)
 * @returns {boolean} false if the change would take more than the account holds
 */
export function hasFunds(balance, amount) {
  return !(amount < 0) || balance + amount >= 0;
}
