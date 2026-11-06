/**
 * Pure helpers for the finance text fields on a traveller sheet, for example "30485", "30 485", "1 500 000",
 * "1,5 MCr", "+500" or "−1 500".
 *
 * The sheet keeps each amount twice: as the text the player sees and types (`system.finances.<field>`) and as a number
 * (`system.financeValues.<field>`). These helpers turn the text into the number. Nothing here touches Foundry globals,
 * so it can be unit tested in plain Node; the locale specific number parser is passed in by the caller.
 */

/**
 * Fields that exist both as text and as a number under the same name.
 * Ship payments is added by syncedFields when the sheet has the number under that name: twodsix 7.7.0 called the number
 * `payment` (text `payments`), 7.7.1 renamed it to `payments`.
 */
const SYNCED_FINANCE_FIELDS = ["cash", "digital", "pension", "debt", "livingCosts"];

/**
 * @param {object} [financeValues] - the numbers of the sheet
 * @returns {string[]} the fields whose text and number belong together on this version of the system
 */
function syncedFields(financeValues) {
  return financeValues && "payments" in financeValues ? [...SYNCED_FINANCE_FIELDS, "payments"] : SYNCED_FINANCE_FIELDS;
}

/**
 * Splits a finance text into a number part and a units part.
 * The number part may use a space as thousands separator (regular, non-breaking or narrow non-breaking, as used by
 * for example Swedish, French and Russian), written as groups of exactly three digits: "30 485", "1 500 000", "1 500,5".
 * Anything after the number, such as "MCr", is the units.
 */
const FINANCE_TEXT_PATTERN = /^(?<pre>\D*?)(?<num>[0-9,.\-+]*(?:[ \u00a0\u202f][0-9]{3}(?![0-9])[0-9,.]*)*)(?<sp>\s*)(?<units>.*?)$/;

/**
 * Parse a finance text into separate number and units.
 * The typographic minus used by some locales (U+2212, e.g. Swedish) is read as a normal minus.
 * @param {string} financeString
 * @returns {{pre: string, num: string, sp: string, units: string}|undefined}
 */
export function parseFinanceText(financeString) {
  const normalized = String(financeString ?? "").replaceAll("\u2212", "-");
  return FINANCE_TEXT_PATTERN.exec(normalized)?.groups;
}

/**
 * Is the text a change to the current value ("+200", "-50", or with the typographic minus "\u2212200") rather than a
 * new value ("200")? Only a leading sign counts, so "100 + 200" is not a calculation: it is read as 100.
 * @param {string} text
 * @returns {boolean}
 */
export function isDeltaFinanceText(text) {
  return /^[+\-\u2212]/.test(String(text ?? ""));
}

/**
 * Remove spaces used as thousands separators (regular, non-breaking, narrow non-breaking).
 * @param {string} text
 * @returns {string}
 */
export function stripNumberSpaces(text) {
  return String(text ?? "").replace(/[\s\u00a0\u202f]/g, "");
}

/**
 * Magnitude for a units text: "k"/"K" = 1e3, "M" = 1e6, "G" = 1e9, anything else = 1.
 * @param {string} units
 * @returns {number}
 */
export function getUnitMultiplier(units) {
  switch (units?.[0]) {
    case 'G':
      return 1e+9;
    case 'M':
      return 1e+6;
    case 'k':
    case 'K':
      return 1e+3;
    default:
      return 1;
  }
}

/**
 * Convert a finance text to its number, e.g. "1 500 MCr" in a Swedish world to 1500000000.
 * @param {string} text
 * @param {(numberText: string) => number} parseNumber - locale aware parser for the number part, e.g. parseLocaleNumber
 * @returns {number} NaN if the text has no number
 */
export function financeTextToNumber(text, parseNumber) {
  const parsed = parseFinanceText(text);
  if (!parsed?.num || stripNumberSpaces(parsed.num) === "") {
    return NaN;
  }
  return parseNumber(stripNumberSpaces(parsed.num)) * getUnitMultiplier(parsed.units);
}

/**
 * Find numbers that are missing although their text is filled in, for example characters created by chargen, which
 * writes only the text. A number that is already non-zero is never replaced.
 * @param {Record<string, string>} finances - the text fields
 * @param {Record<string, number>} financeValues - the number fields
 * @param {(numberText: string) => number} parseNumber - locale aware parser for the number part
 * @returns {Record<string, number>} numbers to set, by field name; empty if nothing needs fixing
 */
export function getFinanceValueFixes(finances, financeValues, parseNumber) {
  const fixes = {};
  for (const field of syncedFields(financeValues)) {
    const current = financeValues?.[field];
    if (Number.isFinite(current) && current !== 0) {
      continue;
    }
    const parsed = financeTextToNumber(finances?.[field], parseNumber);
    if (Number.isFinite(parsed) && parsed !== 0) {
      fixes[field] = parsed;
    }
  }
  return fixes;
}

