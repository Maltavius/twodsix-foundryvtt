import { describe, expect, test } from 'vitest';
import {
  applyLoanChange,
  createLoan,
  normalizeLoans,
  planLoanPayment,
  planNewLoan,
  removeLoan,
  revertLoanChange,
  seedLoans,
  totalOwed,
  updateLoan
} from '../scripts/loans.js';

const loan = (over = {}, id = 'l1') => createLoan({name: 'Vargo', remaining: 12000, monthly: 500, account: 'cash', ...over}, id);

describe('createLoan', () => {
  test('cleans up values and never goes negative', () => {
    expect(createLoan({name: ' Bank ', remaining: '-199.2', monthly: 'abc', account: 'offshore'}, 3)).toEqual({
      id: '3', name: 'Bank', remaining: 200, monthly: 0, account: 'cash'
    });
  });

  test('handles junk', () => {
    expect(createLoan(undefined, 'x')).toMatchObject({remaining: 0, monthly: 0, name: ''});
  });
});

describe('normalizeLoans and seedLoans', () => {
  test('drops junk and duplicate ids', () => {
    expect(normalizeLoans([{id: 'a', remaining: 5}, null, {remaining: 1}, {id: 'a', remaining: 9}]).map(entry => entry.id)).toEqual(['a']);
    expect(normalizeLoans(undefined)).toEqual([]);
  });

  test('the old debt field becomes one loan, and no debt means no loan', () => {
    expect(seedLoans(25000, 'Debt')).toEqual([{id: 'seed-debt', name: 'Debt', remaining: 25000, monthly: 0, account: 'cash'}]);
    expect(seedLoans(0)).toEqual([]);
    expect(seedLoans(NaN)).toEqual([]);
  });
});

test('totalOwed adds up what is owed', () => {
  expect(totalOwed([loan({remaining: 12000}, 'a'), loan({remaining: 13000}, 'b')])).toBe(25000);
  expect(totalOwed([])).toBe(0);
});

describe('planLoanPayment', () => {
  test('pays the monthly amount by default, from the loan\'s account', () => {
    expect(planLoanPayment(loan())).toEqual({amount: -500, account: 'cash', loan: {id: 'l1', delta: -500}});
  });

  test('pays a chosen amount', () => {
    expect(planLoanPayment(loan(), 2000)).toMatchObject({amount: -2000, loan: {delta: -2000}});
    expect(planLoanPayment(loan(), '750.2')).toMatchObject({amount: -751});
  });

  test('never pays more than is owed', () => {
    expect(planLoanPayment(loan({remaining: 120}))).toMatchObject({amount: -120});
    expect(planLoanPayment(loan({remaining: 120}), 5000)).toMatchObject({amount: -120});
  });

  test('nothing to pay: no monthly amount, no debt left, unusable amount, no loan', () => {
    expect(planLoanPayment(loan({monthly: 0}))).toBeNull();
    expect(planLoanPayment(loan({remaining: 0}))).toBeNull();
    expect(planLoanPayment(loan(), 'abc')).toBeNull();
    expect(planLoanPayment(loan(), 0)).toBeNull();
    expect(planLoanPayment(undefined)).toBeNull();
  });
});

describe('planNewLoan', () => {
  test('makes the loan and the money that arrives', () => {
    const plan = planNewLoan({name: 'Vargo', amount: 12000, account: 'digital', monthly: 500}, 'n1');
    expect(plan.loan).toEqual({id: 'n1', name: 'Vargo', remaining: 12000, monthly: 500, account: 'digital'});
    expect(plan).toMatchObject({amount: 12000, account: 'digital', entryLoan: {id: 'n1', delta: 12000, created: true}});
  });

  test('needs an amount', () => {
    expect(planNewLoan({name: 'x', amount: 0}, 'n')).toBeNull();
    expect(planNewLoan({name: 'x', amount: 'abc'}, 'n')).toBeNull();
    expect(planNewLoan(undefined, 'n')).toBeNull();
  });
});

describe('applyLoanChange and revertLoanChange', () => {
  const loans = [loan({remaining: 1000}, 'a'), loan({remaining: 500}, 'b')];

  test('a payment lowers what is owed, and undo puts it back', () => {
    const paid = applyLoanChange(loans, {id: 'a', delta: -300});
    expect(paid.map(entry => entry.remaining)).toEqual([700, 500]);
    expect(revertLoanChange(paid, {id: 'a', delta: -300}).map(entry => entry.remaining)).toEqual([1000, 500]);
  });

  test('a new loan is added, and undo takes it away again', () => {
    const fresh = loan({remaining: 300}, 'c');
    const added = applyLoanChange(loans, {id: 'c', delta: 300, created: true}, fresh);
    expect(added.map(entry => entry.id)).toEqual(['a', 'b', 'c']);
    expect(revertLoanChange(added, {id: 'c', delta: 300, created: true}).map(entry => entry.id)).toEqual(['a', 'b']);
  });

  test('a loan that has been removed since is simply left out', () => {
    expect(revertLoanChange([loans[1]], {id: 'a', delta: -300})).toEqual([loans[1]]);
  });

  test('never goes below zero', () => {
    expect(applyLoanChange(loans, {id: 'b', delta: -9999})[1].remaining).toBe(0);
  });

  test('does not change the list it is given', () => {
    applyLoanChange(loans, {id: 'a', delta: -300});
    expect(loans[0].remaining).toBe(1000);
  });
});

describe('editing the list', () => {
  const loans = [loan({}, 'a'), loan({name: 'Bank'}, 'b')];

  test('updateLoan cleans the change and keeps the id', () => {
    expect(updateLoan(loans, 'b', {monthly: '250.4', id: 'hacked'})[1]).toMatchObject({id: 'b', monthly: 251});
    expect(updateLoan(loans, 'zzz', {monthly: 1})).toEqual(loans);
  });

  test('removeLoan', () => {
    expect(removeLoan(loans, 'a').map(entry => entry.id)).toEqual(['b']);
  });
});
