import { describe, expect, test } from 'vitest';
import {
  ammoState,
  autoRate,
  equipStateForDrop,
  fireRules,
  hasFireModes,
  describeWeaponAmmo,
  fireModeKey,
  firstNotEquippedId,
  isShown,
  loadedConsumableIds,
  matchingUnlinked,
  reloadChoices,
  sortEquippedFirst,
  unlinkedConsumables
} from '../scripts/inventory.js';

const item = (id, equipped) => ({id, system: {equipped}});
const magazine = (id, currentCount, max, quantity, extra = {}) => ({
  id, name: `Magazine ${id}`, system: {currentCount, max, quantity, isAttachment: false, ...extra}
});
const weapon = (consumableData, loaded = "", ammo = 0) => ({
  id: "w", name: "Gun", system: {consumableData, useConsumableForAttack: loaded, ammo}
});

describe('carried items', () => {
  test('come first, and the order within each part is kept', () => {
    const items = [item('a', 'backpack'), item('b', 'equipped'), item('c', 'ship'), item('d', 'equipped')];
    expect(sortEquippedFirst(items).map(entry => entry.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(items.map(entry => entry.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortEquippedFirst(undefined)).toEqual([]);
  });

  test('the "not equipped" line goes before the first shown item that is not carried', () => {
    const items = sortEquippedFirst([item('a', 'ship'), item('b', 'equipped'), item('c', 'backpack')]);
    expect(firstNotEquippedId(items, false)).toBe('a');
    // The eye button hides ship, vehicle and base, so the line moves to the next shown item
    expect(firstNotEquippedId(items, true)).toBe('c');
  });

  test('no line when nothing, or everything, is carried', () => {
    expect(firstNotEquippedId([item('a', 'backpack'), item('b', 'ship')], false)).toBeNull();
    expect(firstNotEquippedId([item('a', 'equipped')], false)).toBeNull();
    expect(firstNotEquippedId([item('a', 'equipped'), item('b', 'base')], true)).toBeNull();
  });

  test('isShown follows the system helper', () => {
    expect(isShown(item('a', 'vehicle'), true)).toBe(false);
    expect(isShown(item('a', 'vehicle'), false)).toBe(true);
    expect(isShown(item('a', 'backpack'), true)).toBe(true);
  });
});

describe('ammoState', () => {
  test('empty, low at a quarter or less, otherwise ok', () => {
    expect(ammoState(0, 80)).toBe('empty');
    expect(ammoState(20, 80)).toBe('low');
    expect(ammoState(21, 80)).toBe('ok');
    expect(ammoState(1, 6)).toBe('low');
    expect(ammoState(2, 6)).toBe('ok');
    expect(ammoState(1, 1)).toBe('ok');
    expect(ammoState(5, 0)).toBe('ok');
  });
});

describe('describeWeaponAmmo', () => {
  test('nothing for a weapon that uses no ammunition', () => {
    expect(describeWeaponAmmo(weapon([]))).toBeNull();
  });

  test('a weapon with an ammo value but no magazine is unloaded and has nothing to load', () => {
    expect(describeWeaponAmmo(weapon([], "", 15))).toMatchObject({state: 'unloaded', magazines: 0, canReload: false});
  });

  test('the loaded magazine, how full it is and what is in reserve', () => {
    const info = describeWeaponAmmo(weapon([magazine('m1', 75, 80, 3)], 'm1', 80));
    expect(info).toMatchObject({
      loaded: {id: 'm1', name: 'Magazine m1'}, current: 75, max: 80, percent: 94, state: 'ok', full: false,
      reserve: 2, partial: 0, canReload: true, multiple: false
    });
  });

  test('a magazine that is chosen but no longer fits counts as unloaded', () => {
    expect(describeWeaponAmmo(weapon([magazine('m1', 5, 6, 1)], 'gone', 6))).toMatchObject({state: 'unloaded', magazines: 1});
  });

  test('attachments are not magazines', () => {
    const info = describeWeaponAmmo(weapon([magazine('scope', 1, 1, 1, {isAttachment: true})], '', 0));
    expect(info).toBeNull();
  });
});

describe('reloadChoices', () => {
  test('a full one from the loaded stack when it is not full', () => {
    expect(reloadChoices(weapon([magazine('m1', 3, 6, 2)], 'm1'))).toEqual([
      {kind: 'refill', id: 'm1', name: 'Magazine m1', current: 6, max: 6, quantity: 1}
    ]);
    expect(reloadChoices(weapon([magazine('m1', 6, 6, 2)], 'm1'))).toEqual([]);
    expect(reloadChoices(weapon([magazine('m1', 0, 6, 1)], 'm1'))).toEqual([]);
  });

  test('other magazines that have something in them', () => {
    const choices = reloadChoices(weapon([magazine('m1', 1, 6, 2), magazine('m2', 4, 6, 1), magazine('m3', 0, 6, 1)], 'm1'));
    expect(choices.map(choice => [choice.kind, choice.id])).toEqual([['refill', 'm1'], ['select', 'm2']]);
  });

  test('an empty stack of more than one can be loaded (it is refilled)', () => {
    const choices = reloadChoices(weapon([magazine('m1', 0, 6, 2)], ''));
    expect(choices).toEqual([{kind: 'select', id: 'm1', name: 'Magazine m1', current: 0, max: 6, quantity: 2}]);
  });
});

describe('loadedConsumableIds', () => {
  test('only the magazines loaded in a weapon', () => {
    const weapons = [weapon([magazine('m1', 1, 6, 1), magazine('m2', 1, 6, 1)], 'm1'), weapon([magazine('m3', 1, 6, 1)])];
    expect([...loadedConsumableIds(weapons)]).toEqual(['m1']);
  });
});

describe('fireModeKey', () => {
  test('attack type and rate of fire, with the system defaults', () => {
    expect(fireModeKey('auto-full', '3')).toBe('auto-full:3');
    expect(fireModeKey('', undefined)).toBe('single:1');
  });
});

describe('fire modes and Auto', () => {
  const gun = (rateOfFire, extra = {}) => ({system: {rateOfFire, ...extra}});

  test('fireRules reads the sheet settings', () => {
    expect(fireRules({useCELAutofireRules: true, ShowDoubleTap: true})).toMatchObject({cel: true, showDoubleTap: true, ce: false});
    expect(fireRules()).toMatchObject({ce: false, cel: false, ct: false, cu: false, rider: false});
  });

  test('hasFireModes follows the system template for each rule set', () => {
    expect(hasFireModes(gun('1-3'), fireRules({useCEAutofireRules: true}))).toBe(true);
    expect(hasFireModes(gun('1'), fireRules({useCEAutofireRules: true}))).toBe(false);
    expect(hasFireModes(gun('3'), fireRules({useCELAutofireRules: true}))).toBe(true);
    expect(hasFireModes(gun('1', {doubleTap: true}), fireRules({useCELAutofireRules: true, ShowDoubleTap: true}))).toBe(true);
    expect(hasFireModes(gun('1/4'), fireRules({useCTAutofireRules: true}))).toBe(true);
    expect(hasFireModes(gun('4'), fireRules({useCUAutofireRules: true}))).toBe(true);
    expect(hasFireModes(gun('1', {isSingleAction: true}), fireRules({useRIDERFireRules: true}))).toBe(true);
    expect(hasFireModes(gun('3'), fireRules({}))).toBe(false);
  });

  test('autoRate for CEL and CU', () => {
    expect(autoRate(gun('3'), fireRules({useCELAutofireRules: true}))).toBe(3);
    expect(autoRate(gun('3', {doubleTap: true}), fireRules({useCELAutofireRules: true, ShowDoubleTap: true}))).toBeNull();
    expect(autoRate(gun('4'), fireRules({useCUAutofireRules: true}))).toBe(4);
    expect(autoRate(gun('1'), fireRules({useCELAutofireRules: true}))).toBeNull();
    expect(autoRate(gun('1-3'), fireRules({useCEAutofireRules: true}))).toBeNull();
  });
});

describe('equipStateForDrop', () => {
  test('carried rows carry, other rows put it in the backpack, otherwise nothing', () => {
    expect(equipStateForDrop({itemEquipped: false, targetEquipped: true})).toBe('equipped');
    expect(equipStateForDrop({itemEquipped: true, targetEquipped: false})).toBe('backpack');
    expect(equipStateForDrop({itemEquipped: true, targetEquipped: true})).toBeNull();
    expect(equipStateForDrop({itemEquipped: false, targetEquipped: false})).toBeNull();
  });
});

describe('part-used magazines the system put aside', () => {
  const aside = (id, current, extra = {}) => ({
    id, name: 'Magazine m1', type: 'consumable', system: {currentCount: current, max: 6, quantity: 1, subtype: 'magazine', ...extra}
  });
  const loadedStack = () => magazine('m1', 5, 6, 1, {subtype: 'magazine'});

  test('match by name, subtype and size', () => {
    const linked = [loadedStack()];
    expect(matchingUnlinked(linked, [aside('p1', 1), aside('p2', 1, {max: 30}), aside('p3', 1, {subtype: 'cell'})])
      .map(item => item.id)).toEqual(['p1']);
  });

  test('count in the reserve and can be loaded (and linked)', () => {
    const gun = weapon([loadedStack()], 'm1', 6);
    const info = describeWeaponAmmo(gun, [aside('p1', 1)]);
    expect(info).toMatchObject({reserve: 1, partial: 1, magazines: 2, canReload: true});
    expect(reloadChoices(gun, [aside('p1', 1)])).toEqual([
      {kind: 'select', id: 'p1', name: 'Magazine m1', current: 1, max: 6, quantity: 1, link: true}
    ]);
  });

  test('a full one put aside counts as reserve but not as part-used', () => {
    expect(describeWeaponAmmo(weapon([loadedStack()], 'm1', 6), [aside('p1', 6)])).toMatchObject({reserve: 1, partial: 0});
  });

  test('unlinkedConsumables leaves out what any item links to', () => {
    const items = [
      {id: 'w', type: 'weapon', system: {consumables: ['m1']}},
      {id: 'm1', type: 'consumable', system: {}},
      {id: 'p1', type: 'consumable', system: {}}
    ];
    expect(unlinkedConsumables(items).map(item => item.id)).toEqual(['p1']);
  });
});
