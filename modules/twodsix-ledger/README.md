# Twodsix Ledger

A ledger for the Finances tab of the Twodsix traveller sheet, and a clearer Inventory tab.

## Install

Needs Foundry v14 and the Twodsix system 7.7.0 or later. Install it with the manifest URL below, then enable the module
in your world.

```
https://raw.githubusercontent.com/Maltavius/twodsix-foundryvtt/experiment/ledger-module/modules/twodsix-ledger/module.json
```

See the [manual](MANUAL.md) for how to use and set up everything, and the [changelog](CHANGELOG.md) for what has changed.

## What it does

- A history of every transaction, with in-game dates, categories, filters, search and undo. Accounts (Cash and Digital by
  default, up to four) and Move money between them. A payment that the account cannot cover is refused.
- Four cards (Pension, Living costs, Ship payments, Debt) open lists of items that you pay by hand. Every payment becomes
  an entry in the history, with the in-game month when the world has a calendar. Empty cards take half the room.
- Debt is a list of loans. You can take a loan, pay it back (the monthly amount or another amount) and undo it.
- Drag an item onto the Finances tab to buy it: its name and price fill in Add transaction, and the item is added to the
  inventory when you press Add.
- A notes button in the totals bar opens and closes Financial Notes.
- The in-game date comes from Simple Calendar if you have it.

## Inventory

- Carried items come first in every list, with a tinted background.
- Fire mode buttons under weapons that can fire in more than one way. Each click is one attack; the last one used is
  marked.
- The loaded magazine under each weapon, with a bar that turns yellow when it is low and red when it is empty, and a
  Reload that asks which magazine when there is more than one.
- Loaded magazines are not listed a second time under Consumables.
- Drag an item onto a carried row to carry it, or onto another row to put it in the backpack.
- Armour shows radiation protection and secondary protection; Equipment & Tools shows weight.

Each player can switch back to the system's own Inventory tab with the setting "Improved Inventory tab", and choose
"Automatically expand weapons" (off by default) to show the fire modes and magazine under every weapon from the start;
otherwise a click on the magazine pill after a weapon's name shows them. The setting "Portrait keeps
its aspect ratio" makes the portrait fit inside its frame instead of being stretched or cut.

## Settings

The GM sets up the accounts and categories under Module Settings. Cash is always the first account, there can be up to four
accounts, and the standard categories can be renamed but not removed.

Each player can choose how numbers are written under Number format (space, comma, dot or apostrophe as thousands separator).
By default it follows the interface language, so you can use English with, for example, Swedish number formatting.

## Data

Everything is stored on the character. Disable the module and the data is kept; enable it again and the ledger is back.

## Languages

English and Swedish.

## Made with AI

This module was written with the help of Claude, an AI model from Anthropic, and has been tested and directed by a person.

## Status

Experimental. Needs Twodsix 7.7.0 or later, verified with 7.7.1.
