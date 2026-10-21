import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  addLoan,
  addRecurringItem,
  deleteLoan,
  deleteRecurringItem,
  editLoan,
  editRecurringItem,
  getLoans,
  getRecurringItems,
  payLoan,
  payRecurringItem,
  takeLoan,
  undoLastTransaction
} from '../scripts/store.js';

function installStubs() {
  let counter = 0;
  globalThis.foundry = {utils: {deepClone: value => structuredClone(value), randomID: () => `id${++counter}`}};
  globalThis.game = {user: {id: 'u1'}, i18n: {localize: key => key}, modules: {get: () => undefined}};
}

function makeActor({cash = 1000, digital = 0, debt = 0, recurring, loans, transactions = [], finances = {}} = {}) {
  return {
    type: 'traveller',
    system: {_source: {financeValues: {cash, debt}, finances}},
    getFlag: (scope, key) => ({digital, transactions, recurring, loans})[key],
    update: vi.fn(async () => {})
  };
}

const rent = {id: 'rent', name: 'Rent', amount: -600, account: 'digital', group: 'living', frequency: 'month', active: true};
const pension = {id: 'pen', name: 'Pension', amount: 500, account: 'digital', group: 'pension', frequency: 'year', active: true};
const vargo = {id: 'vargo', name: 'Vargo', remaining: 12000, monthly: 500, account: 'cash'};
const bank = {id: 'bank', name: 'Bank', remaining: 13000, monthly: 0, account: 'digital'};

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
    expect(items.map(item => [item.id, item.amount, item.group])).toEqual([
      ['seed-living', -800, 'living'], ['seed-ship', -5680, 'ship'], ['seed-pension', 500, 'pension']
    ]);
    expect(actor.update).not.toHaveBeenCalled();
  });

  test('a saved list is used as it is, even an empty one, and items from the first version get a group', () => {
    expect(getRecurringItems(makeActor({recurring: [rent]}))).toEqual([rent]);
    expect(getRecurringItems(makeActor({recurring: [], finances: {livingCosts: '800'}}))).toEqual([]);
    expect(getRecurringItems(makeActor({recurring: [{id: 'old', name: 'Pension', amount: 500, category: 'income'}]}))[0].group).toBe('pension');
  });
});

describe('editing items', () => {
  test('the first change saves the whole list, including the items built from the old fields', async () => {
    const actor = makeActor({finances: {livingCosts: '800'}});
    await editRecurringItem(actor, 'seed-living', {amount: -900});
    const [update, options] = actor.update.mock.calls[0];
    expect(options).toEqual({twodsixLedger: true});
    expect(update['flags.twodsix-ledger.recurring']).toMatchObject([{id: 'seed-living', amount: -900}]);
  });

  test('add and delete', async () => {
    const actor = makeActor({recurring: [rent]});
    const added = await addRecurringItem(actor, {name: 'Food', amount: -200, group: 'living'});
    expect(added).toMatchObject({id: 'id1', name: 'Food', amount: -200});
    expect(actor.update.mock.calls[0][0]['flags.twodsix-ledger.recurring'].map(item => item.id)).toEqual(['rent', 'id1']);
    await deleteRecurringItem(actor, 'rent');
    expect(actor.update.mock.calls[1][0]['flags.twodsix-ledger.recurring']).toEqual([]);
  });
});

