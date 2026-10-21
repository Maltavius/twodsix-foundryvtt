import { describe, expect, test } from 'vitest';
import {
  applyTransaction,
  buildAdjustmentEntries,
  buildLedgerRows,
  computeRunningBalances,
  createTransaction,
  formatLedgerNumber,
  getTotalFunds,
  getTransactionEffects,
  parseLedgerAmount,
  revertTransaction,
  roundMoney,
  roundUpCr
} from '../../src/module/features/finances/ledger.js';

const tx = (id, amount, account = 'cash', extra = {}) => ({id, amount, account, toAccount: null, category: 'other', description: id, ...extra});

describe('ledger effects and balances', () => {
  test('income and expense affect only their own account', () => {
    expect(getTransactionEffects(tx('a', -200, 'digital'))).toEqual({cash: 0, digital: -200});
    expect(getTransactionEffects(tx('b', 500, 'cash'))).toEqual({cash: 500, digital: 0});
  });

  test('a transfer moves money between accounts and leaves the total unchanged', () => {
    const transfer = tx('t', 500, 'digital', {toAccount: 'cash', category: 'transfer'});
    const effects = getTransactionEffects(transfer);
    expect(effects).toEqual({cash: 500, digital: -500});
    expect(getTotalFunds(applyTransaction({cash: 100, digital: 900}, transfer))).toBe(1000);
  });

  test('apply and revert are inverses', () => {
    const start = {cash: 100.1, digital: 200.2};
    const entry = tx('x', -0.3, 'cash');
    expect(revertTransaction(applyTransaction(start, entry), entry)).toEqual(start);
  });

  test('roundMoney removes floating point noise', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  test('roundUpCr rounds away from zero to whole Cr and ignores floating point noise', () => {
    expect(roundUpCr(200)).toBe(200);
    expect(roundUpCr(200.01)).toBe(201);
    expect(roundUpCr(200.0000001)).toBe(200);
    expect(roundUpCr(-200.01)).toBe(-201);
    expect(roundUpCr(0.5)).toBe(1);
    expect(roundUpCr(-0.5)).toBe(-1);
    expect(roundUpCr(0.1 + 0.2)).toBe(1);
    expect(Object.is(roundUpCr(-0.001), 0)).toBe(true);
    expect(roundUpCr(NaN)).toBeNaN();
  });

  test('running balances are derived backwards from the current balances', () => {
    const ledger = [tx('a', 1000, 'digital'), tx('b', -200, 'cash'), tx('c', 500, 'digital', {toAccount: 'cash'}), tx('d', -50, 'cash')];
    // current: cash 250, digital 500  (before 'a' they were cash 0 + 200 = ... derived below)
    const {after, opening} = computeRunningBalances(ledger, {cash: 250, digital: 500});
    expect(after[3].balances).toEqual({cash: 250, digital: 500});
    expect(after[2].balances).toEqual({cash: 300, digital: 500});
    expect(after[1].balances).toEqual({cash: -200, digital: 1000});
    expect(after[0].balances).toEqual({cash: 0, digital: 1000});
    expect(opening).toEqual({cash: 0, digital: 0});
    expect(after.map(entry => entry.total)).toEqual([1000, 800, 800, 750]);
  });

  test('an empty ledger yields the current balances as opening', () => {
    const {after, opening} = computeRunningBalances([], {cash: 30485, digital: 0});
    expect(after).toEqual([]);
    expect(opening).toEqual({cash: 30485, digital: 0});
  });

  test('the last row always equals the current balance, even when the ledger starts part-way', () => {
    const ledger = [tx('a', -15), tx('b', -5)];
    const {after, opening} = computeRunningBalances(ledger, {cash: 30485, digital: 0});
    expect(after[1].balances.cash).toBe(30485);
    expect(opening.cash).toBe(30505);
  });
});

describe('buildLedgerRows', () => {
  const ledger = [
    tx('Opening', 1000, 'digital'),
    tx('Pod hotel', -200, 'digital', {category: 'living'}),
    tx('Withdraw', 500, 'digital', {toAccount: 'cash', category: 'transfer'}),
    tx('Auto pistol', -200, 'cash', {category: 'equipment'})
  ];
  const balances = {cash: 300, digital: 300};

  test('rows are newest first and the first row balance equals total funds', () => {
    const {rows} = buildLedgerRows(ledger, balances);
    expect(rows.map(row => row.id)).toEqual(['Auto pistol', 'Withdraw', 'Pod hotel', 'Opening']);
    expect(rows[0].viewBalance).toBe(600);
  });

  test('a transfer shows no amount in the all view but a signed one per account', () => {
    const all = buildLedgerRows(ledger, balances).rows.find(row => row.id === 'Withdraw');
    expect(all.viewAmount).toBe(0);
    expect(all.transferAmount).toBe(500);
    const cash = buildLedgerRows(ledger, balances, {filter: 'cash'}).rows.find(row => row.id === 'Withdraw');
    const digital = buildLedgerRows(ledger, balances, {filter: 'digital'}).rows.find(row => row.id === 'Withdraw');
    expect(cash.viewAmount).toBe(500);
    expect(digital.viewAmount).toBe(-500);
  });

  test('account filter keeps only entries touching the account and uses that account balance', () => {
    const {rows} = buildLedgerRows(ledger, balances, {filter: 'cash'});
    expect(rows.map(row => row.id)).toEqual(['Auto pistol', 'Withdraw']);
    expect(rows.map(row => row.viewBalance)).toEqual([300, 500]);
  });

  test('search matches description and category label', () => {
    expect(buildLedgerRows(ledger, balances, {search: 'pod'}).rows.map(row => row.id)).toEqual(['Pod hotel']);
    const byLabel = buildLedgerRows(ledger, balances, {search: 'Utrustning', categoryLabels: {equipment: 'Utrustning'}});
    expect(byLabel.rows.map(row => row.id)).toEqual(['Auto pistol']);
  });

  test('limit truncates but reports how many matched', () => {
    const result = buildLedgerRows(ledger, balances, {limit: 2});
    expect(result.rows).toHaveLength(2);
    expect(result.totalMatching).toBe(4);
    expect(result.opening).toBeNull();
  });

  test('opening balance is reported only when the oldest entry is shown and it is not zero', () => {
    expect(buildLedgerRows(ledger, balances).opening).toBeNull();
    const partial = buildLedgerRows([tx('a', -5)], {cash: 100, digital: 0});
    expect(partial.opening).toBe(105);
  });
});

describe('parseLedgerAmount', () => {
  test('plain, signed and typographic minus', () => {
    expect(parseLedgerAmount('200')).toBe(200);
    expect(parseLedgerAmount('+200')).toBe(200);
    expect(parseLedgerAmount('-200')).toBe(-200);
    expect(parseLedgerAmount('−200')).toBe(-200);
  });

  test('thousand separators: spaces, nbsp, narrow nbsp, commas', () => {
    expect(parseLedgerAmount('1 500')).toBe(1500);
    expect(parseLedgerAmount('1 500')).toBe(1500);
    expect(parseLedgerAmount('+5 000', 'sv')).toBe(5000);
    expect(parseLedgerAmount('1,500', 'en')).toBe(1500);
    expect(parseLedgerAmount('1,234,567')).toBe(1234567);
  });

  test('decimal separators follow the locale (both tolerated) and the result is rounded up to whole Cr', () => {
    expect(parseLedgerAmount('1,5', 'sv')).toBe(2);
    expect(parseLedgerAmount('1.5', 'sv')).toBe(2);
    expect(parseLedgerAmount('1,5', 'en')).toBe(2);
    expect(parseLedgerAmount('1.234,56')).toBe(1235);
    expect(parseLedgerAmount('1,234.56')).toBe(1235);
  });

  test('decimals round up away from zero, so costs are never rounded down', () => {
    expect(parseLedgerAmount('199.2')).toBe(200);
    expect(parseLedgerAmount('-199.2')).toBe(-200);
    expect(parseLedgerAmount('0.3')).toBe(1);
    expect(parseLedgerAmount('-0.3')).toBe(-1);
    expect(parseLedgerAmount('200.004')).toBe(200);
    expect(parseLedgerAmount('1.5k')).toBe(1500);
  });

  test('zero stays a plain zero, never negative zero', () => {
    expect(Object.is(parseLedgerAmount('0'), 0)).toBe(true);
    expect(Object.is(parseLedgerAmount('-0'), 0)).toBe(true);
    expect(Object.is(parseLedgerAmount('-0.001'), 0)).toBe(true);
  });

  test('k, M and G suffixes with optional Cr', () => {
    expect(parseLedgerAmount('1.5k')).toBe(1500);
    expect(parseLedgerAmount('-2M')).toBe(-2000000);
    expect(parseLedgerAmount('3MCr')).toBe(3000000);
    expect(parseLedgerAmount('250 Cr')).toBe(250);
  });

  test('invalid input is NaN', () => {
    for (const bad of ['', '  ', 'abc', '--5', '5-', '1.2.3k5', '12x', null, undefined, 42]) {
      expect(parseLedgerAmount(bad)).toBeNaN();
    }
  });
});

describe('formatting and creation', () => {
  test('formatLedgerNumber uses locale and optional sign', () => {
    expect(formatLedgerNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatLedgerNumber(5000, 'en', true)).toBe('+5,000');
    expect(formatLedgerNumber(0, 'en', true)).toBe('0');
    expect(formatLedgerNumber(NaN, 'en')).toBe('0');
  });

  test('createTransaction normalizes transfers and unknown values', () => {
    const transfer = createTransaction({amount: -300, account: 'digital', toAccount: 'cash', category: 'living', description: ' Withdraw '}, 'id1', 123);
    expect(transfer).toMatchObject({id: 'id1', amount: 300, account: 'digital', toAccount: 'cash', category: 'transfer', description: 'Withdraw', timestamp: 123});
    const plain = createTransaction({amount: -10, account: 'bogus', toAccount: 'cash'}, 'id2');
    expect(plain.account).toBe('cash');
    expect(plain.toAccount).toBeNull();
    expect(plain.category).toBe('other');
  });

  test('buildAdjustmentEntries creates one entry per changed account', () => {
    let counter = 0;
    const entries = buildAdjustmentEntries({cash: 100, digital: 50}, {cash: 100.1 + 0.2 + 99.7, digital: 50}, () => `adj${++counter}`, {description: 'Manual'});
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({id: 'adj1', amount: 100, account: 'cash', category: 'adjustment', description: 'Manual'});
  });

  test('buildAdjustmentEntries ignores missing or non-numeric values', () => {
    expect(buildAdjustmentEntries({cash: 1, digital: 2}, {cash: NaN}, () => 'x')).toEqual([]);
    expect(buildAdjustmentEntries({cash: 1, digital: 2}, {}, () => 'x')).toEqual([]);
  });
});
