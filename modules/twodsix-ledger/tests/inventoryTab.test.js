import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ammoText,
  applyReload,
  handleEquipDrop,
  inventoryActions,
  bindInventoryTab,
  forgetOpenedWeapons,
  layoutSections,
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
let expandValue;
beforeEach(() => {
  settingValue = true;
  expandValue = true;
  globalThis.game = {
    settings: {get: vi.fn((scope, key) => (key === 'inventoryExpandWeapons' ? expandValue : settingValue))},
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
    const rifle = weapon('w2', 'equipped', [m1], 'm1', 80);
    rifle.system.rateOfFire = '3';
    const itemTypes = {
      weapon: [weapon('w1', 'backpack', [m2], '', 6), rifle, weapon('w3', 'equipped', [])],
      armor: [
        {id: 'a1', system: {equipped: 'ship', secondaryArmor: {value: 0, protectionTypes: []}}},
        {id: 'a2', system: {equipped: 'equipped', secondaryArmor: {value: 2, protectionTypes: ['laser', 'plasma']}}}
      ],
      consumable: [m1, m2]
    };
    const settings = {useCELAutofireRules: true, damageTypes: {laser: 'Laser', plasma: 'Plasma'}};
    return {itemTypes, context: {container: itemTypes, system: {hideStoredItems: {}}, settings}};
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

  test('describes the ammunition and status of every weapon', () => {
    const {context} = makeContext();
    prepareInventoryContext({actor: {id: 'actor'}}, context);
    const {weapons} = context.inventory;
    expect(weapons.w2.ammo).toMatchObject({current: 75, max: 80, text: 'TWODSIX_LEDGER.INVENTORY.RESERVE:2'});
    expect(weapons.w2).toMatchObject({auto: 3, hasDetails: true, open: true});
    expect(weapons.w1.ammo).toMatchObject({state: 'unloaded', text: 'TWODSIX_LEDGER.INVENTORY.MAGAZINES_ONE:1'});
    expect(weapons.w3).toMatchObject({ammo: null, auto: null, hasDetails: false, open: false});
  });

  test('without Automatically expand weapons the rows start closed, and a weapon can be opened by hand', () => {
    expandValue = false;
    const sheet = {actor: {id: 'compact-actor', items: new Map()}, render: vi.fn()};
    const {context} = makeContext();
    prepareInventoryContext(sheet, context);
    expect(context.inventory.weapons.w2.open).toBe(false);

    sheet.actor.items.set('w2', context.container.weapon[0]);
    inventoryActions.inventoryToggleDetails.call(sheet, {stopPropagation: vi.fn()}, makeButton('w2', {}));
    expect(sheet.render).toHaveBeenCalled();
    const again = makeContext().context;
    prepareInventoryContext(sheet, again);
    expect(again.inventory.weapons.w2.open).toBe(true);
    expect(again.inventory.weapons.w1.open).toBe(false);

    // Changing the setting makes every weapon follow it again
    forgetOpenedWeapons();
    const reset = makeContext().context;
    prepareInventoryContext(sheet, reset);
    expect(reset.inventory.weapons.w2.open).toBe(false);
  });

  test('the weapon in brackets after a magazine only when its name does not say it', () => {
    const {context} = makeContext();
    context.container.consumable[0].system.parentName = 'Gun w2';
    context.container.consumable[0].name = 'Magazine: Gun w2';
    context.container.consumable[1].system.parentName = 'Gun w1';
    prepareInventoryContext({}, context);
    expect(context.inventory.parentSuffix).toEqual({m2: 'Gun w1'});
  });

  test('what a stack holds, and a tooltip on the Qty of magazines', () => {
    const {context} = makeContext();
    context.container.consumable[0].system.subtype = 'magazine';
    prepareInventoryContext({}, context);
    expect(context.inventory.stacks.m1).toEqual({
      extra: 'TWODSIX_LEDGER.INVENTORY.STACK_FULL_MANY:2',
      countTooltip: 'TWODSIX_LEDGER.INVENTORY.STACK_TOOLTIP:75,80,2',
      qtyTooltip: 'TWODSIX_LEDGER.INVENTORY.QTY_TOOLTIP'
    });
    expect(context.inventory.stacks.m2).toEqual({extra: '', countTooltip: '', qtyTooltip: ''});
  });

  test('secondary armour protection with its types', () => {
    const {context} = makeContext();
    prepareInventoryContext({}, context);
    expect(context.inventory.armor).toEqual({
      a2: {secondary: 2, tooltip: 'TWODSIX_LEDGER.INVENTORY.SECONDARY_TYPES:Laser, Plasma'}
    });
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
    expect(ammoText({loaded: {}, reserve: 2, partial: 0})).toBe('TWODSIX_LEDGER.INVENTORY.RESERVE:2');
    expect(ammoText({loaded: {}, reserve: 2, partial: 1})).toBe('TWODSIX_LEDGER.INVENTORY.RESERVE_PARTIAL_ONE:2,1');
    expect(ammoText({loaded: {}, reserve: 3, partial: 2})).toBe('TWODSIX_LEDGER.INVENTORY.RESERVE_PARTIAL_MANY:3,2');
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
    gun.addConsumable = vi.fn(async () => {});
    await applyReload({items: new Map([['m1', m1]])}, gun, {kind: 'refill', id: 'm1'});
    expect(m1.refill).toHaveBeenCalled();
    expect(gun.update).not.toHaveBeenCalled();
  });

  test('the part-used magazine the system puts aside is linked to the weapon', async () => {
    const m1 = magazine('m1', 1, 6, 2);
    const gun = weapon('w', 'equipped', [m1], 'm1');
    gun.addConsumable = vi.fn(async () => {});
    const items = new Map([['m1', m1]]);
    m1.refill.mockImplementation(async () => {
      items.set('p1', {id: 'p1', type: 'consumable'});
    });
    await applyReload({items}, gun, {kind: 'refill', id: 'm1'});
    expect(gun.addConsumable).toHaveBeenCalledWith('p1');
  });

  test('a magazine that is not linked yet is linked when it is loaded', async () => {
    const p1 = magazine('p1', 1, 6, 1);
    const gun = weapon('w', 'equipped', []);
    gun.addConsumable = vi.fn(async () => {});
    await applyReload({items: new Map([['p1', p1]])}, gun, {kind: 'select', id: 'p1', link: true});
    expect(gun.addConsumable).toHaveBeenCalledWith('p1');
    expect(gun.update).toHaveBeenCalledWith({'system.useConsumableForAttack': 'p1'});
  });

  test('select loads the other magazine, and refills it when it is an empty stack', async () => {
    const m2 = magazine('m2', 0, 6, 2);
    const gun = weapon('w', 'equipped', [m2]);
    gun.addConsumable = vi.fn(async () => {});
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

describe('handleEquipDrop', () => {
  /** A row in a list; the list knows which item ids it holds. */
  function makeDom(rows) {
    const list = {querySelector: selector => (rows.some(row => selector.includes(`"${row.id}"`)) ? {} : null)};
    return Object.fromEntries(rows.map(row => [row.id, {
      dataset: {itemId: row.id},
      classList: {contains: name => name === 'tl-equipped' && row.equipped},
      closest: selector => (selector === '.item-list' ? list : null)
    }]));
  }
  const dropOn = target => ({target: {closest: () => target}});

  function makeActor(items) {
    return {items: new Map(items.map(item => [item.id, item])), updateEmbeddedDocuments: vi.fn(async () => {})};
  }

  test('dropped on a carried row: carried, with its magazines', async () => {
    const m1 = magazine('m1', 1, 6, 1, 'backpack');
    const gun = weapon('w1', 'backpack', [m1]);
    gun.system.consumables = ['m1'];
    const actor = makeActor([gun, m1]);
    const rows = makeDom([{id: 'w1', equipped: false}, {id: 'w2', equipped: true}]);
    expect(await handleEquipDrop({actor}, dropOn(rows.w2), {id: 'w1'})).toBe(true);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith('Item', [
      {_id: 'w1', 'system.equipped': 'equipped'},
      {_id: 'm1', 'system.equipped': 'equipped'}
    ]);
  });

  test('dropped on a row that is not carried: to the backpack', async () => {
    const gun = weapon('w1', 'equipped', []);
    const actor = makeActor([gun]);
    const rows = makeDom([{id: 'w1', equipped: true}, {id: 'w3', equipped: false}]);
    expect(await handleEquipDrop({actor}, dropOn(rows.w3), {id: 'w1'})).toBe(true);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith('Item', [{_id: 'w1', 'system.equipped': 'backpack'}]);
  });

  test('nothing when it already is there, on itself, in another list, or with the tab off', async () => {
    const gun = weapon('w1', 'equipped', []);
    const actor = makeActor([gun]);
    const rows = makeDom([{id: 'w1', equipped: true}, {id: 'w2', equipped: true}]);
    expect(await handleEquipDrop({actor}, dropOn(rows.w2), {id: 'w1'})).toBe(false);
    expect(await handleEquipDrop({actor}, dropOn(rows.w1), {id: 'w1'})).toBe(false);
    const armour = makeDom([{id: 'a1', equipped: false}]);
    expect(await handleEquipDrop({actor}, dropOn(armour.a1), {id: 'w1'})).toBe(false);
    settingValue = false;
    const others = makeDom([{id: 'w1', equipped: true}, {id: 'w3', equipped: false}]);
    expect(await handleEquipDrop({actor}, dropOn(others.w3), {id: 'w1'})).toBe(false);
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  test('dropped on the list heading or column headings: carried', async () => {
    const gun = weapon('w1', 'backpack', []);
    const actor = makeActor([gun]);
    const list = {querySelector: selector => (selector.includes('"w1"') ? {} : null)};
    const heading = name => ({
      dataset: {},
      classList: {contains: cls => cls === name},
      parentElement: {querySelector: selector => (selector === ':scope > .item-list' ? list : null)},
      closest: () => null
    });
    expect(await handleEquipDrop({actor}, dropOn(heading('gear-header')), {id: 'w1'})).toBe(true);
    expect(await handleEquipDrop({actor}, dropOn(heading('item-title')), {id: 'w1'})).toBe(true);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith('Item', [{_id: 'w1', 'system.equipped': 'equipped'}]);
  });

  test('items from elsewhere are left to the system', async () => {
    const actor = makeActor([]);
    const rows = makeDom([{id: 'w2', equipped: true}]);
    expect(await handleEquipDrop({actor}, dropOn(rows.w2), {id: 'other'})).toBe(false);
  });
});

describe('layoutSections', () => {
  function section(empty, name, {hasTl = true} = {}) {
    const props = {};
    const classes = new Set();
    return {
      props,
      classes,
      name,
      querySelector: selector => (selector === '.item-list .item' ? (empty ? null : {}) : (hasTl ? {} : null)),
      classList: {add: name => classes.add(name), remove: name => classes.delete(name)},
      style: {
        setProperty: (key, value) => {
          props[key] = value;
        },
        removeProperty: key => {
          delete props[key];
        }
      }
    };
  }

  /** Name column: the matched width, or the list's own, which grows by 60px without TL and Qty. */
  function installLayout() {
    globalThis.getComputedStyle = element => {
      const own = element.classes.has('tl-narrow') ? element.name + 60 : element.name;
      const name = element.props['--tl-name-match'] ?? (Number.isNaN(own) ? 'minmax(6em,' : `${own}px`);
      return {gridTemplateColumns: `25px ${name} 20px`, fontSize: '10px'};
    };
  }
  afterEach(() => {
    delete globalThis.getComputedStyle;
  });

  test('an empty list takes the name column of the list above, and passes it on', () => {
    installLayout();
    const weapons = section(false, 180);
    const armour = section(true, 120);
    const augments = section(true, 120);
    const equipment = section(false, 150);
    layoutSections({querySelectorAll: () => [weapons, armour, augments, equipment]});
    expect(weapons.props).toEqual({});
    expect(armour.props).toEqual({'--tl-name-match': '180px', '--tl-icons-match': '1fr'});
    expect(augments.props).toEqual({'--tl-name-match': '180px', '--tl-icons-match': '1fr'});
    expect(equipment.props).toEqual({});
  });

  test('only a list whose name column is too narrow leaves out TL and Qty', () => {
    installLayout();
    const weapons = section(false, 120);
    const equipment = section(false, 70);
    const consumables = section(false, 50, {hasTl: false});
    layoutSections({querySelectorAll: () => [weapons, equipment, consumables]});
    expect(weapons.classes.has('tl-narrow')).toBe(false);
    expect(equipment.classes.has('tl-narrow')).toBe(true);
    // Nothing to leave out in Consumables (Qty stays there)
    expect(consumables.classes.has('tl-narrow')).toBe(false);
  });

  test('an empty list below a narrowed one gets the wider name column', () => {
    installLayout();
    const equipment = section(false, 70);
    const junk = section(true, 120);
    layoutSections({querySelectorAll: () => [equipment, junk]});
    expect(junk.props['--tl-name-match']).toBe('130px');
  });

  test('nothing is set while the tab is hidden', () => {
    installLayout();
    const weapons = section(false, Number.NaN);
    const armour = section(true, Number.NaN);
    layoutSections({querySelectorAll: () => [weapons, armour]});
    expect(armour.props).toEqual({});
    expect(weapons.classes.size).toBe(0);
  });
});

describe('portrait setting', () => {
  test('the sheet gets the class that keeps the portrait\'s aspect ratio only when the setting is on', () => {
    const toggle = vi.fn();
    const sheet = {element: {classList: {toggle}, querySelector: () => null}};
    expandValue = true;
    globalThis.game.settings.get = vi.fn((scope, key) => key === 'portraitKeepAspect');
    bindInventoryTab(sheet);
    expect(toggle).toHaveBeenCalledWith('twodsix-ledger-portrait-contain', true);
    globalThis.game.settings.get = vi.fn(() => false);
    bindInventoryTab(sheet);
    expect(toggle).toHaveBeenLastCalledWith('twodsix-ledger-portrait-contain', false);
  });
});
