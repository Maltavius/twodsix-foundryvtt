import { describe, expect, test } from 'vitest';
import {
  DAYS_PER_YEAR,
  GROUP_CATEGORY,
  MONTHS_PER_YEAR,
  createRecurringItem,
  getPayKind,
  itemsInGroup,
  normalizeRecurringItems,
  planPayment,
  removeRecurringItem,
  seedRecurringItems,
  summarizeItems,
  updateRecurringItem
} from '../scripts/recurring.js';

const item = (over = {}, id = 'a') => createRecurringItem({name: 'Rent', amount: -600, account: 'digital', group: 'living', ...over}, id);

describe('the calendar constants', () => {
  test('13 months of 28 days and Holiday make 365 days', () => {
    expect(MONTHS_PER_YEAR).toBe(13);
    expect(DAYS_PER_YEAR).toBe(365);
  });
});

describe('createRecurringItem', () => {
  test('cleans up values', () => {
    const created = createRecurringItem({name: '  Food ', amount: '-199.2', account: 'bank', frequency: 'week'}, 7);
    expect(created).toEqual({id: '7', name: 'Food', amount: -200, account: 'cash', group: 'living', frequency: 'month', active: true});
  });

  test('handles junk', () => {
    expect(createRecurringItem(undefined, 'x').amount).toBe(0);
    expect(createRecurringItem({amount: 'abc'}, 'x').amount).toBe(0);
    expect(createRecurringItem({active: false}, 'x').active).toBe(false);
    expect(createRecurringItem({group: 'crime'}, 'x').group).toBe('living');
  });

  test('items saved with a category (first version) get the matching group', () => {
    expect(createRecurringItem({category: 'income'}, 'x').group).toBe('pension');
    expect(createRecurringItem({category: 'ship'}, 'x').group).toBe('ship');
    expect(createRecurringItem({category: 'living'}, 'x').group).toBe('living');
    expect(createRecurringItem({category: 'medical'}, 'x').group).toBe('living');
    expect(createRecurringItem({category: 'income', group: 'ship'}, 'x').group).toBe('ship');
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
  test('makes items from the old fields, with the right signs, groups and frequencies', () => {
    const items = seedRecurringItems({pension: 500, payments: 5680, livingCosts: -800});
    expect(items.map(entry => [entry.id, entry.amount, entry.frequency, entry.group])).toEqual([
      ['seed-living', -800, 'month', 'living'],
      ['seed-ship', -5680, 'month', 'ship'],
      ['seed-pension', 500, 'year', 'pension']
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

describe('itemsInGroup and summarizeItems', () => {
  const items = [
    item({amount: -600}, 'a'),
    item({amount: -200}, 'b'),
    item({amount: -5680, group: 'ship'}, 'c'),
    item({amount: 500, group: 'pension', frequency: 'year'}, 'd'),
    item({amount: -150, active: false}, 'e')
  ];

  test('itemsInGroup', () => {
    expect(itemsInGroup(items, 'living').map(entry => entry.id)).toEqual(['a', 'b', 'e']);
    expect(itemsInGroup(items, 'ship').map(entry => entry.id)).toEqual(['c']);
  });

  test('counts only active items, and keeps months and years apart', () => {
    expect(summarizeItems(itemsInGroup(items, 'living'))).toEqual({monthly: {net: -800, count: 2}, yearly: {net: 0, count: 0}, count: 2});
    expect(summarizeItems(itemsInGroup(items, 'pension'))).toEqual({monthly: {net: 0, count: 0}, yearly: {net: 500, count: 1}, count: 1});
  });

  test('an empty list is all zeros', () => {
    expect(summarizeItems([])).toEqual({monthly: {net: 0, count: 0}, yearly: {net: 0, count: 0}, count: 0});
  });
});

describe('planPayment', () => {
  test('pays the item\'s own amount from its own account, booked under its group\'s category', () => {
    expect(planPayment(item())).toEqual({amount: -600, account: 'digital', category: 'living', description: 'Rent', itemId: 'a'});
    expect(planPayment(item({group: 'ship'}))?.category).toBe('ship');
    expect(GROUP_CATEGORY.pension).toBe('income');
  });

  test('a pension is received as a positive entry', () => {
    expect(planPayment(item({amount: 500, group: 'pension'}))).toMatchObject({amount: 500, category: 'income'});
  });

  test('nothing to pay for an item that is off or has no amount', () => {
    expect(planPayment(item({active: false}))).toBeNull();
    expect(planPayment(item({amount: 0}))).toBeNull();
    expect(planPayment(null)).toBeNull();
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
