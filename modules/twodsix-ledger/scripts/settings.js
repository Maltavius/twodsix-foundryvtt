/**
 * The module's settings: which accounts and categories the ledger has, and what they are called. One list for the whole
 * world, changed by the GM from Configure Settings > Module Settings.
 *
 * Cash is always the first account (it is the sheet's own field) and can only be renamed. There are at most four accounts.
 * The categories that come with the module can be renamed but not removed; the GM can add more.
 */

import { MODULE_ID } from "./store.js";
import {
  BUILTIN_CATEGORIES,
  LEDGER_ACCOUNTS,
  MAX_LEDGER_ACCOUNTS,
  accountLabel,
  configureLedger
} from "./ledger.js";

const SETTING = "config";
const PREFIX = "TWODSIX_LEDGER";
const t = key => game.i18n.localize(`${PREFIX}.${key}`);

/**
 * @returns {{accounts: Array<{key: string, name: string}>, categories: Array<{key: string, name: string}>}} what is saved
 */
export function getConfig() {
  try {
    return game.settings.get(MODULE_ID, SETTING) ?? {};
  } catch {
    return {};
  }
}

/** Make the ledger use the saved accounts and categories. */
export function applyConfig() {
  configureLedger(getConfig());
}

/** Redraw the open traveller sheets, so a change shows without closing them. */
function refreshSheets() {
  for (const app of foundry.applications.instances.values()) {
    if (app.rendered && app.actor?.type === "traveller") {
      app.render();
    }
  }
}

/**
 * Names that were typed in the settings, for the accounts and categories there are now.
 * @returns {{accounts: Array<{key: string, name: string}>, categories: Array<{key: string, name: string}>}}
 */
function draftFromSaved() {
  const saved = getConfig();
  const names = list => Object.fromEntries((Array.isArray(list) ? list : []).map(entry => [entry.key, entry.name ?? ""]));
  const accountNames = names(saved.accounts);
  const categoryNames = names(saved.categories);
  return {
    accounts: LEDGER_ACCOUNTS.map(key => ({key, name: accountNames[key] ?? ""})),
    categories: [
      ...BUILTIN_CATEGORIES.map(key => ({key, name: categoryNames[key] ?? ""})),
      ...(Array.isArray(saved.categories) ? saved.categories : [])
        .filter(entry => !BUILTIN_CATEGORIES.includes(entry.key))
        .map(entry => ({key: entry.key, name: entry.name ?? ""}))
    ]
  };
}

/**
 * Where an account is still in use, so that removing it would lose something.
 * @param {string} key
 * @returns {string|null} the name of the first traveller that uses it, or null
 */