describe('payRecurringItem', () => {
  test('adds one ledger entry on the item\'s own account, booked under its group, in one update', async () => {
    const actor = makeActor({cash: 1000, digital: 2000, recurring: [rent]});
    const entry = await payRecurringItem(actor, 'rent');
    expect(actor.update).toHaveBeenCalledTimes(1);
    const [update, options] = actor.update.mock.calls[0];
    expect(options).toEqual({twodsixLedger: true});
    expect(update['flags.twodsix-ledger.digital']).toBe(1400);
    expect('system.financeValues.cash' in update).toBe(false);
    expect(update['flags.twodsix-ledger.transactions']).toEqual([entry]);
    expect(entry).toMatchObject({amount: -600, account: 'digital', category: 'living', description: 'Rent'});
    expect('loan' in entry).toBe(false);
  });

  test('receiving a yearly pension adds income', async () => {
    const actor = makeActor({digital: 0, recurring: [pension]});
    const entry = await payRecurringItem(actor, 'pen');
    expect(actor.update.mock.calls[0][0]['flags.twodsix-ledger.digital']).toBe(500);
    expect(entry.category).toBe('income');
  });

  test('does nothing for an unknown item or an item that is off', async () => {
    const actor = makeActor({recurring: [{...rent, id: 'off', active: false}]});
    expect(await payRecurringItem(actor, 'nope')).toBeNull();
    expect(await payRecurringItem(actor, 'off')).toBeNull();
    expect(actor.update).not.toHaveBeenCalled();
  });
});

describe('getLoans', () => {
  test('the old debt becomes one loan when nothing is saved, without writing', () => {
    const actor = makeActor({debt: 25000});
    expect(getLoans(actor)).toMatchObject([{id: 'seed-debt', remaining: 25000, name: 'TWODSIX_LEDGER.SEED_DEBT'}]);
    expect(actor.update).not.toHaveBeenCalled();
  });

  test('a saved list is used as it is', () => {
    expect(getLoans(makeActor({debt: 5, loans: [vargo]}))).toEqual([vargo]);
    expect(getLoans(makeActor({debt: 5, loans: []}))).toEqual([]);
  });
});

describe('payLoan', () => {
  test('pays the monthly amount, lowers the loan and the sheet\'s debt in the same update', async () => {
    const actor = makeActor({cash: 1000, debt: 25000, loans: [vargo, bank]});
    const entry = await payLoan(actor, 'vargo');
    expect(actor.update).toHaveBeenCalledTimes(1);
    const [update] = actor.update.mock.calls[0];
    expect(update['system.financeValues.cash']).toBe(500);
    expect(update['system.financeValues.debt']).toBe(24500);
    expect(update['flags.twodsix-ledger.loans'].map(loan => loan.remaining)).toEqual([11500, 13000]);
    expect(entry).toMatchObject({amount: -500, account: 'cash', category: 'loan', description: 'TWODSIX_LEDGER.LOAN_PAYMENT: Vargo', loan: {id: 'vargo', delta: -500}});
  });

  test('pays a chosen amount from the loan\'s account, never more than is owed', async () => {
    const actor = makeActor({digital: 20000, debt: 13000, loans: [bank]});
    await payLoan(actor, 'bank', 99999);
    const [update] = actor.update.mock.calls[0];
    expect(update['flags.twodsix-ledger.digital']).toBe(7000);
    expect(update['system.financeValues.debt']).toBe(0);
    expect(update['flags.twodsix-ledger.loans'][0].remaining).toBe(0);
  });

  test('writes nothing when there is nothing to pay', async () => {
    const actor = makeActor({debt: 13000, loans: [bank]});
    expect(await payLoan(actor, 'bank')).toBeNull(); // no monthly amount
    expect(await payLoan(actor, 'nope', 5)).toBeNull();
    expect(actor.update).not.toHaveBeenCalled();
  });
});

describe('takeLoan', () => {
  test('creates the loan and puts the money on the account, with an income entry', async () => {
    const actor = makeActor({cash: 100, debt: 0, loans: []});
    const entry = await takeLoan(actor, {name: 'Vargo', amount: 12000, account: 'cash', monthly: 500});
    const [update] = actor.update.mock.calls[0];
    expect(update['system.financeValues.cash']).toBe(12100);
    expect(update['system.financeValues.debt']).toBe(12000);
    expect(update['flags.twodsix-ledger.loans']).toMatchObject([{name: 'Vargo', remaining: 12000, monthly: 500, account: 'cash'}]);
    expect(entry).toMatchObject({amount: 12000, category: 'loan', description: 'TWODSIX_LEDGER.LOAN_TAKEN: Vargo'});
    expect(entry.loan).toMatchObject({delta: 12000, created: true});
  });

  test('needs an amount', async () => {
    const actor = makeActor({loans: []});
    expect(await takeLoan(actor, {name: 'x', amount: 0})).toBeNull();
    expect(actor.update).not.toHaveBeenCalled();
  });
});

