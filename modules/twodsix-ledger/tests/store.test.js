import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  addTransaction,
  getCurrentGameDate,
  moveMoney,
  recordLedgerAdjustments,
  undoLastTransaction
} from '../scripts/store.js';

const ID = 'twodsix-ledger';

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
    system: {_source: {financeValues: {cash}}},
    getFlag: (scope, key) => ({digital, transactions})[key],
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
    expect('flags.twodsix-ledger.digital' in update).toBe(false);
    expect(update['flags.twodsix-ledger.transactions']).toEqual([entry]);
    expect(entry).toMatchObject({amount: -200, account: 'cash', category: 'equipment', description: 'Auto pistol', userId: 'user1', toAccount: null});
    expect(entry.id).toBe('id1');
  });

  test('income to digital raises digital and keeps older entries in order', async () => {
    const older = {id: 'old', amount: 5, account: 'cash', toAccount: null, category: 'other', description: '', gameDate: '', timestamp: 1, userId: ''};
    const actor = makeActor({cash: 5, digital: 0, transactions: [older]});
    const entry = await addTransaction(actor, {amount: 5000, account: 'digital', category: 'income'});
    const [update] = actor.update.mock.calls[0];
    expect(update['flags.twodsix-ledger.digital']).toBe(5000);
    expect(update['flags.twodsix-ledger.transactions']).toEqual([older, entry]);
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

    globalThis.game.modules = new Map([['foundryvtt-simple-calendar-reborn', {active: true}]]);
    globalThis.SimpleCalendar = {api: {timestamp: () => 1, timestampToDate: () => ({year: 3026, month: 9, day: 14})}};
    const automatic = await addTransaction(makeActor(), {amount: 1});
    expect(automatic.gameDate).toBe('3026-10-15');

    // No calendar module: no in-game date, so the history shows the real date
    delete globalThis.SimpleCalendar;
    globalThis.game.modules = new Map();
    expect((await addTransaction(makeActor(), {amount: 1})).gameDate).toBe('');
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
    expect(update['flags.twodsix-ledger.digital']).toBe(400);
    expect(update['flags.twodsix-ledger.transactions']).toEqual([entry]);
    expect(entry).toMatchObject({amount: 500, account: 'digital', toAccount: 'cash', category: 'transfer'});
  });

  test('a decimal amount is rounded up to whole Cr', async () => {
    const actor = makeActor({cash: 0, digital: 1000});
    const entry = await moveMoney(actor, {amount: 99.5, from: 'digital', to: 'cash'});
    expect(entry.amount).toBe(100);
    const [update] = actor.update.mock.calls[0];
    expect(update['system.financeValues.cash']).toBe(100);
    expect(update['flags.twodsix-ledger.digital']).toBe(900);
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
    expect(update['flags.twodsix-ledger.digital']).toBe(900);
    expect(update['flags.twodsix-ledger.transactions']).toEqual([first]);
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
    const entries = data.flags[ID].transactions;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      amount: 200, account: 'cash', category: 'adjustment', userId: 'user1',
      description: 'TWODSIX_LEDGER.MANUAL_ADJUSTMENT'
    });
  });

  test('keeps existing entries and does not mutate the stored ledger', () => {
    const existing = {id: 'x', amount: 1, account: 'cash', toAccount: null};
    const transactions = [existing];
    const actor = makeActor({cash: 10, transactions});
    const data = {system: {financeValues: {cash: 5}}};
    recordLedgerAdjustments(actor, data, {});
    expect(data.flags[ID].transactions).toHaveLength(2);
    expect(data.flags[ID].transactions[0]).toEqual(existing);
    expect(data.flags[ID].transactions[1].amount).toBe(-5);
    expect(transactions).toHaveLength(1);
  });

  test('an adjustment keeps the exact difference, so the ledger always agrees with the balance', () => {
    const actor = makeActor({cash: 1000});
    const data = {system: {financeValues: {cash: 1000.5}}};
    recordLedgerAdjustments(actor, data, {});
    expect(data.flags[ID].transactions[0].amount).toBe(0.5);
  });

  test('a digital balance edited by the player gets an adjustment entry', () => {
    const actor = makeActor({digital: 500});
    const data = {flags: {[ID]: {digital: 800}}};
    recordLedgerAdjustments(actor, data, {});
    expect(data.flags[ID].transactions).toHaveLength(1);
    expect(data.flags[ID].transactions[0]).toMatchObject({amount: 300, account: 'digital', category: 'adjustment'});
    expect(data.flags[ID].digital).toBe(800);
  });

  test('a change in both accounts creates one entry per account', () => {
    const actor = makeActor({cash: 10, digital: 10});
    const data = {system: {financeValues: {cash: 20}}, flags: {[ID]: {digital: 0}}};
    recordLedgerAdjustments(actor, data, {});
    expect(data.flags[ID].transactions.map(entry => [entry.account, entry.amount])).toEqual([['cash', 10], ['digital', -10]]);
  });

  test.each([
    ['the update came from the ledger itself', makeActor({cash: 1}), {system: {financeValues: {cash: 2}}}, {twodsixLedger: true}],
    ['the caller already supplies ledger entries', makeActor({cash: 1}), {system: {financeValues: {cash: 2}}, flags: {[ID]: {transactions: []}}}, {}],
    ['the digital balance did not change', makeActor({digital: 5}), {flags: {[ID]: {digital: 5}}}, {}],
    ['another module\'s flags change', makeActor({cash: 1}), {flags: {other: {x: 1}}}, {}],
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
  const coreCalendar = {worldTime: 5000, calendar: {timeToComponents: () => ({year: 1104, month: 3, dayOfMonth: 0})}};

  test('is empty without a calendar module, so the real date is shown instead', () => {
    globalThis.game.time = {worldTime: 0};
    expect(getCurrentGameDate()).toBe('');
  });

  test('the core calendar is not used, even when the world clock has advanced', () => {
    globalThis.game.time = coreCalendar;
    expect(getCurrentGameDate()).toBe('');
  });

  describe('Simple Calendar forks and the way the date is written', () => {
    const coreCalendar = {worldTime: 5000, calendar: {timeToComponents: () => ({year: 1104, month: 3, dayOfMonth: 0})}};
    const modulesMap = (...ids) => new Map(ids.map(id => [id, {active: true}]));

    test('Simple Calendar Reborn (another module id) is used, not the core calendar', () => {
      globalThis.game.modules = modulesMap('foundryvtt-simple-calendar-reborn');
      globalThis.game.time = coreCalendar;
      globalThis.SimpleCalendar = {api: {timestamp: () => 1, timestampToDate: () => ({year: 1105, month: 0, day: 0})}};
      expect(getCurrentGameDate()).toBe('1105-01-01');
      expect(getCurrentGameDate()).not.toBe('1104-04-01');
    });

    test('uses the text in display.date (what Simple Calendar Reborn returns), without calling the formatter', () => {
      globalThis.game.modules = modulesMap('foundryvtt-simple-calendar-reborn');
      const formatDateTime = vi.fn(() => {
        throw new Error('should not be needed');
      });
      globalThis.SimpleCalendar = {api: {timestamp: () => 1, formatDateTime, timestampToDate: () => ({year: 1105, month: 0, day: 0, display: {date: 'Holiday 01, 1105', time: '00:02:07', month: '-1'}})}};
      expect(getCurrentGameDate()).toBe('Holiday 01, 1105');
      expect(formatDateTime).not.toHaveBeenCalled();
    });

    test('a formatter that throws does not lose the date: numbers are used', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      globalThis.game.modules = modulesMap('foundryvtt-simple-calendar-reborn');
      globalThis.SimpleCalendar = {api: {timestamp: () => 1, formatDateTime: () => {
        throw new TypeError('bad arguments');
      }, timestampToDate: () => ({year: 1105, month: 0, day: 0})}};
      expect(getCurrentGameDate()).toBe('1105-01-01');
      expect(warn).not.toHaveBeenCalled();
    });

    test('the date is written the way the calendar shows it when it can format it (object result)', () => {
      globalThis.game.modules = modulesMap('foundryvtt-simple-calendar-reborn');
      globalThis.SimpleCalendar = {api: {timestamp: () => 1, timestampToDate: () => ({year: 1105, month: 0, day: 0}), formatDateTime: () => ({date: 'Holiday 01, 1105', time: '00:02:07'})}};
      expect(getCurrentGameDate()).toBe('Holiday 01, 1105');
    });

    test('a plain string from the formatter is used as well', () => {
      globalThis.game.modules = modulesMap('foundryvtt-simple-calendar');
      globalThis.SimpleCalendar = {api: {timestamp: () => 1, timestampToDate: () => ({year: 1105, month: 0, day: 0}), formatDateTime: () => ' Holiday 01, 1105 '}};
      expect(getCurrentGameDate()).toBe('Holiday 01, 1105');
    });

    test('numbers are used if the formatter returns nothing useful', () => {
      globalThis.game.modules = modulesMap('foundryvtt-simple-calendar');
      globalThis.SimpleCalendar = {api: {timestamp: () => 1, timestampToDate: () => ({year: 1105, month: 4, day: 9}), formatDateTime: () => undefined}};
      expect(getCurrentGameDate()).toBe('1105-05-10');
    });

    test('works whatever the module is called, as long as its API is there', () => {
      globalThis.game.modules = new Map();
      globalThis.SimpleCalendar = {api: {timestamp: () => 1, timestampToDate: () => ({year: 1105, month: 0, day: 0, display: {date: 'Holiday 01, 1105'}})}};
      expect(getCurrentGameDate()).toBe('Holiday 01, 1105');
    });

    test('an API without the functions we need is ignored', () => {
      globalThis.SimpleCalendar = {api: {}};
      globalThis.game.time = coreCalendar;
      expect(getCurrentGameDate()).toBe('');
    });
  });

  test('falls back to blank, with a warning, if the calendar API throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.game.modules = new Map([['foundryvtt-simple-calendar-reborn', {active: true}]]);
    globalThis.SimpleCalendar = {api: {timestamp: () => {
      throw new Error('boom');
    }, timestampToDate: () => ({})}};
    expect(getCurrentGameDate()).toBe('');
    expect(warn).toHaveBeenCalled();
  });

  test('ignores incomplete calendar data', () => {
    globalThis.game.modules = new Map([['foundryvtt-simple-calendar-reborn', {active: true}]]);
    globalThis.SimpleCalendar = {api: {timestamp: () => 1, timestampToDate: () => ({year: 1105})}};
    expect(getCurrentGameDate()).toBe('');
  });
});
