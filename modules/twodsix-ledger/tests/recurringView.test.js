import { describe, expect, test } from 'vitest';
import { buildGroupsView } from '../scripts/recurringView.js';
import { createRecurringItem } from '../scripts/recurring.js';
import { createLoan } from '../scripts/loans.js';

const localize = key => key;
const item = (over, id) => createRecurringItem({name: id, amount: -100, account: 'digital', group: 'living', ...over}, id);
const loan = (over, id) => createLoan({name: id, remaining: 1000, monthly: 0, account: 'cash', ...over}, id);
const view = (items = [], loans = [], extra = {}) => buildGroupsView({items, loans, localize, ...extra});
const card = (result, key) => result.cards.find(entry => entry.key === key);

describe('the cards', () => {
  test('are the four groups in the order of the old fields', () => {
    expect(view().cards.map(entry => entry.key)).toEqual(['pension', 'living', 'ship', 'debt']);
    expect(view().cards.map(entry => entry.label)).toEqual([
      'TWODSIX_LEDGER.GROUP_PENSION', 'TWODSIX_LEDGER.GROUP_LIVING', 'TWODSIX_LEDGER.GROUP_SHIP', 'TWODSIX_LEDGER.GROUP_DEBT'
    ]);
  });

  test('show the active total with how often it is paid, and how many items', () => {
    const result = view([
      item({amount: -600}, 'a'),
      item({amount: -200}, 'b'),
      item({amount: -50, active: false}, 'off'),
      item({amount: 500, group: 'pension', frequency: 'year'}, 'p'),
      item({amount: 300, group: 'pension'}, 'q')
    ]);
    expect(card(result, 'living')).toMatchObject({amounts: [{value: '-800', unit: 'TWODSIX_LEDGER.PER_MONTH', className: 'negative'}], subText: '2 TWODSIX_LEDGER.ITEM_MANY'});
    expect(card(result, 'pension').amounts).toEqual([
      {value: '+300', unit: 'TWODSIX_LEDGER.PER_MONTH', className: 'positive'},
      {value: '+500', unit: 'TWODSIX_LEDGER.PER_YEAR', className: 'positive'}
    ]);
  });

  test('an empty group shows 0 and no items', () => {
    expect(card(view(), 'ship')).toMatchObject({amounts: [{value: '0', unit: '', className: ''}], subText: '0 TWODSIX_LEDGER.ITEM_MANY'});
    expect(card(view([item({}, 'a')]), 'living').subText).toBe('1 TWODSIX_LEDGER.ITEM_ONE');
  });

  test('the debt card shows what is owed and, if there are fixed payments, what is paid each month', () => {
    const none = view([], [loan({remaining: 12000}, 'a'), loan({remaining: 13000}, 'b')]);
    expect(card(none, 'debt')).toMatchObject({amounts: [{value: '25,000', unit: 'Cr', className: 'negative'}], isDebt: true, subText: '2 TWODSIX_LEDGER.LOAN_MANY'});
    const paying = view([], [loan({remaining: 12000, monthly: 500}, 'a'), loan({remaining: 100, monthly: 500}, 'b')]);
    expect(card(paying, 'debt').subText).toBe('2 TWODSIX_LEDGER.LOAN_MANY · -600TWODSIX_LEDGER.PER_MONTH');
    expect(card(view([], []), 'debt').amounts).toEqual([{value: '0', unit: 'Cr', className: ''}]);
  });

  test('numbers follow the locale', () => {
    expect(card(buildGroupsView({items: [item({amount: -1500}, 'a')], localize, locale: 'sv'}), 'living').amounts[0].value).toBe('\u22121\u00a0500');
  });
});

