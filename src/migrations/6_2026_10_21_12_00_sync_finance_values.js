import { getFinanceValueFixes } from '../module/features/finances/financeText.js';
import { parseLocaleNumber } from '../module/data/commonSchemaUtils.js';
import { applyToAllActors } from '../module/utils/migration-utils';

/**
 * Characters made by chargen only have the finance text filled in, not the number the sheet and the finance ledger
 * use. Fill in numbers that are 0 while their text says otherwise. Numbers that are already non-zero are never changed.
 */
export async function migrate() {
  console.log('[TWODSIX] Starting finance value sync...');
  await applyToAllActors(async actor => {
    if (actor.type !== 'traveller') {
      return;
    }
    const fixes = getFinanceValueFixes(actor.system._source.finances, actor.system._source.financeValues, parseLocaleNumber);
    if (Object.keys(fixes).length > 0) {
      await actor.update({'system.financeValues': fixes}, {twodsixLedger: true});
    }
  });
  console.log('[TWODSIX] Finance value sync complete');
  return Promise.resolve();
}
