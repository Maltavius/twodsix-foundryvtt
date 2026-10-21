import { describe, expect, test } from 'vitest';
import {
  DAYS_PER_YEAR,
  MONTHS_PER_YEAR,
  createRecurringItem,
  getPayKind,
  normalizeRecurringItems,
  planPayAll,
  planPayment,
  removeRecurringItem,
  seedRecurringItems,
  summarizeRecurring,
  updateRecurringItem
} from '../scripts/recurring.js';

const item = (over = {}, id = 'a') => createRecurringItem({name: 'Rent', amount: -600, account: 'digital', category: 'living', ...over}, id);

describe('the calendar constants', () => {
  test('13 months of 28 days and Holiday make 365 days', () => {
    expect(MONTHS_PER_YEAR).toBe(13);
    expect(DAYS_PER_YEAR).toBe(365);
  });
});

describe('createRecurringItem', () => {
  test('cleans up values', () => {
    const created = createRecurringItem({name: '  Food ', amount: '-199.2', account: 'bank', frequency: 'week'}, 7);
    expect(created).toEqual({
      id: '7', name: 'Food', amount: -200, account: 'cash', category: 'other', frequency: 'month', active: true, reducesDebt: false
    });
  });

  test('handles junk', () => {
    expect(createRecurringItem(undefined, 'x').amount).toBe(0);
    expect(createRecurringItem({amount: 'abc'}, 'x').amount).toBe(0);
    expect(createRecurringItem({active: false, reducesDebt: true}, 'x')).toMatchObject({active: false, reducesDebt: true});
  });
});

describe('normalizeRecurringItems', () => {
  test('drops junk and duplicate ids', () => {
    const list = normalizeRecurringItems([{id: 'a', amount: 5}, null, 'x', {amount: 1}, {id: 'a', amount: 9}, {id: 'b'}]);
    expect(list.map(entry => entry.id)).toEqual(['a', 'b']);
    expect(list[0].amount).toBe(5);
  });

  test('anything that is not a list gives an empty list', () => {
    expect(normalizeRecurringItems(undefined)).toEqual([]);
    expect(normalizeRecurringItems({})).toEqual([]);
  });
});

describe('seedRecurringItems', () => {
  test('makes items from the old fields, with the right signs and frequencies', () => {
    const items = seedRecurringItems({pension: 500, payments: 5680, livingCosts: -800});
    expect(items.map(entry => [entry.id, entry.amount, entry.frequency, entry.category])).toEqual([
      ['seed-living', -800, 'month', 'living'],
      ['seed-ship', -5680, 'month', 'ship'],
      ['seed-pension', 500, 'year', 'income']
    ]);
  });

  test('leaves out fields that are empty or zero', () => {
    expect(seedRecurringItems({pension: 0, payments: NaN})).toEqual([]);
    expect(seedRecurringItems()).toEqual([]);
  });

  test('names come from the localizer', () => {
    expect(seedRecurringItems({livingCosts: 1}, key => `[${key}]`)[0].name).toBe('[TWODSIX_LEDGER.SEED_LIVING]');
  });
});

describe('summarizeRecurring', () => {
  test('counts only active items, and keeps months and years apart', () => {
    const summary = summarizeRecurring([
      item({amount: -600}, 'a'),
      item({amount: -200}, 'b'),
      item({amount: 300}, 'c'),
      item({amount: -150, active: false}, 'd'),
      item({amount: 500, frequency: 'year'}, 'e')
    ]);
    expect(summary.monthly).toEqual({net: -500, costs: -800, income: 300, count: 3});
    expect(summary.yearly).toEqual({net: 500, count: 1});
  });

  test('an empty list is all zeros', () => {
    expect(summarizeRecurring([])).toEqual({monthly: {net: 0, costs: 0, income: 0, count: 0}, yearly: {net: 0, count: 0}});
  });
});

describe('planPayment', () => {
  test('a plain item pays its own amount from its own account', () => {
    expect(planPayment(item())).toEqual({
      amount: -600, account: 'digital', category: 'living', description: 'Rent', debtChange: 0, itemId: 'a'
    });
  });

  test('income is received as a positive entry', () => {
    expect(planPayment(item({amount: 500, category: 'income'}))?.amount).toBe(500);
  });

  test('nothing to pay for an item that is off or has no amount', () => {
    expect(planPayment(item({active: false}))).toBeNull();
    expect(planPayment(item({amount: 0}))).toBeNull();
    expect(planPayment(null)).toBeNull();
  });

  test('a debt payment lowers the debt', () => {
    const plan = planPayment(item({amount: -500, reducesDebt: true}), {debt: 25000});
    expect(plan).toMatchObject({amount: -500, debtChange: -500});
  });

  test('a debt payment never pays more than is owed', () => {
    const plan = planPayment(item({amount: -500, reducesDebt: true}), {debt: 120});
    expect(plan).toMatchObject({amount: -120, debtChange: -120});
  });

  test('with no debt left there is nothing to pay', () => {
    expect(planPayment(item({amount: -500, reducesDebt: true}), {debt: 0})).toBeNull();
    expect(planPayment(item({amount: -500, reducesDebt: true}), {debt: -50})).toBeNull();
  });
});

describe('planPayAll', () => {
  test('pays active monthly items in order and leaves yearly ones out', () => {
    const plans = planPayAll([
      item({amount: -600}, 'a'),
      item({amount: 500, frequency: 'year', category: 'income'}, 'b'),
      item({amount: -200, active: false}, 'c'),
      item({amount: -50}, 'd')
    ]);
    expect(plans.map(plan => plan.itemId)).toEqual(['a', 'd']);
  });

  test('two debt payments share what is owed', () => {
    const plans = planPayAll([
      item({amount: -500, reducesDebt: true}, 'a'),
      item({amount: -500, reducesDebt: true}, 'b')
    ], {debt: 700});
    expect(plans.map(plan => plan.amount)).toEqual([-500, -200]);
    expect(plans.reduce((sum, plan) => sum + plan.debtChange, 0)).toBe(-700);
  });
});

describe('editing the list', () => {
  const list = [item({}, 'a'), item({name: 'Food', amount: -200}, 'b')];

  test('updateRecurringItem changes one item, cleaned, and leaves the rest', () => {
    const updated = updateRecurringItem(list, 'b', {amount: '-250.4', frequency: 'year', id: 'hacked'});
    expect(updated[1]).toMatchObject({id: 'b', amount: -251, frequency: 'year'});
    expect(updated[0]).toBe(list[0]);
    expect(list[1].amount).toBe(-200);
  });

  test('an unknown id changes nothing', () => {
    expect(updateRecurringItem(list, 'zzz', {amount: 1})).toEqual(list);
  });

  test('removeRecurringItem', () => {
    expect(removeRecurringItem(list, 'a').map(entry => entry.id)).toEqual(['b']);
  });
});

test('getPayKind', () => {
  expect(getPayKind(item({amount: -1}))).toBe('pay');
  expect(getPayKind(item({amount: 1}))).toBe('receive');
});
