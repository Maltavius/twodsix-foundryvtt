import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ammoText,
  applyReload,
  inventoryActions,
  lastFireMode,
  prepareInventoryContext,
  reloadChoiceLabel
} from '../scripts/inventoryTab.js';

const magazine = (id, currentCount, max, quantity, equipped = 'equipped') => ({
  id, name: `Mag ${id}`, system: {currentCount, max, quantity, equipped, isAttachment: false},
  update: vi.fn(async () => {}), refill: vi.fn(async () => {})
});
const weapon = (id, equipped, consumableData, loaded = '', ammo = 0) => ({
  id, name: `Gun ${id}`, system: {equipped, consumableData, useConsumableForAttack: loaded, ammo},
  update: vi.fn(async () => {})
});

let settingValue;
beforeEach(() => {
  settingValue = true;
  globalThis.game = {
    settings: {get: vi.fn(() => settingValue)},
    i18n: {localize: key => key, format: (key, data) => `${key}:${Object.values(data).join(',')}`}
  };
  globalThis.ui = {notifications: {warn: vi.fn()}};
  globalThis.foundry = {utils: {escapeHTML: text => text}, applications: {api: {DialogV2: {wait: vi.fn()}}}};
});
afterEach(() => {
  delete globalThis.game;
  delete globalThis.ui;
  delete globalThis.foundry;
});

describe('prepareInventoryContext', () => {
  function makeContext() {
    const m1 = magazine('m1', 75, 80, 3);
    const m2 = magazine('m2', 4, 6, 1, 'backpack');
    const itemTypes = {
      weapon: [weapon('w1', 'backpack', [m2], '', 6), weapon('w2', 'equipped', [m1], 'm1', 80), weapon('w3', 'equipped', [])],
      armor: [{id: 'a1', system: {equipped: 'ship'}}, {id: 'a2', system: {equipped: 'equipped'}}],
      consumable: [m1, m2]
    };
    return {itemTypes, context: {container: itemTypes, system: {hideStoredItems: {}}}};
  }

  test('does nothing when the player has turned it off', () => {
    settingValue = false;
    const {context} = makeContext();
    prepareInventoryContext({}, context);
    expect(context.inventory).toBeUndefined();
  });

  test('sorts carried items first in a copy, so the actor\'s own lists are left alone', () => {
    const {itemTypes, context} = makeContext();
    prepareInventoryContext({}, context);
    expect(context.container).not.toBe(itemTypes);
    expect(context.container.weapon.map(item => item.id)).toEqual(['w2', 'w3', 'w1']);
    expect(itemTypes.weapon.map(item => item.id)).toEqual(['w1', 'w2', 'w3']);
    expect(context.inventory.groupStart).toMatchObject({w1: true, a1: true});
  });

  test('describes the ammunition of weapons that use it', () => {
    const {context} = makeContext();
    prepareInventoryContext({}, context);
    expect(Object.keys(context.inventory.ammo).sort()).toEqual(['w1', 'w2']);
    expect(context.inventory.ammo.w2).toMatchObject({current: 75, max: 80, text: 'TWODSIX_LEDGER.INVENTORY.RESERVE:2'});
    expect(context.inventory.ammo.w1).toMatchObject({state: 'unloaded', text: 'TWODSIX_LEDGER.INVENTORY.MAGAZINES_ONE:1'});
  });

  test('leaves loaded magazines out of the Consumables list unless the sheet shows them', () => {
    const {context} = makeContext();
    prepareInventoryContext({}, context);
    expect(context.inventory.loadedHidden).toEqual({m1: true});
    expect(context.inventory.loadedCount).toBe(1);
    expect(context.inventory.loadedNote).toBe('TWODSIX_LEDGER.INVENTORY.LOADED_HIDDEN_ONE:1');

    const sheet = {render: vi.fn()};
    inventoryActions.inventoryToggleLoaded.call(sheet);
    expect(sheet.render).toHaveBeenCalled();
    const shown = makeContext().context;
    prepareInventoryContext(sheet, shown);
    expect(shown.inventory.loadedHidden).toEqual({});
    expect(shown.inventory.showLoaded).toBe(true);
  });
});

describe('texts', () => {
  test('ammoText names reserve and other magazines', () => {
    expect(ammoText({loaded: {}, reserve: 1, others: 2})).toBe('TWODSIX_LEDGER.INVENTORY.RESERVE:1 · TWODSIX_LEDGER.INVENTORY.OTHERS_MANY:2');
    expect(ammoText({loaded: null, magazines: 0})).toBe('TWODSIX_LEDGER.INVENTORY.NO_MAGAZINE');
    expect(ammoText({loaded: null, magazines: 3})).toBe('TWODSIX_LEDGER.INVENTORY.MAGAZINES_MANY:3');
  });

  test('reloadChoiceLabel', () => {
    expect(reloadChoiceLabel({kind: 'refill', quantity: 2})).toBe('TWODSIX_LEDGER.INVENTORY.CHOICE_REFILL:2');
    expect(reloadChoiceLabel({kind: 'select', name: 'Mag', current: 4, max: 6, quantity: 1})).toBe('Mag (4/6)');
    expect(reloadChoiceLabel({kind: 'select', name: 'Mag', current: 6, max: 6, quantity: 3})).toBe('Mag (6/6) ×3');
  });
});

