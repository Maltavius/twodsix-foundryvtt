import { afterEach, describe, expect, test } from 'vitest';
import {
  BUILTIN_CATEGORIES,
  LEDGER_ACCOUNTS,
  LEDGER_CATEGORIES,
  MAX_LEDGER_ACCOUNTS,
  accountLabel,
  accountTone,
  categoryLabel,
  configureLedger,
  createTransaction,
  secondaryAccount
} from '../scripts/ledger.js';
import { buildFinanceView } from '../scripts/financeView.js';
import { buildGroupsView } from '../scripts/recurringView.js';
import { createRecurringItem } from '../scripts/recurring.js';

const localize = key => key;

afterEach(() => configureLedger());

describe('configureLedger', () => {
  test('without a config the ledger has Cash and Digital and the standard categories', () => {
    configureLedger({});
    expect(LEDGER_ACCOUNTS).toEqual(['cash', 'digital']);
    expect(LEDGER_CATEGORIES).toEqual(BUILTIN_CATEGORIES);
  });

  test('accounts follow the list, Cash is always first, and there are never more than four', () => {
    configureLedger({accounts: [{key: 'bank', name: 'Bank'}, {key: 'cash'}, {key: 'a1'}, {key: 'a2'}, {key: 'a3'}, {key: 'a4'}]});
    expect(LEDGER_ACCOUNTS).toEqual(['cash', 'bank', 'a1', 'a2']);
    expect(LEDGER_ACCOUNTS.length).toBeLessThanOrEqual(MAX_LEDGER_ACCOUNTS);
  });

  test('unusable keys and duplicates are ignored', () => {
    configureLedger({accounts: [{key: 'bad key'}, {key: 'x'}, {key: 'x'}, {}, null]});
    expect(LEDGER_ACCOUNTS).toEqual(['cash', 'x']);
  });

  test('categories: the standard ones stay, others are added, the system ones cannot be added', () => {
    configureLedger({categories: [{key: 'c1', name: 'Gifts'}, {key: 'transfer', name: 'Nope'}, {key: 'income', name: 'Pay'}]});
    expect(LEDGER_CATEGORIES).toEqual([...BUILTIN_CATEGORIES, 'c1']);
  });

  test('the arrays are changed in place, so earlier imports follow', () => {
    const reference = LEDGER_ACCOUNTS;
    configureLedger({accounts: [{key: 'bank'}]});
    expect(reference).toEqual(['cash', 'bank']);
  });
});

describe('names and colours', () => {
  test('a name from the settings wins, then the standard name, then the key', () => {
    configureLedger({accounts: [{key: 'cash', name: 'Wallet'}, {key: 'digital'}, {key: 'x'}], categories: [{key: 'c1', name: 'Gifts'}, {key: 'living', name: 'Rent'}]});
    expect(accountLabel('cash', localize)).toBe('Wallet');
    expect(accountLabel('digital', localize)).toBe('TWODSIX_LEDGER.DIGITAL');
    expect(accountLabel('x', localize)).toBe('x');
    expect(categoryLabel('c1', localize)).toBe('Gifts');
    expect(categoryLabel('living', localize)).toBe('Rent');
    expect(categoryLabel('income', localize)).toBe('TWODSIX_LEDGER.CATEGORIES.income');
    expect(categoryLabel('removed', localize)).toBe('');
  });

  test('Cash and Digital keep their colours, other accounts get one by position', () => {
    configureLedger({accounts: [{key: 'digital'}, {key: 'bank'}, {key: 'safe'}]});
    expect([accountTone('cash'), accountTone('digital'), accountTone('bank'), accountTone('safe')]).toEqual(['cash', 'digital', 'tone-2', 'tone-3']);
  });

  test('the second account is Digital if there is one, else Cash', () => {
    expect(secondaryAccount()).toBe('digital');
    configureLedger({accounts: [{key: 'bank'}]});
    expect(secondaryAccount()).toBe('cash');
  });
});

describe('with other accounts', () => {
  test('a transaction can use an account that was added, and falls back to Cash for one that is gone', () => {
    configureLedger({accounts: [{key: 'bank'}]});
    expect(createTransaction({amount: 5, account: 'bank'}, 'a').account).toBe('bank');
    expect(createTransaction({amount: 5, account: 'digital'}, 'b').account).toBe('cash');
    expect(createTransaction({amount: 5, account: 'cash', toAccount: 'bank'}, 'c')).toMatchObject({toAccount: 'bank', category: 'transfer'});
  });

  test('the view has a card, a filter and an option for every account', () => {
    configureLedger({accounts: [{key: 'digital'}, {key: 'bank', name: 'Bank'}]});
    const view = buildFinanceView({transactions: [], balances: {cash: 100, digital: 50, bank: 25}, localize});
    expect(view.accountCards.map(card => [card.key, card.label, card.text])).toEqual([
      ['cash', 'TWODSIX_LEDGER.CASH', '100'], ['digital', 'TWODSIX_LEDGER.DIGITAL', '50'], ['bank', 'Bank', '25']
    ]);
    expect(view.filters.map(filter => filter.key)).toEqual(['all', 'cash', 'digital', 'bank']);
    expect(view.totals.total).toBe('175');
    expect(view.canMove).toBe(true);
    expect(view.hasManyAccounts).toBe(true);
  });

  test('with only Cash there is nothing to move money between', () => {
    configureLedger({accounts: [{key: 'cash'}]});
    const view = buildFinanceView({transactions: [], balances: {cash: 1}, localize});
    expect(view.canMove).toBe(false);
    expect(view.hasManyAccounts).toBe(false);
  });

  test('items can be paid from the new accounts, and the names are the ones from the settings', () => {
    configureLedger({accounts: [{key: 'bank', name: 'Bank'}]});
    const item = createRecurringItem({name: 'Rent', amount: -600, account: 'bank', group: 'living'}, 'r');
    const rows = buildGroupsView({items: [item], loans: [], localize, openGroup: 'living', balances: {cash: 0, bank: 100}}).panel.rows;
    expect(rows[0].accounts.map(option => option.label)).toEqual(['TWODSIX_LEDGER.CASH', 'Bank']);
    expect(rows[0].canPay).toBe(false);
  });
});
