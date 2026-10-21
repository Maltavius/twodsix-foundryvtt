import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  financeTextToNumber,
  getFinanceValueFixes,
  getUnitMultiplier,
  parseFinanceText,
  stripNumberSpaces
} from '../../src/module/features/finances/financeText.js';

const NBSP = '\u00a0';
const NARROW = '\u202f';

/** The project's real locale aware parser, loaded with a stand-in for the Foundry globals it needs. */
let parseLocaleNumber;
beforeAll(async () => {
  globalThis.foundry = {data: {fields: {}}};
  globalThis.game = {i18n: {lang: 'en'}};
  ({parseLocaleNumber} = await import('../../src/module/data/commonSchemaUtils.js'));
});
afterAll(() => {
  delete globalThis.foundry;
  delete globalThis.game;
});

/** A simple parser for the pure tests that do not depend on a locale. */
const simpleParse = text => (text ? parseFloat(text.replace(',', '.')) : NaN);

describe('parseFinanceText', () => {
  test.each([
    ['30485', '30485', ''],
    ['30 485', '30 485', ''],
    [`30${NBSP}485`, `30${NBSP}485`, ''],
    [`30${NARROW}485`, `30${NARROW}485`, ''],
    ['1 500 000', '1 500 000', ''],
    ['1 500,5', '1 500,5', ''],
    ['30 485 Cr', '30 485', 'Cr'],
    ['1,5 MCr', '1,5', 'MCr'],
    ['1 000k', '1 000', 'k'],
    ['+500', '+500', ''],
    ['-15', '-15', ''],
    ['\u22121 500', '-1 500', ''],
    ['30,485', '30,485', ''],
    ['0', '0', '']
  ])('%j splits into number %j and units %j', (text, num, units) => {
    expect(parseFinanceText(text)).toMatchObject({num, units});
  });

  test('a group that is not exactly three digits is not a thousands group', () => {
    expect(parseFinanceText('12 3456')).toMatchObject({num: '12', units: '3456'});
    expect(parseFinanceText('1 5')).toMatchObject({num: '1', units: '5'});
  });

  test('empty, missing and text-only input does not throw', () => {
    expect(parseFinanceText('')).toMatchObject({num: '', units: ''});
    expect(parseFinanceText(undefined)).toMatchObject({num: '', units: ''});
    expect(parseFinanceText('abc')).toMatchObject({num: '', units: 'abc'});
  });
});

describe('stripNumberSpaces and getUnitMultiplier', () => {
  test('removes every kind of space used as thousands separator', () => {
    expect(stripNumberSpaces(`1 5${NBSP}0${NARROW}0`)).toBe('1500');
    expect(stripNumberSpaces(undefined)).toBe('');
  });

  test('units magnitude', () => {
    expect(getUnitMultiplier('k')).toBe(1e3);
    expect(getUnitMultiplier('KCr')).toBe(1e3);
    expect(getUnitMultiplier('MCr')).toBe(1e6);
    expect(getUnitMultiplier('G')).toBe(1e9);
    expect(getUnitMultiplier('Cr')).toBe(1);
    expect(getUnitMultiplier('')).toBe(1);
    expect(getUnitMultiplier(undefined)).toBe(1);
  });
});

describe('financeTextToNumber', () => {
  test('spaces as thousands separator no longer end the number (was: "30 485" -> 30)', () => {
    expect(financeTextToNumber('30 485', simpleParse)).toBe(30485);
    expect(financeTextToNumber(`1${NBSP}500${NBSP}000`, simpleParse)).toBe(1500000);
    expect(financeTextToNumber('1 500 MCr', simpleParse)).toBe(1.5e9);
  });

  test('units, signs and decimals', () => {
    expect(financeTextToNumber('1,5 MCr', simpleParse)).toBe(1.5e6);
    expect(financeTextToNumber('-15', simpleParse)).toBe(-15);
    expect(financeTextToNumber('\u22121 500', simpleParse)).toBe(-1500);
  });

  test('NaN when there is no number', () => {
    expect(financeTextToNumber('', simpleParse)).toBeNaN();
    expect(financeTextToNumber('abc', simpleParse)).toBeNaN();
    expect(financeTextToNumber(undefined, simpleParse)).toBeNaN();
  });
});