describe('applyReload', () => {
  test('refill uses the system\'s Reload', async () => {
    const m1 = magazine('m1', 1, 6, 2);
    const gun = weapon('w', 'equipped', [m1], 'm1');
    await applyReload({items: new Map([['m1', m1]])}, gun, {kind: 'refill', id: 'm1'});
    expect(m1.refill).toHaveBeenCalled();
    expect(gun.update).not.toHaveBeenCalled();
  });

  test('select loads the other magazine, and refills it when it is an empty stack', async () => {
    const m2 = magazine('m2', 0, 6, 2);
    const gun = weapon('w', 'equipped', [m2]);
    await applyReload({items: new Map([['m2', m2]])}, gun, {kind: 'select', id: 'm2'});
    expect(gun.update).toHaveBeenCalledWith({'system.useConsumableForAttack': 'm2'});
    expect(m2.refill).toHaveBeenCalled();

    const m3 = magazine('m3', 4, 6, 1);
    await applyReload({items: new Map([['m3', m3]])}, gun, {kind: 'select', id: 'm3'});
    expect(m3.refill).not.toHaveBeenCalled();
  });

  test('warns instead of failing when the stack ran out', async () => {
    const m1 = magazine('m1', 1, 6, 2);
    m1.refill.mockRejectedValue({name: 'TooLowQuantityError'});
    await applyReload({items: new Map([['m1', m1]])}, weapon('w', 'equipped', [m1], 'm1'), {kind: 'refill', id: 'm1'});
    expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
  });
});

/** A button inside a weapon row, enough for closest() and dataset. */
function makeButton(itemId, dataset) {
  const row = {dataset: {itemId}};
  const classes = new Set();
  return {
    dataset,
    closest: selector => (selector === '.item' ? row : null),
    classList: {toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: name => classes.has(name)}
  };
}

describe('inventoryFireMode', () => {
  test('remembers the mode, marks it and attacks with the system\'s handler', async () => {
    const gun = weapon('w1', 'equipped', []);
    const burst = makeButton('w1', {attackType: 'auto-burst', rof: '3'});
    const full = makeButton('w1', {attackType: 'auto-full', rof: '3'});
    const performAttack = vi.fn();
    const sheet = {
      actor: {id: 'a1', items: new Map([['w1', gun]])},
      element: {querySelectorAll: () => [burst, full]},
      options: {actions: {performAttack}}
    };
    const event = {};
    await inventoryActions.inventoryFireMode.call(sheet, event, burst);
    expect(lastFireMode('a1', 'w1')).toBe('auto-burst:3');
    expect(burst.classList.contains('is-active')).toBe(true);
    expect(full.classList.contains('is-active')).toBe(false);
    expect(performAttack).toHaveBeenCalledWith(event, burst);

    await inventoryActions.inventoryFireMode.call(sheet, event, full);
    expect(burst.classList.contains('is-active')).toBe(false);
    expect(full.classList.contains('is-active')).toBe(true);
  });
});

describe('inventoryReload', () => {
  function makeSheet(gun, items) {
    return {actor: {isOwner: true, items: new Map([[gun.id, gun], ...items.map(item => [item.id, item])])}};
  }

  test('reloads straight away when there is one way to do it', async () => {
    const m1 = magazine('m1', 1, 6, 2);
    const gun = weapon('w1', 'equipped', [m1], 'm1');
    await inventoryActions.inventoryReload.call(makeSheet(gun, [m1]), {}, makeButton('w1', {}));
    expect(globalThis.foundry.applications.api.DialogV2.wait).not.toHaveBeenCalled();
    expect(m1.refill).toHaveBeenCalled();
  });

  test('asks which magazine when there are more ways', async () => {
    const m1 = magazine('m1', 1, 6, 2);
    const m2 = magazine('m2', 4, 6, 1);
    const gun = weapon('w1', 'equipped', [m1, m2], 'm1');
    globalThis.foundry.applications.api.DialogV2.wait.mockResolvedValue('1');
    await inventoryActions.inventoryReload.call(makeSheet(gun, [m1, m2]), {}, makeButton('w1', {}));
    const options = globalThis.foundry.applications.api.DialogV2.wait.mock.calls[0][0];
    expect(options.buttons.map(button => button.label)).toEqual(['TWODSIX_LEDGER.INVENTORY.CHOICE_REFILL:1', 'Mag m2 (4/6)']);
    expect(gun.update).toHaveBeenCalledWith({'system.useConsumableForAttack': 'm2'});
    expect(m1.refill).not.toHaveBeenCalled();
  });

  test('does nothing when the dialog is closed', async () => {
    const m1 = magazine('m1', 1, 6, 2);
    const m2 = magazine('m2', 4, 6, 1);
    const gun = weapon('w1', 'equipped', [m1, m2], 'm1');
    globalThis.foundry.applications.api.DialogV2.wait.mockResolvedValue(null);
    await inventoryActions.inventoryReload.call(makeSheet(gun, [m1, m2]), {}, makeButton('w1', {}));
    expect(gun.update).not.toHaveBeenCalled();
    expect(m1.refill).not.toHaveBeenCalled();
  });

  test('only the owner can reload', async () => {
    const m1 = magazine('m1', 1, 6, 2);
    const gun = weapon('w1', 'equipped', [m1], 'm1');
    const sheet = makeSheet(gun, [m1]);
    sheet.actor.isOwner = false;
    await inventoryActions.inventoryReload.call(sheet, {}, makeButton('w1', {}));
    expect(m1.refill).not.toHaveBeenCalled();
  });
});
