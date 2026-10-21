/**
 * Glue between the traveller sheet and the Finances tab: builds the template context, wires up the form and
 * implements the tab's actions. Everything that can be decided without Foundry lives in financeView.js and ledger.js.
 *
 * The functions in `financeActions` are ApplicationV2 actions: they run with `this` set to the sheet.
 */

import { LEDGER_ACCOUNTS, formatLedgerNumber, parseLedgerAmount } from "./ledger.js";
import {
  MODULE_ID,
  addRecurringItem,
  addTransaction,
  deleteRecurringItem,
  editRecurringItem,
  getCurrentGameDate,
  getRecurringItems,
  getStoredBalances,
  getStoredDebt,
  getStoredTransactions,
  moveMoney,
  payAllRecurring,
  payRecurringItem,
  undoLastTransaction
} from "./store.js";
import { buildRecurringView } from "./recurringView.js";
import { isDeltaFinanceText } from "./financeText.js";
import { ROW_LIMIT_STEP, buildFinanceView, getAddButtonState } from "./financeView.js";

const PREFIX = "TWODSIX_LEDGER";
const SEARCH_DELAY_MS = 250;

/**
 * @param {object} sheet
 * @returns {{ui: object, draft: object}} the per-sheet state, created on first use. Kept on the sheet object so it
 *   survives re-renders (for example when another player changes something on the actor) but not closing the sheet.
 */
function getState(sheet) {
  sheet._financeState ??= {
    ui: {filter: "all", search: "", limit: undefined, mode: "add"},
    draft: {amount: "", description: "", category: "other", account: "cash", from: "cash", to: "digital"},
    focus: null
  };
  return sheet._financeState;
}

/**
 * Add the data for the Finances tab to the sheet's render context.
 * @param {object} sheet - the traveller sheet
 * @param {object} context - the render context, modified in place
 * @returns {void}
 */
export function prepareFinanceContext(sheet, context) {
  const state = getState(sheet);
  const system = sheet.actor.system;
  const locale = game.i18n.lang;
  const draft = state.draft;
  const balances = getStoredBalances(sheet.actor);
  const view = buildFinanceView({
    transactions: getStoredTransactions(sheet.actor),
    balances,
    debt: system.financeValues.debt,
    ui: state.ui,
    locale,
    localize: key => game.i18n.localize(key)
  });
  const button = getAddButtonState(draft.amount, locale);
  context.finance = {
    ...view,
    editable: Boolean(context.editable),
    recurring: buildRecurringView({
      items: getRecurringItems(sheet.actor),
      debt: getStoredDebt(sheet.actor),
      locale,
      localize: key => game.i18n.localize(key),
      gameDate: getCurrentGameDate()
    }),
    digitalText: formatLedgerNumber(balances.digital, locale),
    draft,
    button: {kind: button.kind, label: game.i18n.localize(button.labelKey)},
    // Options with the selected one flagged, for the <select> elements
    addAccounts: view.accounts.map(account => ({...account, selected: account.key === draft.account})),
    fromAccounts: view.accounts.map(account => ({...account, selected: account.key === draft.from})),
    toAccounts: view.accounts.map(account => ({...account, selected: account.key === draft.to})),
    categoryOptions: view.categories.map(category => ({...category, selected: category.key === draft.category}))
  };
}

/**
 * @param {object} sheet
 * @returns {HTMLElement|null}
 */
function getRoot(sheet) {
  return sheet.element?.querySelector(".finance-ledger") ?? null;
}

/**
 * Show or clear the message below the form.
 * @param {HTMLElement} root
 * @param {string} message
 * @returns {void}
 */
function setError(root, message) {
  const el = root.querySelector(".fl-error");
  if (el) {
    el.textContent = message;
    el.hidden = !message;
  }
}

/**
 * Copy what is typed in the form into the draft kept on the sheet.
 * @param {object} sheet
 * @param {HTMLElement} root
 * @returns {object} the draft
 */
function readDraft(sheet, root) {
  const draft = getState(sheet).draft;
  for (const name of Object.keys(draft)) {
    const el = root.querySelector(`[data-draft="${name}"]`);
    if (el) {
      draft[name] = el.value;
    }
  }
  return draft;
}

/**
 * Empty the amount and description (and optionally reset the category), both in the stored draft and in the form on
 * screen. The sheet can re-render while an update is still in flight, and a re-render may keep what is typed in the
 * fields, so the form is cleared directly instead of relying on the next render.
 * @param {object} sheet
 * @param {HTMLElement} root
 * @param {boolean} resetCategory
 * @returns {void}
 */
function clearDraft(sheet, root, resetCategory) {
  const draft = getState(sheet).draft;
  draft.amount = "";
  draft.description = "";
  if (resetCategory) {
    draft.category = "other";
  }
  for (const name of ["amount", "description", ...(resetCategory ? ["category"] : [])]) {
    const el = root.querySelector(`[data-draft="${name}"]`);
    if (el) {
      el.value = draft[name];
    }
  }
  updateAddButton(root, "");
}