describe('round trip with the real locale parser', () => {
  const locales = ['en', 'sv', 'nb', 'fi', 'fr', 'ru', 'de', 'es', 'pl'];
  const values = [0, 5, 999, 1000, 1500, 30485, 1234567, 30485.5, 0.5, -200, -1500, -30485.5];

  /** Same formatting as TravellerData.convertNumberToFormattedText */
  const format = (value, locale, units) => {
    const digits = value === 0 ? 1 : Math.max(1, Math.floor(Math.log10(Math.abs(value))) + 1);
    return value.toLocaleString(locale, {minimumSignificantDigits: digits}) + (units ? ` ${units}` : '');
  };

  for (const locale of locales) {
    test(`${locale}: text written by the system parses back to the same number`, () => {
      globalThis.game.i18n.lang = locale;
      for (const value of values) {
        const text = format(value, locale);
        expect(financeTextToNumber(text, parseLocaleNumber), `${locale} ${JSON.stringify(text)}`).toBe(value);
      }
    });

    test(`${locale}: the same text with units keeps its units`, () => {
      globalThis.game.i18n.lang = locale;
      const text = format(1500, locale, 'MCr');
      expect(parseFinanceText(text).units).toBe('MCr');
      expect(financeTextToNumber(text, parseLocaleNumber)).toBe(1500 * 1e6);
    });
  }

  test('what a Swede types by hand: a plain space, a comma, and a typographic minus', () => {
    globalThis.game.i18n.lang = 'sv';
    expect(financeTextToNumber('30 485', parseLocaleNumber)).toBe(30485);
    expect(financeTextToNumber('30 485,5', parseLocaleNumber)).toBe(30485.5);
    expect(financeTextToNumber('1,5 MCr', parseLocaleNumber)).toBe(1.5e6);
    expect(financeTextToNumber('\u2212200', parseLocaleNumber)).toBe(-200);
  });
});

describe('getFinanceValueFixes', () => {
  test('fills in a number that is missing although the text is filled in (chargen)', () => {
    const fixes = getFinanceValueFixes(
      {cash: '12000', pension: '500', debt: '0', livingCosts: '0', digital: '0'},
      {cash: 0, pension: 0, debt: 0, livingCosts: 0, digital: 0},
      simpleParse
    );
    expect(fixes).toEqual({cash: 12000, pension: 500});
  });

  test('never replaces a number that is already non-zero, even if the text disagrees', () => {
    expect(getFinanceValueFixes({cash: '999'}, {cash: 5000}, simpleParse)).toEqual({});
    expect(getFinanceValueFixes({cash: '999'}, {cash: -5}, simpleParse)).toEqual({});
  });

  test('a missing or invalid number can be fixed', () => {
    expect(getFinanceValueFixes({cash: '40'}, {cash: NaN}, simpleParse)).toEqual({cash: 40});
    expect(getFinanceValueFixes({cash: '40'}, {}, simpleParse)).toEqual({cash: 40});
    expect(getFinanceValueFixes({cash: '40'}, undefined, simpleParse)).toEqual({cash: 40});
  });

  test('empty, zero or unreadable text gives no fix', () => {
    expect(getFinanceValueFixes({cash: '0', digital: '', debt: 'abc'}, {}, simpleParse)).toEqual({});
    expect(getFinanceValueFixes(undefined, {}, simpleParse)).toEqual({});
  });

  test('units and thousands separators are understood', () => {
    expect(getFinanceValueFixes({cash: '1,5 MCr', debt: '2 000'}, {}, simpleParse)).toEqual({cash: 1.5e6, debt: 2000});
  });

  test('the ship payments field is left alone (its text and number names differ)', () => {
    expect(getFinanceValueFixes({payments: '800'}, {payment: 0}, simpleParse)).toEqual({});
  });

  test('digital is included', () => {
    expect(getFinanceValueFixes({digital: '700'}, {digital: 0}, simpleParse)).toEqual({digital: 700});
  });
});
