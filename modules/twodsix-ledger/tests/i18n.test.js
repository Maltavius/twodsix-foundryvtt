/**
 * Foundry shows the raw key when a translation is missing. This test fails if a key used in the module's scripts or
 * template is not in the module's lang file (TWODSIX_LEDGER.*) or, for the five labels the module borrows from the
 * system, in the system's lang file (TWODSIX.Actor.Finances.*).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEDGER_ACCOUNTS, LEDGER_CATEGORIES, SYSTEM_CATEGORIES } from '../scripts/ledger.js';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const moduleLang = readJson('../lang/en.json');
const swedishLang = readJson('../lang/sv.json');
const systemLang = readJson('../../../static/lang/en.json');

const moduleKeys = moduleLang.TWODSIX_LEDGER;
const systemKeys = systemLang.TWODSIX.Actor.Finances;
const root = new URL('../', import.meta.url);

function sourceFiles() {
  const scripts = new URL('scripts/', root);
  return [
    ...readdirSync(scripts).filter(name => name.endsWith('.js')).map(name => new URL(name, scripts)),
    new URL('templates/actor-finances.hbs', root),
    new URL('templates/settings.hbs', root)
  ];
}

const resolve = (tree, path) => path.split('.').reduce((node, part) => node?.[part], tree);

describe('module translations', () => {
  it('has no empty strings', () => {
    const empty = [];
    const walk = (node, path) => {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'object') {
          walk(value, `${path}.${key}`);
        } else if (typeof value !== 'string' || value.trim() === '') {
          empty.push(`${path}.${key}`);
        }
      }
    };
    walk(moduleKeys, 'TWODSIX_LEDGER');
    expect(empty).toEqual([]);
  });

  it('contains every key referenced literally in the module', () => {
    const missing = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/TWODSIX_LEDGER\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)/g)) {
        if (resolve(moduleKeys, match[1]) === undefined) {
          missing.push(`TWODSIX_LEDGER.${match[1]} (in ${file.pathname.split('/').pop()})`);
        }
      }
      for (const match of text.matchAll(/TWODSIX\.Actor\.Finances\.([A-Za-z0-9_]+)/g)) {
        if (resolve(systemKeys, match[1]) === undefined) {
          missing.push(`TWODSIX.Actor.Finances.${match[1]} (in ${file.pathname.split('/').pop()})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.each([...LEDGER_CATEGORIES, ...SYSTEM_CATEGORIES])('has a label for category "%s"', category => {
    expect(resolve(moduleKeys, `CATEGORIES.${category}`)).toBeTypeOf('string');
  });

  it.each(LEDGER_ACCOUNTS)('has a label for account "%s"', account => {
    expect(resolve(moduleKeys, account.toUpperCase())).toBeTypeOf('string');
  });

  it('has the labels the sheet and the store ask for', () => {
    for (const key of ['SHEET_NAME', 'MANUAL_ADJUSTMENT', 'UNDO_CONFIRM']) {
      expect(moduleKeys[key], key).toBeTypeOf('string');
    }
  });
});

describe('Swedish translation', () => {
  const flatten = (node, path = '') => Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'object' ? flatten(value, `${path}${key}.`) : [[`${path}${key}`, value]]);
  const english = new Map(flatten(moduleKeys));
  const swedish = new Map(flatten(swedishLang.TWODSIX_LEDGER));

  it('has exactly the same keys as English', () => {
    expect([...swedish.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it('keeps the placeholders ({count}, _ENTRY_) of every English string', () => {
    for (const [key, text] of english) {
      const placeholders = string => (string.match(/\{\w+\}|_[A-Z]+_/g) ?? []).sort();
      expect(placeholders(swedish.get(key)), key).toEqual(placeholders(text));
    }
  });
});