/**
 * Make the form on screen show the stored draft (a re-render can leave old text in the fields).
 * @param {object} sheet
 * @param {HTMLElement} root
 * @returns {void}
 */
function applyDraft(sheet, root) {
  const draft = getState(sheet).draft;
  for (const name of Object.keys(draft)) {
    const el = root.querySelector(`[data-draft="${name}"]`);
    if (el && el.value !== draft[name]) {
      el.value = draft[name];
    }
  }
  updateAddButton(root, draft.amount);
}

/**
 * Make the add button reflect the amount currently typed: neutral, green for income, red for expense.
 * @param {HTMLElement} root
 * @param {string} amountText
 * @returns {void}
 */
function updateAddButton(root, amountText) {
  const button = root.querySelector('[data-action="financeAdd"]');
  if (!button) {
    return;
  }
  const state = getAddButtonState(amountText, game.i18n.lang);
  button.dataset.kind = state.kind;
  button.querySelector(".fl-button-label").textContent = game.i18n.localize(state.labelKey);
}

/**
 * What a changed field of a recurring item means, as a patch for the item. Returns null if the text is not usable (an
 * amount that is not a number), in which case the sheet is simply drawn again with the stored value.
 * @param {HTMLInputElement|HTMLSelectElement} field
 * @returns {object|null}
 */
function readRecurringField(field) {
  const name = field.dataset.recField;
  if (field.type === "checkbox") {
    return {[name]: field.checked};
  }
  if (name === "amount") {
    const amount = parseLedgerAmount(field.value, game.i18n.lang);
    return Number.isFinite(amount) ? {amount} : null;
  }
  return {[name]: field.value};
}

/**
 * Hook up the form after each render. Safe to call when the Finances tab is not editable or not present.
 * @param {object} sheet
 * @returns {void}
 */
export function bindFinanceTab(sheet) {
  const root = getRoot(sheet);
  if (!root) {
    return;
  }
  const state = getState(sheet);
  applyDraft(sheet, root);

  // Typing in the ledger controls must not submit the whole actor form (and re-render the sheet) on every change.
  root.querySelectorAll(".fl-nosubmit").forEach(el => el.addEventListener("change", event => event.stopPropagation()));

  // Digital is a flag kept by this module: apply what is typed ("5000", or a change like "+200" or "-50") as a normal
  // update, and the preUpdateActor hook records the difference as an adjustment.
  root.querySelector("[data-digital-input]")?.addEventListener("change", async event => {
    const text = event.target.value.trim();
    const current = getStoredBalances(sheet.actor).digital;
    const typed = parseLedgerAmount(text, game.i18n.lang);
    if (Number.isFinite(typed)) {
      const isChange = isDeltaFinanceText(text);
      await sheet.actor.update({[`flags.${MODULE_ID}.digital`]: isChange ? current + typed : typed});
    }
    await sheet.render();
  });

  // Recurring items: one change handler for the whole list
  root.querySelector("[data-recurring]")?.addEventListener("change", async event => {
    const field = event.target.closest("[data-rec-field]");
    const row = event.target.closest("[data-rec-id]");
    if (!field || !row) {
      return;
    }
    const patch = readRecurringField(field);
    if (patch) {
      await editRecurringItem(sheet.actor, row.dataset.recId, patch);
    }
    await sheet.render();
  });

  root.querySelectorAll("[data-draft]").forEach(el => {
    el.addEventListener("input", () => {
      readDraft(sheet, root);
      if (el.dataset.draft === "amount") {
        updateAddButton(root, el.value);
      }
      setError(root, "");
    });
    el.addEventListener("change", () => readDraft(sheet, root));
  });

  root.querySelectorAll("[data-submit-on-enter]").forEach(el => {
    el.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        const action = state.ui.mode === "move" ? financeActions.financeMove : financeActions.financeAdd;
        action.call(sheet, event, el);
      }
    });
  });

  const search = root.querySelector('[data-role="search"]');
  if (search) {
    let timer;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.ui.search = search.value;
        state.ui.limit = undefined;
        state.focus = {role: "search", position: search.selectionStart ?? search.value.length};
        sheet.render();
      }, SEARCH_DELAY_MS);
    });
  }

  // Put the cursor back where it was after a re-render
  if (state.focus) {
    const el = root.querySelector(state.focus.role === "search" ? '[data-role="search"]' : `[data-draft="${state.focus.role}"]`);
    if (el) {
      el.focus();
      if (state.focus.position !== undefined && el.setSelectionRange) {
        el.setSelectionRange(state.focus.position, state.focus.position);
      }
    }
    state.focus = null;
  }
}

/**
 * @returns {string} the language of the user interface, which decides how numbers are written
 */
function getLocale() {
  return game.i18n.lang;
}