/**
 * Parse a number written in the user's language: the language's thousands separator is removed and its decimal
 * separator becomes a dot. (The same rules as the system's own parseLocaleNumber.)
 * @param {string} stringNumber
 * @returns {number} NaN if there is nothing to parse
 */
export function parseLocaleNumber(stringNumber) {
  if (!stringNumber) {
    return NaN;
  }
  const lang = globalThis.game?.i18n?.lang ?? "en";
  const thousandSeparator = Intl.NumberFormat(lang).formatToParts(11111)[1].value;
  const decimalSeparator = Intl.NumberFormat(lang).formatToParts(1.1)[1].value;
  return parseFloat(
    stringNumber
      .replace(new RegExp("\\" + thousandSeparator, "g"), "")
      .replace(new RegExp("\\" + decimalSeparator), ".")
  );
}

/**
 * The units of a finance text ("M" in "1,5 M"), or "" when there are none. Anything after the number that does not start
 * with a letter is not a unit: it is what is left over when the system has misread a number written with spaces
 * ("27 150" read as 27 with the units "150") and is dropped.
 * @param {string} text
 * @returns {string}
 */
export function financeUnits(text) {
  const units = parseFinanceText(text)?.units?.trim() ?? "";
  return /^[A-Za-z]/.test(units) ? units : "";
}

/**
 * Write a number as finance text in a form that the system reads back correctly in every language.
 * The system finds the number in a text with the pattern `[0-9,.]+` and takes everything after it as units, so a text
 * with a space as thousands separator ("27 150", Swedish, French, Russian) is read as "27" followed by the units "150",
 * and every later change adds one more group to the end. A language whose separator is a comma or a dot keeps its
 * grouping; for any other language the number is written without one ("27150").
 * @param {number} value
 * @param {string} [units] - for example "M"; the number is shown in those units
 * @param {string} [lang] - the Foundry language
 * @returns {string}
 */
export function formatFinanceText(value, units = "", lang = "en") {
  const shown = units ? value / getUnitMultiplier(units) : value;
  const options = {minimumFractionDigits: 0, maximumFractionDigits: 6};
  let text = shown.toLocaleString(lang, options).replaceAll("−", "-");
  if (/[^0-9,.-]/.test(text)) {
    text = shown.toLocaleString(lang, {...options, useGrouping: false}).replaceAll("−", "-");
  }
  return units ? `${text} ${units}` : text;
}

/**
 * For a character update that changes finance numbers or finance text: the clean text of each of them. The system has by
 * then rewritten the text itself (and may have got it wrong, see formatFinanceText), so the caller replaces it with this.
 * @param {object} update - the expanded update data
 * @param {Record<string, string>} sourceFinances - the text fields as saved
 * @param {Record<string, number>} sourceValues - the number fields as saved
 * @param {string} [lang]
 * @returns {Record<string, string>} new text by field name
 */
export function getCleanFinanceTexts(update, sourceFinances, sourceValues, lang = "en") {
  const values = update?.system?.financeValues ?? {};
  const written = update?.system?.finances ?? {};
  const texts = {};
  for (const field of syncedFields({...sourceValues, ...values})) {
    const value = Number.isFinite(values[field]) ? values[field] : sourceValues?.[field];
    const touched = (Number.isFinite(values[field]) && values[field] !== sourceValues?.[field]) || typeof written[field] === "string";
    const text = written[field] ?? sourceFinances?.[field];
    const num = parseFinanceText(text)?.num;
    if (!touched || !Number.isFinite(value) || num === undefined || stripNumberSpaces(num) === "") {
      continue;
    }
    texts[field] = formatFinanceText(value, financeUnits(text), lang);
  }
  return texts;
}

/**
 * Find finance texts that do not look like their number: the long tails left by the misreading described at
 * formatFinanceText. Only the text is ever changed, never the number.
 * @param {Record<string, string>} finances - the text fields
 * @param {Record<string, number>} financeValues - the number fields
 * @param {string} lang
 * @param {(numberText: string) => number} parseNumber - locale aware parser for the number part
 * @returns {Record<string, {from: string, to: string}>} by field name; empty if all texts are fine
 */
export function getFinanceTextTidyUps(finances, financeValues, lang, parseNumber) {
  const changes = {};
  for (const field of syncedFields(financeValues)) {
    const value = financeValues?.[field];
    const old = finances?.[field];
    if (!Number.isFinite(value) || typeof old !== "string" || old.trim() === "") {
      continue;
    }
    const same = number => Math.abs(number - value) <= 1e-6 * Math.max(1, Math.abs(value));
    if (same(financeTextToNumber(old, parseNumber))) {
      continue; // the text says the same as the number, however it is written
    }
    const to = formatFinanceText(value, financeUnits(old), lang);
    if (same(financeTextToNumber(to, parseNumber))) {
      changes[field] = {from: old, to};
    }
  }
  return changes;
}
