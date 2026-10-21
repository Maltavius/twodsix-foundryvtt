import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ORIGINAL_PARTIAL,
  OWN_PARTIAL,
  SYSTEM_PARTIAL,
  createLedgerSheet,
  ensureFinancePartial,
  findSystemTravellerSheet
} from '../scripts/sheet.js';

/** A tiny stand-in for Handlebars: partials by name, and a compile that returns a function. */
function installHandlebars({systemPartial = () => 'system tab', preload = true} = {}) {
  const partials = preload ? {[SYSTEM_PARTIAL]: systemPartial, [OWN_PARTIAL]: () => 'ledger tab'} : {};
  globalThis.Handlebars = {
    partials,
    compile: vi.fn(source => Object.assign(() => 'wrapper', {source})),
    registerPartial: vi.fn((name, fn) => { partials[name] = fn; })
  };
  globalThis.foundry = {
    applications: {
      handlebars: {
        getTemplate: vi.fn(async path => {
          partials[path] ??= () => `loaded ${path}`;
          return partials[path];
        })
      }
    }
  };
}

beforeEach(() => installHandlebars());
afterEach(() => {
  delete globalThis.Handlebars;
  delete globalThis.foundry;
  delete globalThis.CONFIG;
});

describe('ensureFinancePartial', () => {
  test('puts a wrapper under the system path and keeps the system tab as the fallback', async () => {
    const original = globalThis.Handlebars.partials[SYSTEM_PARTIAL];
    await ensureFinancePartial();
    const hb = globalThis.Handlebars;
    expect(hb.partials[ORIGINAL_PARTIAL]).toBe(original);
    expect(hb.partials[SYSTEM_PARTIAL]).not.toBe(original);
    const source = hb.partials[SYSTEM_PARTIAL].source;
    expect(source).toContain('{{#if finance}}');
    expect(source).toContain(OWN_PARTIAL);
    expect(source).toContain(ORIGINAL_PARTIAL);
  });

  test('does the work once, and again only if the system registers its partial again', async () => {
    await ensureFinancePartial();
    const hb = globalThis.Handlebars;
    const calls = hb.registerPartial.mock.calls.length;
    await ensureFinancePartial();
    expect(hb.registerPartial.mock.calls.length).toBe(calls);

    const reRegistered = () => 'system tab again';
    hb.partials[SYSTEM_PARTIAL] = reRegistered;
    await ensureFinancePartial();
    expect(hb.partials[ORIGINAL_PARTIAL]).toBe(reRegistered);
    expect(hb.partials[SYSTEM_PARTIAL].source).toContain('{{#if finance}}');
  });

  test('loads the templates itself if they are not registered yet', async () => {
    installHandlebars({preload: false});
    await ensureFinancePartial();
    const loaded = globalThis.foundry.applications.handlebars.getTemplate.mock.calls.map(call => call[0]);
    expect(loaded).toEqual(expect.arrayContaining([SYSTEM_PARTIAL, OWN_PARTIAL]));
    expect(globalThis.Handlebars.partials[SYSTEM_PARTIAL].source).toContain('{{#if finance}}');
  });
});

describe('findSystemTravellerSheet', () => {
  test('finds the system class in the sheet registry', () => {
    class SystemSheet {}
    globalThis.CONFIG = {Actor: {sheetClasses: {traveller: {
      'core.ActorSheet': {id: 'core.ActorSheet', cls: class Other {}},
      'twodsix.TwodsixTravellerSheet': {id: 'twodsix.TwodsixTravellerSheet', cls: SystemSheet}
    }}}};
    expect(findSystemTravellerSheet()).toBe(SystemSheet);
  });

  test('returns null if the system sheet is not registered', () => {
    globalThis.CONFIG = {Actor: {sheetClasses: {}}};
    expect(findSystemTravellerSheet()).toBeNull();
  });
});

describe('createLedgerSheet', () => {
  function makeBase() {
    return class Base {
      static DEFAULT_OPTIONS = {classes: ['twodsix'], actions: {existing: () => {}}};
      static PARTS = {main: {template: 'systems/twodsix/templates/actors/traveller-sheet.hbs', scrollable: ['.skills']}};
      async _prepareContext() { return {editable: true, system: {financeValues: {}}}; }
      async _renderHTML() { return 'html'; }
      async _onRender() {}
    };
  }

  test('extends the system sheet and adds the ledger scroll area and actions without changing the base', () => {
    const Base = makeBase();
    const Ledger = createLedgerSheet(Base);
    expect(new Ledger()).toBeInstanceOf(Base);
    expect(Ledger.PARTS.main.template).toBe(Base.PARTS.main.template);
    expect(Ledger.PARTS.main.scrollable).toEqual(['.skills', '.fl-scroll']);
    expect(Base.PARTS.main.scrollable).toEqual(['.skills']);
    expect(Object.keys(Ledger.DEFAULT_OPTIONS.actions)).toEqual(expect.arrayContaining(['financeAdd', 'financeMove', 'financeUndo']));
    expect('financeAdd' in Base.DEFAULT_OPTIONS.actions).toBe(false);
  });

  test('installs the partial before rendering', async () => {
    const Ledger = createLedgerSheet(makeBase());
    const sheet = new Ledger();
    expect(await sheet._renderHTML({}, {})).toBe('html');
    expect(globalThis.Handlebars.partials[SYSTEM_PARTIAL].source).toContain('{{#if finance}}');
  });
});
