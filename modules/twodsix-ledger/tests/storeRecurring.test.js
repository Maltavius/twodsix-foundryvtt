import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  addRecurringItem,
  deleteRecurringItem,
  editRecurringItem,
  getRecurringItems,
  payAllRecurring,
  payRecurringItem,
  undoLastTransaction
} from '../scripts/store.js';

function installStubs() {
  let counter = 0;
  globalThis.foundry = {utils: {deepClone: value => structuredClone(value), randomID: () => `id${++counter}`}};
  globalThis.game = {user: {id: 'u1'}, i18n: {localize: key => key}, modules: {get: () => undefined}};
}

function makeActor({cash = 1000, digital = 0, debt = 0, recurring, transactions = [], finances = {}} = {}) {
  return {
    type: 'traveller',
    system: {_source: {financeValues: {cash, debt}, finances}},
    getFlag: (scope, key) => ({digital, transactions, recurring})[key],
    update: vi.fn(async () => {})
  };
}

const rent = {id: 'rent', name: 'Rent', amount: -600, account: 'digital', category: 'living', frequency: 'month', active: true, reducesDebt: false};
const loan = {id: 'loan', name: 'Loan', amount: -500, account: 'cash', category: 'other', frequency: 'month', active: true, reducesDebt: true};
const pension = {id: 'pen', name: 'Pension', amount: 500, account: 'digital', category: 'income', frequency: 'year', active: true, reducesDebt: false};

beforeEach(installStubs);
afterEach(() => {
  delete globalThis.foundry;
  delete globalThis.game;
  vi.restoreAllMocks();
});

describe('getRecurringItems', () => {
  test('builds a list from the old sheet fields when nothing is saved, without writing', () => {
    const actor = makeActor({finances: {pension: '500', payments: '5 680', livingCosts: '800'}});
    const items = getRecurringItems(actor);
    expect(items.map(item => [item.id, item.amount])).toEqual([['seed-living', -800], ['seed-ship', -5680], ['seed-pension', 500]]);
    expect(actor.update).not.toHaveBeenCalled();
  });

  test('a saved list is used as it is, even an empty one', () => {
    expect(getRecurringItems(makeActor({recurring: [rent]}))).toEqual([rent]);
    expect(getRecurringItems(makeActor({recurring: [], finances: {livingCosts: '800'}}))).toEqual([]);
  });
});

describe('editing', () => {
  test('the first change saves the whole list, including the items built from the old fields', async () => {
    const actor = makeActor({finances: {livingCosts: '800'}});
    await editRecurringItem(actor, 'seed-living', {amount: -900});
    const [update, options] = actor.update.mock.calls[0];
    expect(options).toEqual({twodsixLedger: true});
    expect(update['flags.twodsix-ledger.recurring']).toMatchObject([{id: 'seed-living', amount: -900}]);
  });

  test('add and delete', async () => {
    const actor = makeActor({recurring: [rent]});
    const added = await addRecurringItem(actor, {name: 'Food', amount: -200});
    expect(added).toMatchObject({id: 'id1', name: 'Food', amount: -200});
    expect(actor.update.mock.calls[0][0]['flags.twodsix-ledger.recurring'].map(item => item.id)).toEqual(['rent', 'id1']);

    await deleteRecurringItem(actor, 'rent');
    expect(actor.update.mock.calls[1][0]['flags.twodsix-ledger.recurring']).toEqual([]);
  });
});

describe('payRecurringItem', () => {
  test('adds one ledger entry on the item\'s own account, in one update', async () => {
    const actor = makeActor({cash: 1000, digital: 2000, recurring: [rent]});
    const entry = await payRecurringItem(actor, 'rent');
    expect(actor.update).toHaveBeenCalledTimes(1);
    const [update, options] = actor.update.mock.calls[0];
    expect(options).toEqual({twodsixLedger: true});
    expect(update['flags.twodsix-ledger.digital']).toBe(1400);
    expect('system.financeValues.cash' in update).toBe(false);
    expect(update['flags.twodsix-ledger.transactions']).toEqual([entry]);
    expect(entry).toMatchObject({amount: -600, account: 'digital', category: 'living', description: 'Rent'});
    expect('debtChange' in entry).toBe(false);
  });

  test('receiving a yearly pension adds income', async () => {
    const actor = makeActor({digital: 0, recurring: [pension]});
    await payRecurringItem(actor, 'pen');
    expect(actor.update.mock.calls[0][0]['flags.twodsix-ledger.digital']).toBe(500);
  });

  test('a debt payment lowers the debt in the same update and is remembered on the entry', async () => {
    const actor = makeActor({cash: 1000, debt: 25000, recurring: [loan]});
    const entry = await payRecurringItem(actor, 'loan');
    const [update] = actor.update.mock.calls[0];
    expect(update['system.financeValues.cash']).toBe(500);
    expect(update['system.financeValues.debt']).toBe(24500);
    expect(entry.debtChange).toBe(-500);
  });

  test('does nothing for an unknown item, an item that is off, or a debt that is paid', async () => {
    const actor = makeActor({debt: 0, recurring: [loan, {...rent, id: 'off', active: false}]});
    expect(await payRecurringItem(actor, 'nope')).toBeNull();
    expect(await payRecurringItem(actor, 'off')).toBeNull();
    expect(await payRecurringItem(actor, 'loan')).toBeNull();
    expect(actor.update).not.toHaveBeenCalled();
  });
});

describe('payAllRecurring', () => {
  test('posts every active monthly item in one update and skips the yearly one', async () => {
    const actor = makeActor({cash: 1000, digital: 2000, debt: 300, recurring: [rent, loan, pension]});
    const entries = await payAllRecurring(actor);
    expect(actor.update).toHaveBeenCalledTimes(1);
    const [update] = actor.update.mock.calls[0];
    expect(entries.map(entry => entry.description)).toEqual(['Rent', 'Loan']);
    expect(update['flags.twodsix-ledger.digital']).toBe(1400);
    expect(update['system.financeValues.cash']).toBe(700); // the loan pays only the 300 that was owed
    expect(update['system.financeValues.debt']).toBe(0);
    expect(update['flags.twodsix-ledger.transactions']).toHaveLength(2);
  });

  test('writes nothing when there is nothing to pay', async () => {
    const actor = makeActor({recurring: [pension]});
    expect(await payAllRecurring(actor)).toEqual([]);
    expect(actor.update).not.toHaveBeenCalled();
  });
});

describe('undo of a debt payment', () => {
  test('puts the debt back together with the money', async () => {
    const entry = {id: 'e1', amount: -500, account: 'cash', toAccount: null, category: 'other', description: 'Loan', gameDate: '', timestamp: 1, userId: '', debtChange: -500};
    const actor = makeActor({cash: 500, debt: 24500, transactions: [entry]});
    await undoLastTransaction(actor);
    const [update] = actor.update.mock.calls[0];
    expect(update['system.financeValues.cash']).toBe(1000);
    expect(update['system.financeValues.debt']).toBe(25000);
    expect(update['flags.twodsix-ledger.transactions']).toEqual([]);
  });

  test('an ordinary entry leaves the debt alone', async () => {
    const entry = {id: 'e1', amount: -5, account: 'cash', toAccount: null, category: 'other', description: '', gameDate: '', timestamp: 1, userId: ''};
    const actor = makeActor({cash: 5, debt: 100, transactions: [entry]});
    await undoLastTransaction(actor);
    expect('system.financeValues.debt' in actor.update.mock.calls[0][0]).toBe(false);
  });
});
