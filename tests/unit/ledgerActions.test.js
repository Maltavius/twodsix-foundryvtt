import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  addTransaction,
  getCurrentGameDate,
  moveMoney,
  recordLedgerAdjustments,
  undoLastTransaction
} from '../../src/module/features/finances/ledgerActions.js';

/** Minimal stand-ins for the Foundry globals that ledgerActions.js uses. */
function installFoundryStubs() {
  let counter = 0;
  globalThis.foundry = {
    utils: {
      deepClone: value => structuredClone(value),
      randomID: () => `id${++counter}`,
      setProperty: (obj, path, value) => {
        const keys = path.split('.');
        let target = obj;
        for (const key of keys.slice(0, -1)) {
          target[key] ??= {};
          target = target[key];
        }
        target[keys.at(-1)] = value;
        return true;
      }
    }
  };
  globalThis.game = {
    user: {id: 'user1'},
    i18n: {localize: key => key},
    modules: {get: () => undefined},
    time: {worldTime: 0}
  };
}

function makeActor({cash = 1000, digital = 0, transactions = [], type = 'traveller'} = {}) {
  return {
    type,
    system: {_source: {financeValues: {cash, digital}, ledger: {transactions}}},
    update: vi.fn(async () => {})
  };
}

beforeEach(installFoundryStubs);
afterEach(() => {
  delete globalThis.foundry;
  delete globalThis.game;
  delete globalThis.SimpleCalendar;
  vi.restoreAllMocks();
});

describe('addTransaction', () => {
  test('an expense lowers only its own account and is appended to the ledger in one update', async () => {
    const actor = makeActor({cash: 1000, digital: 500});
    const entry = await addTransaction(actor, {amount: -200, account: 'cash', category: 'equipment', description: 'Auto pistol'});

    expect(actor.update).toHaveBeenCalledTimes(1);
    const [update, options] = actor.update.mock.calls[0];
    expect(options).toEqual({twodsixLedger: true});
    expect(update['system.financeValues.cash']).toBe(800);
    expect('system.financeValues.digital' in update).toBe(false);
    expect(update['system.ledger.transactions']).toEqual([entry]);
    expect(entry).toMatchObject({amount: -200, account: 'cash', category: 'equipment', description: 'Auto pistol', userId: 'user1', toAccount: null});
    expect(entry.id).toBe('id1');
  });

  test('income to digital raises digital and keeps older entries in order', async () => {
    const older = {id: 'old', amount: 5, account: 'cash', toAccount: null, category: 'other', description: '', gameDate: '', timestamp: 1, userId: ''};
    const actor = makeActor({cash: 5, digital: 0, transactions: [older]});
    const entry = await addTransaction(actor, {amount: 5000, account: 'digital', category: 'income'});
    const [update] = actor.update.mock.calls[0];
    expect(update['system.financeValues.digital']).toBe(5000);
    expect(update['system.ledger.transactions']).toEqual([older, entry]);
  });

  test('the stored ledger on the actor is not mutated', async () => {
    const transactions = [];
    const actor = makeActor({transactions});
    await addTransaction(actor, {amount: 1});
    expect(transactions).toEqual([]);
  });

  test('uses an explicit game date, otherwise the current one', async () => {
    const explicit = await addTransaction(makeActor(), {amount: 1, gameDate: '1105-001'});
    expect(explicit.gameDate).toBe('1105-001');

    globalThis.game.time = {worldTime: 100, calendar: {timeToComponents: () => ({year: 3026, month: 9, dayOfMonth: 14})}};
    const automatic = await addTransaction(makeActor(), {amount: 1});
    expect(automatic.gameDate).toBe('3026-10-15');
  });

  test('rejects zero, non-numeric and unknown-account input without writing', async () => {
    const actor = makeActor();
    await expect(addTransaction(actor, {amount: 0})).rejects.toThrow(TypeError);
    await expect(addTransaction(actor, {amount: NaN})).rejects.toThrow(TypeError);
    await expect(addTransaction(actor, {amount: 0.001})).rejects.toThrow(TypeError);
    await expect(addTransaction(actor, {amount: 5, account: 'offshore'})).rejects.toThrow(TypeError);
    await expect(addTransaction(actor)).rejects.toThrow(TypeError);
    expect(actor.update).not.toHaveBeenCalled();
  });

  test('decimal amounts are rounded up to whole Cr, away from zero', async () => {
    const expense = makeActor({cash: 1000});
    const spent = await addTransaction(expense, {amount: -199.2});
    expect(spent.amount).toBe(-200);
    expect(expense.update.mock.calls[0][0]['system.financeValues.cash']).toBe(800);

    const income = makeActor({cash: 1000});
    const earned = await addTransaction(income, {amount: 99.1});
    expect(earned.amount).toBe(100);
    expect(income.update.mock.calls[0][0]['system.financeValues.cash']).toBe(1100);
  });

  test('a balance that already has decimals does not pick up floating point noise', async () => {
    const actor = makeActor({cash: 0.1, digital: 0});
    await addTransaction(actor, {amount: 1});
    expect(actor.update.mock.calls[0][0]['system.financeValues.cash']).toBe(1.1);
  });
});

