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
 * (The ship payments field is left out: its text field is `payments` but its number is `payment`.)
 */
export const SYNCED_FINANCE_FIELDS = ["cash", "digital", "pension", "debt", "livingCosts"];

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
  for (const field of SYNCED_FINANCE_FIELDS) {
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
