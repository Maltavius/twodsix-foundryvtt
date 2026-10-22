/**
 * Glue between the traveller sheet and the Finances tab: builds the template context, wires up the form and
 * implements the tab's actions. Everything that can be decided without Foundry lives in financeView.js and ledger.js.
 *
 * The functions in `financeActions` are ApplicationV2 actions: they run with `this` set to the sheet.
 */

import { LEDGER_ACCOUNTS, accountLabel, formatLedgerNumber, hasFunds, numberLocale, parseLedgerAmount, secondaryAccount } from "./ledger.js";
import {
  MODULE_ID,
  addLoan,
  addRecurringItem,
  addTransaction,
  balancePath,
  deleteLoan,
  deleteRecurringItem,
  editLoan,
  editRecurringItem,
  getCurrentGameDate,
  getLoans,
  getRecurringItems,
  getStoredBalances,
  getStoredTransactions,
  moveMoney,
  payLoan,
  payRecurringItem,
  takeLoan,
  undoLastTransaction
} from "./store.js";
import { buildGroupsView } from "./recurringView.js";
import { GROUPS, signedItemAmount } from "./recurring.js";
import { isDeltaFinanceText } from "./financeText.js";
import { ROW_LIMIT_STEP, buildFinanceView, getAddButtonState } from "./financeView.js";

const PREFIX = "TWODSIX_LEDGER";
const ROW_FOCUS_MS = 3000;
const SEARCH_DELAY_MS = 250;

/**
 * Which group is open and whether the form is open are remembered per traveller in this browser, so they come back
 * after switching tab, closing the sheet or reloading. Storage can be unavailable (private window, blocked site data),
 * in which case the tab simply starts closed/open as usual.
 * @param {object} actor
 * @returns {string}
 */
function prefsKey(actor) {
  return `${MODULE_ID}.ui.${actor?.id ?? "unknown"}`;
}

/**
 * @param {object} actor
 * @returns {{openGroup?: string|null, formOpen?: boolean, mode?: string}}
 */
function loadUiPrefs(actor) {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(prefsKey(actor)) ?? "null");
    if (!saved || typeof saved !== "object") {
      return {};
    }
    const prefs = {};
    if (saved.openGroup === null || [...GROUPS, "debt"].includes(saved.openGroup)) {
      prefs.openGroup = saved.openGroup;
    }
    if (typeof saved.formOpen === "boolean") {
      prefs.formOpen = saved.formOpen;
    }
    if (typeof saved.notesOpen === "boolean") {
      prefs.notesOpen = saved.notesOpen;
    }
    if (saved.mode === "add" || saved.mode === "move") {
      prefs.mode = saved.mode;
    }
    return prefs;
  } catch {
    return {};
  }
}

/**
 * @param {object} sheet
 * @returns {void}
 */
function saveUiPrefs(sheet) {
  try {
    const {openGroup, formOpen, mode, notesOpen} = getState(sheet).ui;
    globalThis.localStorage?.setItem(prefsKey(sheet.actor), JSON.stringify({openGroup, formOpen, mode, notesOpen}));
  } catch {
    // Not remembered, that is all
  }
}

/**
 * @param {object} sheet
 * @returns {{ui: object, draft: object}} the per-sheet state, created on first use. Kept on the sheet object so it
 *   survives re-renders (for example when another player changes something on the actor) but not closing the sheet.
 */
function getState(sheet) {
  sheet._financeState ??= {
    ui: {filter: "all", search: "", limit: undefined, mode: "add", openGroup: null, formOpen: true, notesOpen: false, ...loadUiPrefs(sheet.actor)},
    draft: {amount: "", description: "", category: "other", account: "cash", from: "cash", to: "digital"},
    focus: null,
    rowFocus: null
  };
  return sheet._financeState;
}

/**
 * Make the accounts of the draft fit the accounts there are now (they can be changed in the module settings). With two
 * accounts, From and To are always the two different ones. With more, picking one that the other already has empties
 * the other (see the change handler), so To can be empty until a choice is made.
 * @param {object} draft
 * @returns {void}
 */