describe('moveMoney', () => {
  test('moves between accounts, keeps the total, and stores one transfer entry', async () => {
    const actor = makeActor({cash: 100, digital: 900});
    const entry = await moveMoney(actor, {amount: 500, from: 'digital', to: 'cash', description: 'Withdrew cash'});
    const [update, options] = actor.update.mock.calls[0];
    expect(options).toEqual({twodsixLedger: true});
    expect(update['system.financeValues.cash']).toBe(600);
    expect(update['system.financeValues.digital']).toBe(400);
    expect(update['system.ledger.transactions']).toEqual([entry]);
    expect(entry).toMatchObject({amount: 500, account: 'digital', toAccount: 'cash', category: 'transfer'});
  });

  test('a decimal amount is rounded up to whole Cr', async () => {
    const actor = makeActor({cash: 0, digital: 1000});
    const entry = await moveMoney(actor, {amount: 99.5, from: 'digital', to: 'cash'});
    expect(entry.amount).toBe(100);
    const [update] = actor.update.mock.calls[0];
    expect(update['system.financeValues.cash']).toBe(100);
    expect(update['system.financeValues.digital']).toBe(900);
  });

  test('rejects non-positive amounts and identical or unknown accounts', async () => {
    const actor = makeActor();
    await expect(moveMoney(actor, {amount: -5, from: 'cash', to: 'digital'})).rejects.toThrow(TypeError);
    await expect(moveMoney(actor, {amount: 0, from: 'cash', to: 'digital'})).rejects.toThrow(TypeError);
    await expect(moveMoney(actor, {amount: 5, from: 'cash', to: 'cash'})).rejects.toThrow(TypeError);
    await expect(moveMoney(actor, {amount: 5, from: 'cash', to: 'vault'})).rejects.toThrow(TypeError);
    expect(actor.update).not.toHaveBeenCalled();
  });
});

describe('undoLastTransaction', () => {
  test('removes the newest entry and restores the balances it changed', async () => {
    const first = {id: 'a', amount: -200, account: 'cash', toAccount: null};
    const last = {id: 'b', amount: 500, account: 'digital', toAccount: 'cash'};
    const actor = makeActor({cash: 600, digital: 400, transactions: [first, last]});
    const removed = await undoLastTransaction(actor);
    expect(removed).toEqual(last);
    const [update, options] = actor.update.mock.calls[0];
    expect(options).toEqual({twodsixLedger: true});
    expect(update['system.financeValues.cash']).toBe(100);
    expect(update['system.financeValues.digital']).toBe(900);
    expect(update['system.ledger.transactions']).toEqual([first]);
  });

  test('does nothing on an empty ledger', async () => {
    const actor = makeActor();
    expect(await undoLastTransaction(actor)).toBeNull();
    expect(actor.update).not.toHaveBeenCalled();
  });
});

