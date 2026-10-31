# Twodsix Ledger: backlog

Things we have decided to wait with. Nothing here is forgotten, and nothing here is started.

## Waiting for separate testing

- **Hooks and setting registration in `main.js`.** There are two separate `ready` hooks, and the `financeValuesSynced`
  setting is registered inside `ready` (and only for the GM) instead of in `init` like the others. It works, but Foundry
  expects settings to be registered in `init`. Change it together with a test round in Foundry, since it affects start-up.

## Larger, later

- **Tests for the sheet code (`scripts/financeTab.js`, about 780 lines).** The Tab focus, the lock on Move money, the funds
  check and the account choices live there and have no unit tests. Lift the pure parts (for example
  `normalizeAccountDraft` and the funds checks) into their own functions and test them.

## Open for later

- **Equipped items as cards (like the Finances cards).** Tried as a sketch and set aside: without icons for the weapon
  stats the cards end up as text. Colour coding per item type belongs with it.
- **The Inventory template is a copy of the system's `actor-items.hbs` (twodsix 7.7.1).** When the system changes its
  template, compare and move the change over to `templates/actor-items.hbs`. The changes are listed at the top of the
  file.
- **Ammunition mass.** Most magazines weigh 0. The Traveller rules of thumb could give an estimate: a magazine of 20
  rounds is 10% of the weapon's mass (scale by size), a power pack 60% if external or 20% if internal, and a weapon
  without a mass counts as 0.2 kg. Only if someone wants encumbrance for ammunition.
- **A new name for the module.** It does more than the ledger now.

- **The first line, `feature/finance-ledger` (the ledger built into the system).** Parked while the work goes on in this
  module. Everything the module has gained since (groups, loans, accounts and categories in the settings, the notes
  button, month notes) can be moved over again if we go back to a pull request. Remember the AI policy disclosure then.
