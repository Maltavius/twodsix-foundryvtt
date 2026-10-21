/**
 * finance-i18n.test.js
 * Foundry shows the raw key (e.g. "TWODSIX.Actor.Finances.ADD_INCOME") when a translation is missing.
 * This test fails if a finance key used in the finance code or templates is not in en.json, and checks the keys that
 * are built dynamically from account and category names.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LEDGER_ACCOUNTS,
  LEDGER_CATEGORIES,
  SYSTEM_CATEGORIES
} from '../../src/module/features/finances/ledger.js';
import enJson from '../../static/lang/en.json' with { type: 'json' };

const PREFIX = 'TWODSIX.Actor.Finances';
const finances = enJson?.TWODSIX?.Actor?.Finances;

/** Source files that may reference finance translation keys. */
function financeSourceFiles() {
  const root = new URL('../../', import.meta.url);
  const dir = new URL('src/module/features/finances/', root);
  const files = readdirSync(dir).filter(name => name.endsWith('.js')).map(name => new URL(name, dir));
  files.push(new URL('src/module/sheets/TwodsixTravellerSheet.js', root));
  files.push(new URL('static/templates/actors/parts/actor/actor-finances.hbs', root));
  return files;
}

/** @param {string} path - dotted path below TWODSIX.Actor.Finances */
function resolve(path) {
  return path.split('.').reduce((node, part) => node?.[part], finances);
}

describe('finance translations in en.json', () => {
  it('has a Finances block', () => {
    expect(finances, `${PREFIX} is missing from en.json`).toBeTypeOf('object');
  });

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
    walk(finances, PREFIX);
    expect(empty).toEqual([]);
  });

  it('contains every key referenced literally in finance code and templates', () => {
    const missing = [];
    const pattern = new RegExp(`${PREFIX.replaceAll('.', '\\.')}\\.([A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*)`, 'g');
    for (const file of financeSourceFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
        if (resolve(match[1]) === undefined) {
          missing.push(`${PREFIX}.${match[1]} (in ${file.pathname.split('/').slice(-2).join('/')})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.each([...LEDGER_CATEGORIES, ...SYSTEM_CATEGORIES])('has a label for category "%s"', category => {
    expect(resolve(`CATEGORIES.${category}`), `${PREFIX}.CATEGORIES.${category}`).toBeTypeOf('string');
  });

  it.each(LEDGER_ACCOUNTS)('has a label for account "%s"', account => {
    expect(resolve(account.toUpperCase()), `${PREFIX}.${account.toUpperCase()}`).toBeTypeOf('string');
  });
});