function normalizeAccountDraft(draft) {
  const has = key => LEDGER_ACCOUNTS.includes(key);
  if (!has(draft.account)) {
    draft.account = "cash";
  }
  if (!has(draft.from)) {
    draft.from = "cash";
  }
  const others = LEDGER_ACCOUNTS.filter(key => key !== draft.from);
  if (!has(draft.to) || draft.to === draft.from) {
    draft.to = others.length === 1 ? others[0] : "";
  }
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
  const locale = getLocale();
  const draft = state.draft;
  const balances = getStoredBalances(sheet.actor);
  normalizeAccountDraft(draft);
  if (state.ui.mode === "move" && LEDGER_ACCOUNTS.length < 2) {
    state.ui.mode = "add";
  }
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
    groups: buildGroupsView({
      items: getRecurringItems(sheet.actor),
      loans: getLoans(sheet.actor),
      locale,
      localize: key => game.i18n.localize(key),
      gameDate: getCurrentGameDate(),
      openGroup: state.ui.openGroup,
      balances
    }),
    formOpen: state.ui.formOpen,
    notesOpen: state.ui.notesOpen,
    addFormOpen: state.ui.formOpen && state.ui.mode !== "move",
    moveFormOpen: state.ui.formOpen && state.ui.mode === "move",
    draft,
    button: {kind: button.kind, label: game.i18n.localize(button.labelKey)},
    // Options with the selected one flagged, for the <select> elements
    addAccounts: view.accounts.map(account => ({...account, selected: account.key === draft.account})),
    fromAccounts: view.accounts.map(account => ({...account, selected: account.key === draft.from})),
    toAccounts: view.accounts.map(account => ({...account, selected: account.key === draft.to})),
    fromEmpty: draft.from === "",
    toEmpty: draft.to === "",
    moveReady: Boolean(draft.from && draft.to && draft.from !== draft.to),
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
  const state = getAddButtonState(amountText, getLocale());
  button.dataset.kind = state.kind;
  button.querySelector(".fl-button-label").textContent = game.i18n.localize(state.labelKey);
}

/**
 * What a changed field of an item or loan means, as a patch. Returns null if the text is not usable (an amount that is
 * not a number), in which case the sheet is simply drawn again with the stored value.
 * @param {HTMLInputElement|HTMLSelectElement} field
 * @param {string} name - the name of the field
 * @returns {object|null}
 */
function readFieldPatch(field, name, group) {
  if (field.type === "checkbox") {
    return {[name]: field.checked};
  }
  if (name === "amount" || name === "remaining" || name === "monthly") {
    const text = field.value.trim();
    if (text === "" && name === "monthly") {
      return {monthly: 0};
    }
    const amount = parseLedgerAmount(text, getLocale());
    if (!Number.isFinite(amount)) {
      return null;
    }
    return {[name]: group && name === "amount" ? signedItemAmount(text, amount, group) : amount};
  }
  return {[name]: field.value};
}

/**
 * The selector of an item or loan row field, so it can be found again after a re-render.
 * @param {Element} element
 * @returns {string|null}
 */
function rowFieldSelector(element) {
  const field = element.closest?.("[data-rec-field], [data-loan-field]");
  const row = element.closest?.("[data-rec-id], [data-loan-id]");
  if (!field || !row) {
    return null;
  }
  const rowAttr = row.dataset.recId !== undefined ? `[data-rec-id="${CSS.escape(row.dataset.recId)}"]` : `[data-loan-id="${CSS.escape(row.dataset.loanId)}"]`;
  const fieldAttr = field.dataset.recField !== undefined ? `[data-rec-field="${field.dataset.recField}"]` : `[data-loan-field="${field.dataset.loanField}"]`;
  return `${rowAttr} ${fieldAttr}`;
}

/**
 * Lock the Move money button until From and To are two different accounts.
 * @param {HTMLElement} root
 * @returns {void}
 */
