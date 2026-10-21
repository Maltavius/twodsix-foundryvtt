import { describe, expect, test } from 'vitest';
import { buildRecurringView } from '../scripts/recurringView.js';
import { createRecurringItem } from '../scripts/recurring.js';

const localize = key => key;
const item = (over, id) => createRecurringItem({name: id, amount: -100, account: 'digital', category: 'living', ...over}, id);
const view = (items, extra = {}) => buildRecurringView({items, localize, ...extra});

describe('buildRecurringView', () => {
  test('an empty list', () => {
    const empty = view([]);
    expect(empty.hasItems).toBe(false);
    expect(empty.canPayAll).toBe(false);
    expect(empty.showYear).toBe(false);
    expect(empty.monthText).toBe('0');
  });

  test('rows carry the selected options and a signed amount', () => {
    const [row] = view([item({amount: -600, frequency: 'month', account: 'cash', category: 'ship'}, 'rent')]).rows;
    expect(row).toMatchObject({id: 'rent', name: 'rent', amountText: '-600', amountClass: 'negative', isYearly: false});
    expect(row.accounts.find(option => option.selected).key).toBe('cash');
    expect(row.categories.find(option => option.selected).key).toBe('ship');
    expect(row.frequencies.find(option => option.selected).key).toBe('month');
    expect(row.frequencies.map(option => option.label)).toEqual(['TWODSIX_LEDGER.PER_MONTH', 'TWODSIX_LEDGER.PER_YEAR']);
  });

  test('income is positive and says Receive; costs say Pay', () => {
    const rows = view([item({amount: 500, category: 'income'}, 'pen'), item({}, 'rent')]).rows;
    expect(rows[0]).toMatchObject({amountText: '+500', amountClass: 'positive', payLabel: 'TWODSIX_LEDGER.RECEIVE'});
    expect(rows[1].payLabel).toBe('TWODSIX_LEDGER.PAY');
  });

  test('says why a button is off', () => {
    const rows = view([
      item({active: false}, 'off'),
      item({amount: 0}, 'none'),
      item({reducesDebt: true}, 'debt')
    ], {debt: 0}).rows;
    expect(rows.map(row => row.canPay)).toEqual([false, false, false]);
    expect(rows.map(row => row.payHint)).toEqual(['TWODSIX_LEDGER.PAY_OFF', 'TWODSIX_LEDGER.PAY_NO_AMOUNT', 'TWODSIX_LEDGER.PAY_NO_DEBT']);
    expect(view([item({reducesDebt: true}, 'debt')], {debt: 50}).rows[0]).toMatchObject({canPay: true, payHint: ''});
  });

  test('the summary and the Pay all button count only active monthly items', () => {
    const result = view([
      item({amount: -600}, 'a'),
      item({amount: -200}, 'b'),
      item({amount: 500, frequency: 'year', category: 'income'}, 'c'),
      item({amount: -50, active: false}, 'd')
    ]);
    expect(result.monthText).toBe('-800');
    expect(result.monthClass).toBe('negative');
    expect(result.showYear).toBe(true);
    expect(result.yearText).toBe('+500');
    expect(result.canPayAll).toBe(true);
    expect(result.payAllCount).toBe(2);
    expect(result.payAllTotalText).toBe('-800');
  });

  test('Pay all counts a debt payment at what can actually be paid', () => {
    const result = view([item({amount: -500, reducesDebt: true}, 'loan')], {debt: 120});
    expect(result.payAllTotalText).toBe('-120');
  });

  test('passes the in-game date on', () => {
    expect(view([], {gameDate: 'Holiday 01, 1105'}).gameDate).toBe('Holiday 01, 1105');
  });

  test('numbers follow the locale', () => {
    const [row] = buildRecurringView({items: [item({amount: -1500}, 'a')], locale: 'sv', localize}).rows;
    expect(row.amountText).toBe('−1 500');
  });
});
