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

- **The first line, `feature/finance-ledger` (the ledger built into the system).** Parked while the work goes on in this
  module. Everything the module has gained since (groups, loans, accounts and categories in the settings, the notes
  button, month notes) can be moved over again if we go back to a pull request. Remember the AI policy disclosure then.