describe('the panel', () => {
  test('nothing is open by default, or for an unknown group', () => {
    expect(view().panel).toBeNull();
    expect(view([], [], {openGroup: 'nope'}).hasPanel).toBe(false);
    expect(view().cards.some(entry => entry.open)).toBe(false);
  });

  test('the open card is marked and its panel shows that group\'s items only', () => {
    const result = view([item({amount: -600}, 'a'), item({amount: -5680, group: 'ship'}, 'b')], [], {openGroup: 'living'});
    expect(card(result, 'living').open).toBe(true);
    expect(card(result, 'ship').open).toBe(false);
    expect(result.panel.rows.map(row => row.id)).toEqual(['a']);
    expect(result.panel.footerText).toBe('TWODSIX_LEDGER.SUM -600TWODSIX_LEDGER.PER_MONTH');
  });

  test('item rows carry options, a signed amount and the right button', () => {
    const rows = view([
      item({amount: -600, frequency: 'month', account: 'cash'}, 'rent'),
      item({amount: 500, group: 'living', frequency: 'year'}, 'bonus'),
      item({active: false}, 'off'),
      item({amount: 0}, 'none')
    ], [], {openGroup: 'living'}).panel.rows;
    expect(rows[0]).toMatchObject({amountText: '-600', amountClass: 'negative', payLabel: 'TWODSIX_LEDGER.PAY', canPay: true, payHint: ''});
    expect(rows[0].accounts.find(option => option.selected).key).toBe('cash');
    expect(rows[0].frequencies.map(option => option.label)).toEqual(['TWODSIX_LEDGER.MONTH', 'TWODSIX_LEDGER.YEAR']);
    expect(rows[1]).toMatchObject({payLabel: 'TWODSIX_LEDGER.RECEIVE', amountClass: 'positive'});
    expect(rows[1].frequencies.find(option => option.selected).key).toBe('year');
    expect(rows[2]).toMatchObject({canPay: false, payHint: 'TWODSIX_LEDGER.PAY_OFF'});
    expect(rows[3]).toMatchObject({canPay: false, payHint: 'TWODSIX_LEDGER.PAY_NO_AMOUNT'});
  });

  test('an empty group has no rows and no sum line', () => {
    const result = view([], [], {openGroup: 'ship'});
    expect(result.panel).toMatchObject({hasRows: false, footerText: ''});
  });

  test('the debt panel lists the loans with what is owed and what is paid each month', () => {
    const result = view([], [loan({remaining: 12000, monthly: 500, account: 'digital'}, 'a'), loan({remaining: 13000}, 'b'), loan({remaining: 0, monthly: 100}, 'c')], {openGroup: 'debt'});
    expect(result.panel).toMatchObject({isDebt: true, hasRows: true, footerText: 'TWODSIX_LEDGER.TOTAL_OWED 25,000 Cr'});
    const [a, b, c] = result.panel.rows;
    expect(a).toMatchObject({remainingText: '12,000', monthlyText: '500', canPay: true, payLabel: 'TWODSIX_LEDGER.PAY 500', canPayCustom: true});
    expect(a.accounts.find(option => option.selected).key).toBe('digital');
    expect(b).toMatchObject({monthlyText: '', canPay: false, payHint: 'TWODSIX_LEDGER.PAY_NO_AMOUNT', canPayCustom: true});
    expect(c).toMatchObject({canPay: false, payHint: 'TWODSIX_LEDGER.PAY_NO_DEBT', canPayCustom: false});
  });

  test('the Pay button of a loan never offers more than is owed', () => {
    const [row] = view([], [loan({remaining: 120, monthly: 500}, 'a')], {openGroup: 'debt'}).panel.rows;
    expect(row.payLabel).toBe('TWODSIX_LEDGER.PAY 120');
  });

  test('passes the in-game date on', () => {
    expect(view([], [], {gameDate: 'Holiday 01, 1105'}).gameDate).toBe('Holiday 01, 1105');
  });
});

describe('when the account is too poor', () => {
  test('the Pay button is off with a reason, for items and loans', () => {
    const items = [item({amount: -600, account: 'digital'}, 'rent'), item({amount: 500, group: 'living', account: 'digital'}, 'bonus')];
    const rows = view(items, [], {openGroup: 'living', balances: {cash: 0, digital: 100}}).panel.rows;
    expect(rows[0]).toMatchObject({canPay: false, payHint: 'TWODSIX_LEDGER.PAY_NO_FUNDS'});
    expect(rows[1].canPay).toBe(true);
    const loanRows = view([], [loan({remaining: 12000, monthly: 500, account: 'cash'}, 'a')], {openGroup: 'debt', balances: {cash: 499, digital: 0}}).panel.rows;
    expect(loanRows[0]).toMatchObject({canPay: false, payHint: 'TWODSIX_LEDGER.PAY_NO_FUNDS', canPayCustom: true});
  });

  test('enough money, or no balances given, means it can be paid', () => {
    const items = [item({amount: -600, account: 'digital'}, 'rent')];
    expect(view(items, [], {openGroup: 'living', balances: {cash: 0, digital: 600}}).panel.rows[0].canPay).toBe(true);
    expect(view(items, [], {openGroup: 'living'}).panel.rows[0].canPay).toBe(true);
  });
});

