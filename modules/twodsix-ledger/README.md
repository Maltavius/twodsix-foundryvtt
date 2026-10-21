# Twodsix Ledger

A ledger for the Finances tab of the Twodsix traveller sheet.

## Install

Needs Foundry v14 and the Twodsix system 7.7.0 or later. Install it with the manifest URL below, then enable the module
in your world.

```
https://raw.githubusercontent.com/Maltavius/twodsix-foundryvtt/experiment/ledger-module/modules/twodsix-ledger/module.json
```

## What it does

- Four cards (Pension, Living costs, Ship payments, Debt) open lists of items that you pay by hand. Every payment becomes
  an entry in the history, with the in-game month when the world has a calendar.
- Debt is a list of loans. You can take a loan, pay it back (the monthly amount or another amount) and undo it.
- Add transactions, or move money between accounts, and undo the last entry. Payments that the account cannot cover are
  refused.
- The in-game date comes from Simple Calendar if you have it.

## Settings

The GM sets up the accounts and categories under Module Settings. Cash is always the first account, there can be up to four
accounts, and the standard categories can be renamed but not removed.

## Data

Everything is stored on the character. Disable the module and the data is kept; enable it again and the ledger is back.

## Languages

English and Swedish.

## Made with AI

This module was written with the help of Claude, an AI model from Anthropic, and has been tested and directed by a person.

## Status

Experimental, built on Twodsix 7.7.0.