describe('editing loans', () => {
  test('editing what is owed updates the sheet\'s debt', async () => {
    const actor = makeActor({debt: 25000, loans: [vargo, bank]});
    await editLoan(actor, 'bank', {remaining: 10000});
    const [update, options] = actor.update.mock.calls[0];
    expect(options).toEqual({twodsixLedger: true});
    expect(update['system.financeValues.debt']).toBe(22000);
  });

  test('add and delete', async () => {
    const actor = makeActor({loans: [vargo]});
    await addLoan(actor, {name: 'Bank', remaining: 300});
    expect(actor.update.mock.calls[0][0]['system.financeValues.debt']).toBe(12300);
    await deleteLoan(actor, 'vargo');
    expect(actor.update.mock.calls[1][0]['system.financeValues.debt']).toBe(0);
  });
});

describe('undo', () => {
  const entry = extra => ({id: 'e1', amount: -500, account: 'cash', toAccount: null, category: 'other', description: '', gameDate: '', timestamp: 1, userId: '', ...extra});

  test('undoing a loan payment puts the money and the loan back', async () => {
    const actor = makeActor({cash: 500, debt: 24500, loans: [{...vargo, remaining: 11500}, bank], transactions: [entry({loan: {id: 'vargo', delta: -500}})]});
    await undoLastTransaction(actor);
    const [update] = actor.update.mock.calls[0];
    expect(update['system.financeValues.cash']).toBe(1000);
    expect(update['system.financeValues.debt']).toBe(25000);
    expect(update['flags.twodsix-ledger.loans'].map(loan => loan.remaining)).toEqual([12000, 13000]);
    expect(update['flags.twodsix-ledger.transactions']).toEqual([]);
  });

  test('undoing a new loan removes the loan and the money', async () => {
    const created = entry({amount: 12000, loan: {id: 'vargo', delta: 12000, created: true}});
    const actor = makeActor({cash: 13000, debt: 12000, loans: [vargo], transactions: [created]});
    await undoLastTransaction(actor);
    const [update] = actor.update.mock.calls[0];
    expect(update['system.financeValues.cash']).toBe(1000);
    expect(update['system.financeValues.debt']).toBe(0);
    expect(update['flags.twodsix-ledger.loans']).toEqual([]);
  });

  test('an ordinary entry leaves loans and debt alone', async () => {
    const actor = makeActor({cash: 5, debt: 100, transactions: [entry({amount: -5})]});
    await undoLastTransaction(actor);
    const [update] = actor.update.mock.calls[0];
    expect('system.financeValues.debt' in update).toBe(false);
    expect('flags.twodsix-ledger.loans' in update).toBe(false);
  });
});

describe('not enough money', () => {
  test('an item that costs more than the account holds is not paid', async () => {
    const actor = makeActor({digital: 500, recurring: [rent]}); // rent is -600 from digital
    expect(await payRecurringItem(actor, 'rent')).toBeNull();
    expect(actor.update).not.toHaveBeenCalled();
    const enough = makeActor({digital: 600, recurring: [rent]});
    expect(await payRecurringItem(enough, 'rent')).not.toBeNull();
  });

  test('income is always received', async () => {
    const actor = makeActor({digital: 0, recurring: [pension]});
    expect(await payRecurringItem(actor, 'pen')).not.toBeNull();
  });

  test('a loan payment is not made when the account cannot cover it', async () => {
    const actor = makeActor({cash: 400, debt: 12000, loans: [vargo]}); // monthly 500 from cash
    expect(await payLoan(actor, 'vargo')).toBeNull();
    expect(await payLoan(actor, 'vargo', 300)).not.toBeNull();
  });
});
