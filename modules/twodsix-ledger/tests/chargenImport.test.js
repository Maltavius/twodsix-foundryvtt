import { describe, expect, test } from 'vitest';
import { chooseImporterId, planChargenImport, readChargenFinances } from '../scripts/chargenImport.js';
import { configureLedger } from '../scripts/ledger.js';

configureLedger();

const FLAG = {
  version: 1, currency: 'Cr', createdAt: '2026-11-08T10:00:00.000Z', cash: 26000, debt: 3000, pension: 10000, shipShares: 3,
  entries: [
    {id: 'income-musterOutCash', kind: 'income', source: 'musterOutCash', label: 'Mustering-out cash', amount: 60000},
    {id: 'expense-anagathics', kind: 'expense', source: 'anagathics', label: 'Anagathics', amount: 25000},
    {id: 'expense-lawyer', kind: 'expense', source: 'lawyer', label: 'Lawyer', amount: 9000},
    {id: 'debt-medicalBills', kind: 'debt', source: 'medicalBills', label: 'Medical bills', amount: 3000},
    {id: 'pension-pension', kind: 'pension', source: 'pension', label: 'Pension (per year)', amount: 10000},
    {id: 'shipShares-shipShares', kind: 'shipShares', source: 'shipShares', label: 'Ship Shares', amount: 3}
  ]
};
const TEXT = {prefix: 'Character generation', opening: 'opening balance'};
let counter = 0;
const makeId = () => `id${++counter}`;
const emptyState = (cash = 26000) => ({transactions: [], balances: {cash, digital: 0}, storedLoans: undefined, recurring: [], notes: ''});
const plan = (raw = FLAG, state = emptyState()) => {
  const read = readChargenFinances(raw);
  return planChargenImport(read.entries, state, TEXT, read.createdAt, makeId);
};

describe('reading the chargen flag', () => {
  test('no flag, or something that is not a flag, means nothing to import', () => {
    expect(readChargenFinances(undefined)).toEqual({ok: false, reason: 'missing'});
    expect(readChargenFinances('text')).toEqual({ok: false, reason: 'missing'});
    expect(readChargenFinances({entries: []})).toEqual({ok: false, reason: 'invalid'});
  });

  test('a newer version than version 1 is skipped', () => {
    expect(readChargenFinances({...FLAG, version: 2})).toEqual({ok: false, reason: 'version'});
  });

  test('entries are checked: unknown kinds, zero and unusable amounts are dropped, ids stay unique', () => {
    const read = readChargenFinances({version: 1, entries: [
      {id: 'a', kind: 'income', label: 'A', amount: 5},
      {id: 'a', kind: 'income', label: 'again', amount: 6},
      {id: 'b', kind: 'gift', label: 'B', amount: 7},
      {id: 'c', kind: 'expense', label: 'C', amount: 0},
      {id: 'd', kind: 'expense', label: 'D', amount: 'lots'},
      {id: 'e', kind: 'expense', label: 'E', amount: -40}
    ]});
    expect(read.entries.map(entry => [entry.id, entry.amount])).toEqual([['a', 5], ['e', 40]]);
  });

  test('the time of generation is read, or today is used if it is missing', () => {
    expect(readChargenFinances(FLAG).createdAt).toBe(Date.parse('2026-11-08T10:00:00.000Z'));
    expect(Number.isFinite(readChargenFinances({version: 1, entries: []}).createdAt)).toBe(true);
  });
});

describe('what is put in the ledger', () => {
  test('income and expenses become history that adds up to the cash on the sheet, and the balance is not touched', () => {
    const result = plan();
    expect(result.transactions.map(entry => [entry.description, entry.amount, entry.category])).toEqual([
      ['Character generation: Mustering-out cash', 60000, 'income'],
      ['Character generation: Anagathics', -25000, 'medical'],
      ['Character generation: Lawyer', -9000, 'other']
    ]);
    expect(result.transactions.every(entry => entry.account === 'cash')).toBe(true);
    expect(result.transactions.reduce((sum, entry) => sum + entry.amount, 0)).toBe(26000);
  });

  test('the entries get no date: not the real date of generation, and no in-game date', () => {
    const result = plan(FLAG, emptyState(27500));
    expect(result.transactions.every(entry => entry.timestamp === 0 && entry.gameDate === '')).toBe(true);
  });

  test('if the cash was changed before the ledger ran, one entry makes the history add up', () => {
    const result = plan(FLAG, emptyState(27500));
    expect(result.transactions).toHaveLength(4);
    expect(result.transactions[0]).toMatchObject({amount: 1500, category: 'adjustment', description: 'Character generation: opening balance'});
    expect(result.transactions.reduce((sum, entry) => sum + entry.amount, 0)).toBe(27500);
  });

  test('older ledger entries stay after the imported ones, and the history still adds up', () => {
    const later = {id: 'x', amount: -500, account: 'cash', toAccount: null, category: 'equipment', description: 'Rope', gameDate: '', timestamp: 5, userId: ''};
    const result = plan(FLAG, {...emptyState(25500), transactions: [later]});
    expect(result.transactions.at(-1)).toBe(later);
    expect(result.transactions).toHaveLength(4);
    expect(result.transactions.reduce((sum, entry) => sum + entry.amount, 0)).toBe(25500);
  });

  test('debts become loans with nothing paid out, unless the player has saved loans of their own', () => {
    expect(plan().loans).toMatchObject([{name: 'Medical bills', remaining: 3000, monthly: 0, account: 'cash'}]);
    expect(plan(FLAG, {...emptyState(), storedLoans: []}).loans).toBeNull();
  });

  test('the pension is a yearly recurring item, once', () => {
    const [pension] = plan().recurring;
    expect(pension).toMatchObject({name: 'Pension (per year)', amount: 10000, group: 'pension', frequency: 'year', active: true});
    const seeded = {...emptyState(), recurring: [pension]};
    expect(plan(FLAG, seeded).recurring).toBeNull();
  });

  test('ship shares are a note in the financial notes, not money, and only once', () => {
    const result = plan();
    expect(result.notes).toBe('<p>Ship Shares: 3 (Character generation)</p>');
    expect(plan(FLAG, {...emptyState(), notes: result.notes}).notes).toBeNull();
    expect(plan(FLAG, {...emptyState(), notes: '<p>Old</p>'}).notes).toBe('<p>Old</p><p>Ship Shares: 3 (Character generation)</p>');
  });

  test('text from the flag cannot add markup to the notes', () => {
    const raw = {version: 1, entries: [{kind: 'shipShares', label: '<b>Shares</b>', amount: 1}]};
    expect(plan(raw).notes).toBe('<p>&lt;b&gt;Shares&lt;/b&gt;: 1 (Character generation)</p>');
  });

  test('a flag without money entries changes nothing', () => {
    const result = plan({version: 1, entries: []});
    expect(result).toMatchObject({transactions: null, loans: null, recurring: null, notes: null});
  });
});

describe('who does the import', () => {
  test('the GM if one is online, otherwise the owner with the lowest id', () => {
    expect(chooseImporterId('gm1', ['u2', 'u1'])).toBe('gm1');
    expect(chooseImporterId(undefined, ['u2', 'u1'])).toBe('u1');
    expect(chooseImporterId(undefined, [])).toBeUndefined();
  });
});