export const financeActions = {
  /**
   * Add income or an expense to the chosen account.
   * @this {object} the sheet
   * @returns {Promise<void>}
   */
  async financeAdd() {
    const root = getRoot(this);
    if (!root) {
      return;
    }
    const draft = readDraft(this, root);
    const amount = parseLedgerAmount(draft.amount, getLocale());
    if (!Number.isFinite(amount) || amount === 0) {
      setError(root, game.i18n.localize(`${PREFIX}.ERROR_INVALID_AMOUNT`));
      root.querySelector('[data-draft="amount"]')?.focus();
      return;
    }
    const state = getState(this);
    const entry = {amount, account: draft.account, category: draft.category, description: draft.description.trim()};
    clearDraft(this, root, true);
    state.focus = {role: "amount"};
    await addTransaction(this.actor, entry);
    await this.render();
  },

  /**
   * Move money between the traveller's own accounts.
   * @this {object} the sheet
   * @returns {Promise<void>}
   */
  async financeMove() {
    const root = getRoot(this);
    if (!root) {
      return;
    }
    const draft = readDraft(this, root);
    const amount = Math.abs(parseLedgerAmount(draft.amount, getLocale()));
    if (!Number.isFinite(amount) || amount === 0) {
      setError(root, game.i18n.localize(`${PREFIX}.ERROR_MOVE_AMOUNT`));
      root.querySelector('[data-draft="amount"]')?.focus();
      return;
    }
    if (draft.from === draft.to || !LEDGER_ACCOUNTS.includes(draft.from) || !LEDGER_ACCOUNTS.includes(draft.to)) {
      setError(root, game.i18n.localize(`${PREFIX}.ERROR_MOVE_ACCOUNTS`));
      return;
    }
    const state = getState(this);
    const entry = {from: draft.from, to: draft.to, amount, description: draft.description.trim()};
    clearDraft(this, root, false);
    state.focus = {role: "amount"};
    await moveMoney(this.actor, entry);
    await this.render();
  },

  /**
   * Switch the form between adding a transaction and moving money.
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target - has data-mode
   * @returns {Promise<void>}
   */
  async financeSetMode(event, target) {
    const root = getRoot(this);
    if (root) {
      readDraft(this, root);
    }
    getState(this).ui.mode = target.dataset.mode === "move" ? "move" : "add";
    await this.render();
  },

  /**
   * Show all transactions or only those of one account.
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target - has data-filter
   * @returns {Promise<void>}
   */
  async financeFilter(event, target) {
    const root = getRoot(this);
    if (root) {
      readDraft(this, root);
    }
    const state = getState(this);
    state.ui.filter = target.dataset.filter;
    state.ui.limit = undefined;
    await this.render();
  },

  /**
   * Show older transactions.
   * @this {object} the sheet
   * @returns {Promise<void>}
   */
  async financeMore() {
    const state = getState(this);
    state.ui.limit = (state.ui.limit ?? ROW_LIMIT_STEP) + ROW_LIMIT_STEP;
    await this.render();
  },

  /**
   * Add an empty item to the list of recurring items.
   * @this {object} the sheet
   * @returns {Promise<void>}
   */
  async financeRecAdd() {
    await addRecurringItem(this.actor, {name: "", amount: 0, account: "digital", frequency: "month"});
    await this.render();
  },

  /**
   * Remove an item from the list (this does not touch the history).
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target - has data-id
   * @returns {Promise<void>}
   */
  async financeRecDelete(event, target) {
    await deleteRecurringItem(this.actor, target.dataset.id);
    await this.render();
  },

  /**
   * Pay (or receive) one item.
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target - has data-id
   * @returns {Promise<void>}
   */
  async financeRecPay(event, target) {
    await payRecurringItem(this.actor, target.dataset.id);
    await this.render();
  },

  /**
   * Pay every active monthly item.
   * @this {object} the sheet
   * @returns {Promise<void>}
   */
  async financeRecPayAll() {
    await payAllRecurring(this.actor);
    await this.render();
  },

  /**
   * Remove the newest entry after the player has confirmed.
   * @this {object} the sheet
   * @returns {Promise<void>}
   */
  async financeUndo() {
    const last = getStoredTransactions(this.actor).at(-1);
    if (!last) {
      ui.notifications.info(game.i18n.localize(`${PREFIX}.UNDO_NOTHING`));
      return;
    }
    const label = last.description || game.i18n.localize(`${PREFIX}.CATEGORIES.${last.category}`);
    const entry = `${label}, ${formatLedgerNumber(last.amount, getLocale(), !last.toAccount)}`;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {title: game.i18n.localize(`${PREFIX}.UNDO_LAST`)},
      content: `<p>${foundry.utils.escapeHTML(game.i18n.localize(`${PREFIX}.UNDO_CONFIRM`).replace("_ENTRY_", entry))}</p>`,
      rejectClose: false
    });
    if (confirmed) {
      await undoLastTransaction(this.actor);
    }
  }
};