describe('recordLedgerAdjustments', () => {
  test('a balance edited outside the ledger gets an adjustment entry appended in the same update', () => {
    const actor = makeActor({cash: 1000});
    const data = {system: {financeValues: {cash: 1200}}};
    recordLedgerAdjustments(actor, data, {});
    const entries = data.system.ledger.transactions;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      amount: 200, account: 'cash', category: 'adjustment', userId: 'user1',
      description: 'TWODSIX.Actor.Finances.MANUAL_ADJUSTMENT'
    });
  });

  test('keeps existing entries and does not mutate the stored ledger', () => {
    const existing = {id: 'x', amount: 1, account: 'cash', toAccount: null};
    const transactions = [existing];
    const actor = makeActor({cash: 10, transactions});
    const data = {system: {financeValues: {cash: 5}}};
    recordLedgerAdjustments(actor, data, {});
    expect(data.system.ledger.transactions).toHaveLength(2);
    expect(data.system.ledger.transactions[0]).toEqual(existing);
    expect(data.system.ledger.transactions[1].amount).toBe(-5);
    expect(transactions).toHaveLength(1);
  });

  test('an adjustment keeps the exact difference, so the ledger always agrees with the balance', () => {
    const actor = makeActor({cash: 1000});
    const data = {system: {financeValues: {cash: 1000.5}}};
    recordLedgerAdjustments(actor, data, {});
    expect(data.system.ledger.transactions[0].amount).toBe(0.5);
  });

  test('a change in both accounts creates one entry per account', () => {
    const actor = makeActor({cash: 10, digital: 10});
    const data = {system: {financeValues: {cash: 20, digital: 0}}};
    recordLedgerAdjustments(actor, data, {});
    expect(data.system.ledger.transactions.map(entry => [entry.account, entry.amount])).toEqual([['cash', 10], ['digital', -10]]);
  });

  test.each([
    ['the update came from the ledger itself', makeActor({cash: 1}), {system: {financeValues: {cash: 2}}}, {twodsixLedger: true}],
    ['the caller already supplies ledger entries', makeActor({cash: 1}), {system: {financeValues: {cash: 2}, ledger: {transactions: []}}}, {}],
    ['the balance did not change', makeActor({cash: 1}), {system: {financeValues: {cash: 1}}}, {}],
    ['no balance is part of the update', makeActor({cash: 1}), {system: {finances: {pension: '5'}}}, {}],
    ['an unrelated field value (non-numeric) is sent', makeActor({cash: 1}), {system: {financeValues: {pension: 5}}}, {}],
    ['the actor is not a traveller', makeActor({cash: 1, type: 'ship'}), {system: {financeValues: {cash: 2}}}, {}]
  ])('adds nothing when %s', (_label, actor, data, options) => {
    const before = structuredClone(data);
    recordLedgerAdjustments(actor, data, options);
    expect(data).toEqual(before);
  });
});

describe('getCurrentGameDate', () => {
  test('is empty when the world clock has never been advanced', () => {
    globalThis.game.time = {worldTime: 0, calendar: {timeToComponents: () => ({year: 1, month: 0, dayOfMonth: 0})}};
    expect(getCurrentGameDate()).toBe('');
  });

  test('is empty when there is no calendar at all', () => {
    globalThis.game.time = {worldTime: 5000};
    expect(getCurrentGameDate()).toBe('');
  });

  test('uses the core calendar (zero based month and day) once time has advanced', () => {
    globalThis.game.time = {worldTime: 5000, calendar: {timeToComponents: () => ({year: 3026, month: 0, dayOfMonth: 8})}};
    expect(getCurrentGameDate()).toBe('3026-01-09');
  });

  test('prefers Simple Calendar when it is active', () => {
    globalThis.game.modules = {get: id => (id === 'foundryvtt-simple-calendar' ? {active: true} : undefined)};
    globalThis.game.time = {worldTime: 5000, calendar: {timeToComponents: () => ({year: 1, month: 0, dayOfMonth: 0})}};
    globalThis.SimpleCalendar = {api: {timestamp: () => 123, timestampToDate: () => ({year: 1105, month: 11, day: 30})}};
    expect(getCurrentGameDate()).toBe('1105-12-31');
  });

  test('falls back to blank, with a warning, if the calendar API throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.game.time = {worldTime: 5000, calendar: {timeToComponents: () => { throw new Error('boom'); }}};
    expect(getCurrentGameDate()).toBe('');
    expect(warn).toHaveBeenCalled();
  });

  test('ignores incomplete calendar data', () => {
    globalThis.game.time = {worldTime: 5000, calendar: {timeToComponents: () => ({year: 3026})}};
    expect(getCurrentGameDate()).toBe('');
  });
});