function updateMoveButton(root) {
  const button = root.querySelector('[data-action="financeMove"]');
  const from = root.querySelector('[data-draft="from"]')?.value;
  const to = root.querySelector('[data-draft="to"]')?.value;
  if (button) {
    button.disabled = !(from && to && from !== to);
  }
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

  // Every account field works the same way (Cash writes the system's own number, and the system keeps its text field in
  // step): apply what is typed ("5000", or a change like "+200" or "-50") as
  // a normal update, and the preUpdateActor hook records the difference as an adjustment.
  root.querySelectorAll("[data-account-input]").forEach(input => input.addEventListener("change", async event => {
    const account = event.target.dataset.accountInput;
    const text = event.target.value.trim();
    const current = getStoredBalances(sheet.actor)[account] ?? 0;
    const typed = parseLedgerAmount(text, getLocale());
    if (LEDGER_ACCOUNTS.includes(account) && Number.isFinite(typed)) {
      const isChange = isDeltaFinanceText(text);
      await sheet.actor.update({[balancePath(account)]: isChange ? current + typed : typed});
    }
    await sheet.render();
  }));

  // Items and loans: one change handler for the whole panel
  root.querySelector("[data-recurring]")?.addEventListener("change", async event => {
    const itemField = event.target.closest("[data-rec-field]");
    const loanField = event.target.closest("[data-loan-field]");
    if (itemField) {
      const patch = readFieldPatch(itemField, itemField.dataset.recField, getState(sheet).ui.openGroup);
      if (patch) {
        await editRecurringItem(sheet.actor, itemField.closest("[data-rec-id]").dataset.recId, patch);
      }
    } else if (loanField) {
      const patch = readFieldPatch(loanField, loanField.dataset.loanField);
      if (patch) {
        await editLoan(sheet.actor, loanField.closest("[data-loan-id]").dataset.loanId, patch);
      }
    } else {
      return;
    }
    await sheet.render();
  });

  // Saving a field re-renders the sheet (Foundry does it as soon as the actor is updated), which replaces the field that
  // Tab moved to. So the field that has the cursor is noted all the time and given back after a render.
  root.querySelector("[data-recurring]")?.addEventListener("focusin", event => {
    const selector = rowFieldSelector(event.target);
    state.rowFocus = selector ? {selector, at: Date.now()} : null;
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

  // Move money: From and To are never the same account. With two accounts, choosing one switches the other to the
  // remaining account. With more, the other one is emptied and Move money stays locked until both have been chosen.
  for (const [changed, other] of [["from", "to"], ["to", "from"]]) {
    root.querySelector(`[data-draft="${changed}"]`)?.addEventListener("change", event => {
      const otherSelect = root.querySelector(`[data-draft="${other}"]`);
      if (otherSelect && event.target.value && otherSelect.value === event.target.value) {
        const rest = LEDGER_ACCOUNTS.filter(account => account !== event.target.value);
        otherSelect.value = rest.length === 1 ? rest[0] : "";
      }
      readDraft(sheet, root);
      updateMoveButton(root);
    });
  }
  updateMoveButton(root);

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

  // Tab out of a row field saves it and re-renders; put the cursor on the field Tab went to, with its text selected
  if (state.rowFocus) {
    const {selector, at} = state.rowFocus;
    state.rowFocus = null;
    const lost = !root.contains(root.ownerDocument.activeElement) || root.ownerDocument.activeElement === root.ownerDocument.body;
    const el = Date.now() - at < ROW_FOCUS_MS && lost ? root.querySelector(selector) : null;
    if (el) {
      el.focus();
      if (typeof el.select === "function" && el.type === "text") {
        el.select();
      }
    }
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
 * Ask for the details of a new loan.
 * @returns {Promise<{name: string, amount: string, account: string, monthly: string}|null>} null if cancelled
 */
async function askLoanDetails() {
  const t = key => foundry.utils.escapeHTML(game.i18n.localize(`${PREFIX}.${key}`));
  const accounts = LEDGER_ACCOUNTS.map(key => `<option value="${key}">${foundry.utils.escapeHTML(accountLabel(key, game.i18n.localize.bind(game.i18n)))}</option>`).join("");
  const content = `<div class="form-group"><label>${t("LOAN_NAME")}</label><input type="text" name="name" autofocus></div>
    <div class="form-group"><label>${t("LOAN_AMOUNT")}</label><input type="text" name="amount" inputmode="text"></div>
    <div class="form-group"><label>${t("LOAN_INTO_ACCOUNT")}</label><select name="account">${accounts}</select></div>
    <div class="form-group"><label>${t("MONTHLY_PAYMENT")}</label><input type="text" name="monthly" inputmode="text" placeholder="0"></div>`;
  return foundry.applications.api.DialogV2.prompt({
    window: {title: game.i18n.localize(`${PREFIX}.TAKE_LOAN`)},
    content,
    ok: {label: game.i18n.localize(`${PREFIX}.TAKE_LOAN`), callback: (event, button) => Object.fromEntries(new FormData(button.form))},
    rejectClose: false
  });
}

/**
 * Ask for one amount.
 * @param {string} title
 * @returns {Promise<string|null>} what was typed, or null if cancelled
 */
async function askAmount(title) {
  const label = foundry.utils.escapeHTML(game.i18n.localize(`${PREFIX}.AMOUNT`));
  const answer = await foundry.applications.api.DialogV2.prompt({
    window: {title},
    content: `<div class="form-group"><label>${label}</label><input type="text" name="amount" inputmode="text" autofocus></div>`,
    ok: {label: title, callback: (event, button) => new FormData(button.form).get("amount")},
    rejectClose: false
  });
  return typeof answer === "string" ? answer : null;
}

/**
 * @returns {string} the locale that decides how numbers are written and read: the player's own choice in the module settings, or the language of the interface
 */
function getLocale() {
  let choice;
  try {
    choice = game.settings.get(MODULE_ID, "numberFormat");
  } catch {
    choice = "auto";
  }
  return numberLocale(choice, game.i18n.lang);
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
    if (!hasFunds(getStoredBalances(this.actor)[draft.account] ?? 0, amount)) {
      setError(root, game.i18n.localize(`${PREFIX}.ERROR_NO_FUNDS`));
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
    if (!hasFunds(getStoredBalances(this.actor)[draft.from] ?? 0, -amount)) {
      setError(root, game.i18n.localize(`${PREFIX}.ERROR_NO_FUNDS`));
      root.querySelector('[data-draft="amount"]')?.focus();
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
   * Open or close the form. The two buttons beside the history title share it: pressing the one for the mode that is
   * showing closes it, the other one switches the mode.
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target - has data-mode
   * @returns {Promise<void>}
   */
  async financeToggleForm(event, target) {
    const root = getRoot(this);
    if (root) {
      readDraft(this, root);
    }
    const {ui} = getState(this);
    const mode = target.dataset.mode === "move" ? "move" : "add";
    ui.formOpen = !(ui.formOpen && ui.mode === mode);
    ui.mode = mode;
    saveUiPrefs(this);
    await this.render();
  },

  /**
   * Open the list of a group, or close it if it is the one that is open.
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target - has data-group
   * @returns {Promise<void>}
   */
  async financeToggleGroup(event, target) {
    const {ui} = getState(this);
    ui.openGroup = ui.openGroup === target.dataset.group ? null : target.dataset.group;
    saveUiPrefs(this);
    await this.render();
  },

  /**
   * Show or hide the financial notes (the button in the totals bar).
   * @this {object} the sheet
   * @returns {Promise<void>}
   */
  async financeToggleNotes() {
    const {ui} = getState(this);
    ui.notesOpen = !ui.notesOpen;
    saveUiPrefs(this);
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
   * Add an empty item to a group.
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target - has data-group
   * @returns {Promise<void>}
   */
  async financeRecAdd(event, target) {
    const group = GROUPS.includes(target.dataset.group) ? target.dataset.group : "living";
    await addRecurringItem(this.actor, {name: "", amount: 0, account: secondaryAccount(), group});
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
    if (!await payRecurringItem(this.actor, target.dataset.id)) {
      ui.notifications.warn(game.i18n.localize(`${PREFIX}.PAY_NO_FUNDS`));
    }
    await this.render();
  },

  /**
   * Take a new loan: asks for the details, then creates the loan and puts the money on the chosen account.
   * @this {object} the sheet
   * @returns {Promise<void>}
   */
  async financeLoanTake() {
    const answer = await askLoanDetails();
    if (answer) {
      await takeLoan(this.actor, {
        name: answer.name,
        amount: parseLedgerAmount(answer.amount, getLocale()),
        account: answer.account,
        monthly: parseLedgerAmount(answer.monthly || "0", getLocale())
      });
      await this.render();
    }
  },

  /**
   * Add a debt that already exists, without any money changing hands.
   * @this {object} the sheet
   * @returns {Promise<void>}
   */
  async financeLoanAdd() {
    await addLoan(this.actor, {name: "", remaining: 0, monthly: 0, account: "cash"});
    await this.render();
  },

  /**
   * Pay a loan's monthly amount.
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target - has data-id
   * @returns {Promise<void>}
   */
  async financeLoanPay(event, target) {
    if (!await payLoan(this.actor, target.dataset.id)) {
      ui.notifications.warn(game.i18n.localize(`${PREFIX}.PAY_NO_FUNDS`));
    }
    await this.render();
  },

  /**
   * Pay back another amount of a loan: asks how much.
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target - has data-id
   * @returns {Promise<void>}
   */
  async financeLoanPayCustom(event, target) {
    const amount = await askAmount(game.i18n.localize(`${PREFIX}.PAY_OTHER`));
    if (amount !== null) {
      if (!await payLoan(this.actor, target.dataset.id, parseLedgerAmount(amount, getLocale()))) {
        ui.notifications.warn(game.i18n.localize(`${PREFIX}.PAY_NO_FUNDS`));
      }
      await this.render();
    }
  },

  /**
   * Remove a loan from the list (this does not touch the history).
   * @this {object} the sheet
   * @param {Event} event
   * @param {HTMLElement} target - has data-id
   * @returns {Promise<void>}
   */
  async financeLoanDelete(event, target) {
    await deleteLoan(this.actor, target.dataset.id);
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
