import { describe, expect, test } from 'vitest';
import { buildFinanceView, getAddButtonState } from '../../src/module/features/finances/financeView.js';

const localize = key => key.split('.').pop();

const tx = (id, amount, extra = {}) => ({
  id, amount, account: 'cash', toAccount: null, category: 'other', description: '', gameDate: '', timestamp: 0, userId: 'u', ...extra
});

const build = (overrides = {}) => buildFinanceView({
  transactions: [], balances: {cash: 0, digital: 0}, locale: 'en', localize, ...overrides
});

describe('getAddButtonState', () => {
  test.each([
    ['', 'neutral', 'ADD'],
    ['   ', 'neutral', 'ADD'],
    ['abc', 'neutral', 'ADD'],
    ['0', 'neutral', 'ADD'],
    ['200', 'income', 'ADD_INCOME'],
    ['+200', 'income', 'ADD_INCOME'],
    ['-200', 'expense', 'ADD_EXPENSE'],
    ['−200', 'expense', 'ADD_EXPENSE'],
    ['-1 500', 'expense', 'ADD_EXPENSE'],
    ['-0,4', 'expense', 'ADD_EXPENSE'],
    ['1,5k', 'income', 'ADD_INCOME']
  ])('%j gives a %s button', (text, kind, key) => {
    const state = getAddButtonState(text, 'sv');
    expect(state.kind).toBe(kind);
    expect(state.labelKey.endsWith(key)).toBe(true);
  });

  test('a lone minus sign has no amount yet', () => {
    expect(getAddButtonState('-', 'en').kind).toBe('neutral');
  });
});

describe('buildFinanceView', () => {
  test('totals, net of debt and sign classes', () => {
    const view = build({balances: {cash: 1000, digital: -250}, debt: 300});
    expect(view.totals).toMatchObject({total: '750', cash: '1,000', digital: '-250', netOfDebt: '450', showNetOfDebt: true});
    expect(view.totals).toMatchObject({totalClass: 'positive', cashClass: 'positive', digitalClass: 'negative'});
    expect(build({balances: {cash: 5, digital: 0}}).totals.showNetOfDebt).toBe(false);
  });

  test('uses the locale for numbers', () => {
    const view = build({balances: {cash: 30485, digital: 0}, locale: 'sv'});
    expect(view.totals.cash).toBe('30 485');
  });

  test('rows are newest first with running balance and signed amount', () => {
    const view = build({
      transactions: [tx('a', 100, {gameDate: '1105-001'}), tx('b', -30, {description: 'Lunch', category: 'living'})],
      balances: {cash: 170, digital: 0}
    });
    expect(view.rows.map(r => r.id)).toEqual(['b', 'a']);
    expect(view.rows[0]).toMatchObject({description: 'Lunch', categoryLabel: 'living', showCategory: true, amountText: '-30', amountClass: 'negative', balanceText: '170'});
    expect(view.rows[1]).toMatchObject({dateText: '1105-001', isRealDate: false, amountText: '+100', amountClass: 'positive', balanceText: '200', description: 'other', showCategory: false});
    expect(view.opening).toEqual({text: '100'});
  });

  test('falls back to the real date when no in-game date was recorded', () => {
    const view = build({transactions: [tx('a', 5, {timestamp: Date.UTC(2026, 9, 21, 12)})], balances: {cash: 5}});
    expect(view.rows[0].isRealDate).toBe(true);
    expect(view.rows[0].dateText).toMatch(/2026/);
  });

  test('a transfer is one row, shown as neutral in "all" and as in/out per account', () => {
    const transactions = [tx('t', 200, {account: 'cash', toAccount: 'digital', category: 'transfer'})];
    const balances = {cash: 800, digital: 200};
    const all = build({transactions, balances});
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]).toMatchObject({isTransfer: true, amountText: '200', amountClass: 'transfer', accountText: 'CASH → DIGITAL'.replace('CASH', 'CASH')});
    const cash = build({transactions, balances, ui: {filter: 'cash'}});
    expect(cash.rows[0]).toMatchObject({amountText: '-200', amountClass: 'negative', balanceText: '800'});
    const digital = build({transactions, balances, ui: {filter: 'digital'}});
    expect(digital.rows[0]).toMatchObject({amountText: '+200', amountClass: 'positive', balanceText: '200'});
  });

  test('filters, search and bad filter values', () => {
    const transactions = [tx('a', 10, {description: 'Rations'}), tx('b', 20, {account: 'digital', description: 'Salary'})];
    const balances = {cash: 10, digital: 20};
    expect(build({transactions, balances, ui: {filter: 'digital'}}).rows.map(r => r.id)).toEqual(['b']);
    expect(build({transactions, balances, ui: {search: 'ratio'}}).rows.map(r => r.id)).toEqual(['a']);
    expect(build({transactions, balances, ui: {filter: 'bogus'}}).filter).toBe('all');
    const none = build({transactions, balances, ui: {search: 'zzz'}});
    expect(none).toMatchObject({noMatches: true, hasTransactions: true});
  });

  test('limits rows and reports how many are hidden', () => {
    const transactions = Array.from({length: 7}, (_, i) => tx(`t${i}`, 1));
    const view = build({transactions, balances: {cash: 7}, ui: {limit: 3}});
    expect(view).toMatchObject({hasMore: true, hiddenCount: 4, nextLimit: 53});
    expect(view.rows).toHaveLength(3);
    expect(view.opening).toBeNull();
    expect(build({transactions, balances: {cash: 7}}).hasMore).toBe(false);
  });

  test('an empty ledger', () => {
    const view = build();
    expect(view).toMatchObject({hasTransactions: false, noMatches: false, canUndo: false, rows: [], opening: null});
  });

  test('mode defaults to add', () => {
    expect(build().isMoveMode).toBe(false);
    expect(build({ui: {mode: 'move'}}).isMoveMode).toBe(true);
    expect(build({ui: {mode: 'x'}}).mode).toBe('add');
  });

  test('a ledger that does not reach back to zero shows an opening row', () => {
    const view = build({transactions: [tx('a', 50)], balances: {cash: 1050}});
    expect(view.opening).toEqual({text: '1,000'});
  });
});
