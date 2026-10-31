import { describe, expect, test } from 'vitest';
import {
  ammoState,
  describeWeaponAmmo,
  fireModeKey,
  firstNotEquippedId,
  isShown,
  loadedConsumableIds,
  reloadChoices,
  sortEquippedFirst
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
      reserve: 2, others: 0, canReload: true, multiple: false
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
