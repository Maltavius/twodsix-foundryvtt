/**
 * The button in the module settings that cleans up finance texts which the system has damaged (see formatFinanceText).
 * It lists what it would change, and writes only after the GM has confirmed. Only the text is changed, never the number.
 */

import { getFinanceTextTidyUps, parseLocaleNumber } from "./financeText.js";

const PREFIX = "TWODSIX_LEDGER";
const t = (key, data) => (data ? game.i18n.format(`${PREFIX}.${key}`, data) : game.i18n.localize(`${PREFIX}.${key}`));
const escape = text => Handlebars.Utils.escapeExpression(text);

/** @returns {Array<{actor: object, changes: Record<string, {from: string, to: string}>}>} characters with damaged texts */
function findTidyUps() {
  const found = [];
  for (const actor of game.actors.filter(candidate => candidate.type === "traveller")) {
    const source = actor.system._source;
    const changes = getFinanceTextTidyUps(source.finances, source.financeValues, game.i18n.lang, parseLocaleNumber);
    if (Object.keys(changes).length) {
      found.push({actor, changes});
    }
  }
  return found;
}

/** Looks like a settings window to Foundry, which calls `new Menu().render(true)`, but is only a confirm dialog. */
export class TidyFinanceMenu {
  async render() {
    const found = findTidyUps();
    if (!found.length) {
      ui.notifications.info(t("TIDY_NONE"));
      return this;
    }
    const rows = found.map(({actor, changes}) => {
      const lines = Object.entries(changes)
        .map(([field, {from, to}]) => `<li><code>${escape(field)}</code>: <code>${escape(from)}</code> → <code>${escape(to)}</code></li>`)
        .join("");
      return `<p><strong>${escape(actor.name)}</strong></p><ul>${lines}</ul>`;
    });
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: {title: t("TIDY_TITLE")},
      content: `<p>${t("TIDY_INTRO")}</p>${rows.join("")}`,
      yes: {label: t("TIDY_APPLY", {count: found.length})}
    });
    if (!ok) {
      return this;
    }
    for (const {actor, changes} of found) {
      const texts = Object.fromEntries(Object.entries(changes).map(([field, {to}]) => [field, to]));
      await actor.update({"system.finances": texts}, {twodsixLedger: true});
    }
    ui.notifications.info(t("TIDY_DONE", {count: found.length}));
    return this;
  }
}