function accountUsedBy(key) {
  for (const actor of game.actors.filter(candidate => candidate.type === "traveller")) {
    const balance = key === "digital" ? actor.getFlag(MODULE_ID, "digital") : actor.getFlag(MODULE_ID, "accounts")?.[key];
    const uses = list => (actor.getFlag(MODULE_ID, list) ?? []).some(entry => entry.account === key || entry.toAccount === key);
    if (Number(balance) || uses("transactions") || uses("recurring") || uses("loans")) {
      return actor.name;
    }
  }
  return null;
}

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/** The window where the GM sets up accounts and categories. */
class LedgerConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "twodsix-ledger-config",
    tag: "form",
    classes: ["twodsix-ledger-config"],
    position: {width: 520, height: "auto"},
    window: {title: `${PREFIX}.CONFIG_TITLE`, icon: "fa-solid fa-sliders", contentClasses: ["standard-form"]},
    form: {handler: LedgerConfigApp.#save, closeOnSubmit: false},
    actions: {
      addAccount: LedgerConfigApp.#addAccount,
      removeAccount: LedgerConfigApp.#removeAccount,
      addCategory: LedgerConfigApp.#addCategory,
      removeCategory: LedgerConfigApp.#removeCategory,
      resetConfig: LedgerConfigApp.#reset
    }
  };

  static PARTS = {
    form: {template: `modules/${MODULE_ID}/templates/settings.hbs`}
  };

  draft = null;

  /** @override */
  async _prepareContext() {
    this.draft ??= draftFromSaved();
    const local = game.i18n.localize.bind(game.i18n);
    return {
      accounts: this.draft.accounts.map(entry => ({
        ...entry,
        locked: entry.key === "cash",
        placeholder: entry.key === "cash" || entry.key === "digital" ? accountLabel(entry.key, local) : t("CONFIG_NEW_ACCOUNT")
      })),
      categories: this.draft.categories.map(entry => ({
        ...entry,
        locked: BUILTIN_CATEGORIES.includes(entry.key),
        placeholder: BUILTIN_CATEGORIES.includes(entry.key) ? game.i18n.localize(`${PREFIX}.CATEGORIES.${entry.key}`) : t("CONFIG_NEW_CATEGORY")
      })),
      canAddAccount: this.draft.accounts.length < MAX_LEDGER_ACCOUNTS,
      maxAccounts: MAX_LEDGER_ACCOUNTS
    };
  }

  /** Take what is typed in the window into the draft, before something changes the list. */
  #readForm() {
    if (!this.draft) {
      return;
    }
    for (const kind of ["accounts", "categories"]) {
      for (const row of this.element.querySelectorAll(`[data-kind="${kind}"]`)) {
        const entry = this.draft[kind].find(candidate => candidate.key === row.dataset.key);
        if (entry) {
          entry.name = row.querySelector("input").value;
        }
      }
    }
  }

  static async #addAccount() {
    this.#readForm();
    if (this.draft.accounts.length < MAX_LEDGER_ACCOUNTS) {
      this.draft.accounts.push({key: `a${foundry.utils.randomID(6)}`, name: ""});
    }
    await this.render();
  }

  static async #removeAccount(event, target) {
    this.#readForm();
    const key = target.dataset.key;
    const user = accountUsedBy(key);
    if (user) {
      ui.notifications.warn(game.i18n.format(`${PREFIX}.CONFIG_IN_USE`, {account: this.draft.accounts.find(entry => entry.key === key)?.name || key, actor: user}));
      return;
    }
    this.draft.accounts = this.draft.accounts.filter(entry => entry.key !== key);
    await this.render();
  }

  static async #addCategory() {
    this.#readForm();
    this.draft.categories.push({key: `c${foundry.utils.randomID(6)}`, name: ""});
    await this.render();
  }

  static async #removeCategory(event, target) {
    this.#readForm();
    this.draft.categories = this.draft.categories.filter(entry => entry.key !== target.dataset.key);
    await this.render();
  }

  static async #reset() {
    this.draft = {
      accounts: [{key: "cash", name: ""}, {key: "digital", name: ""}],
      categories: BUILTIN_CATEGORIES.map(key => ({key, name: ""}))
    };
    await this.render();
  }

  static async #save() {
    this.#readForm();
    const accounts = this.draft.accounts.map(entry => ({key: entry.key, name: entry.name.trim()}));
    const categories = this.draft.categories.map(entry => ({key: entry.key, name: entry.name.trim()}));
    // Custom categories need a name, or they could not be told apart
    if (categories.some(entry => !BUILTIN_CATEGORIES.includes(entry.key) && !entry.name)) {
      ui.notifications.warn(t("CONFIG_CATEGORY_NAME"));
      return;
    }
    if (accounts.slice(1).some(entry => !entry.name && entry.key !== "digital")) {
      ui.notifications.warn(t("CONFIG_ACCOUNT_NAME"));
      return;
    }
    await game.settings.set(MODULE_ID, SETTING, {accounts, categories});
    await this.close();
  }
}

/** Register the setting and the window for it (called from the `init` hook). */
export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => {
      applyConfig();
      refreshSheets();
    }
  });
  game.settings.registerMenu(MODULE_ID, "configure", {
    name: `${PREFIX}.CONFIG_NAME`,
    label: `${PREFIX}.CONFIG_LABEL`,
    hint: `${PREFIX}.CONFIG_HINT`,
    icon: "fa-solid fa-sliders",
    type: LedgerConfigApp,
    restricted: true
  });
}
