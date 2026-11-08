# Twodsix Ledger: manual

**Applies to version: 0.5.1**

> This manual is kept up to date with every release. The release workflow refuses to publish a version whose number is
> not on the line above, so update the text first and the number last. See `dev/RELEASING.md` for the checklist.

## Contents

1. [What the module is](#1-what-the-module-is)
2. [Installing and updating](#2-installing-and-updating)
3. [The Finances tab at a glance](#3-the-finances-tab-at-a-glance)
4. [Using the ledger](#4-using-the-ledger)
5. [The Inventory tab](#5-the-inventory-tab)
6. [Configuring the module](#6-configuring-the-module)
7. [Data, permissions and compatibility](#7-data-permissions-and-compatibility)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. What the module is

Twodsix Ledger replaces the Finances tab of the Twodsix traveller sheet with a ledger. It keeps a **history** of
everything that happens to a character's money, so you can see where the credits went, and it keeps track of the things a
traveller pays regularly: rent, ship payments, a pension, loans. It also gives the sheet a clearer **Inventory tab**.

Everything else on the sheet is the system's own. The module is a normal sheet that builds on the Twodsix traveller sheet,
and it takes over only the Finances tab and the Inventory tab (the Inventory tab can be switched off).

What you get:

- A **history** of transactions, with in-game dates, categories, filters, search and undo.
- **Accounts** (Cash and Digital by default, up to four) and **Move money** between them.
- **Recurring items** in three groups (Pension, Living costs, Ship payments) that you pay or receive by hand.
- **Debt** as a list of loans that you can take, add and pay back.
- **Drag an item** onto the tab to buy it: its name and price fill in the form, and the item can be added to the inventory in
  the same step.
- A clearer **Inventory tab**: carried items first, fire mode buttons, the loaded magazine under each weapon and Reload
  with a choice of magazine.
- Settings for the **accounts and categories** (GM), and for **how numbers are written**, the **Inventory tab** and the
  **portrait** (each player).
- English and Swedish.

## 2. Installing and updating

You need Foundry VTT **v14** and the Twodsix system **7.7.0 or later** (tested with 7.7.1).

1. In Foundry, open **Add-on Modules**, choose **Install Module** and paste this into **Manifest URL**:

   ```
   https://raw.githubusercontent.com/Maltavius/twodsix-foundryvtt/experiment/ledger-module/modules/twodsix-ledger/module.json
   ```

2. Open your world, go to **Manage Modules**, enable **Twodsix Ledger** and save.
3. Open a traveller. The Finances tab now shows the ledger. The module registers its sheet as the default for travellers,
   so existing characters need no change.

To update, use **Check for Update** under Add-on Modules, or install again with the same manifest URL. Close and reopen
the world afterwards. The list of changes for every version is in `CHANGELOG.md`, and it is also part of every release on
GitHub.

If you disable the module, nothing is lost: the data stays on the character, and when the module is enabled again the ledger
is back. While it is disabled, the sheet shows the system's own Finances tab.

## 3. The Finances tab at a glance

From the top of the tab down:

| Part | What it shows |
| --- | --- |
| **Totals bar** | **Total funds** with the in-game date next to it, and a yellow notes button on the right. Hover over **Net of debt** to see total funds minus what you owe. |
| **Financial Notes** | The sheet's own notes field. It is hidden until you press the yellow notes button, so it takes no space when you do not use it. |
| **Account cards** | One card per account (Cash and Digital by default) with the balance. You can type a new balance here. |
| **Group cards** | Pension, Living costs, Ship payments and Debt. Press one to open its list under the cards. |
| **Transaction history** | The heading bar has the **Add transaction** and **Move money** buttons. Below them: the form, the filters and search, the history list and **Undo last**. |

The tab adapts to the width of the sheet: the cards switch to fewer columns when it is narrow.

## 4. Using the ledger

### 4.1 Amounts

- Amounts are in credits (Cr), rounded to whole credits.
- Use **−** (minus) for costs and **+** (or nothing) for income. `-200` is a cost of 200, `500` is income of 500.
- You can write `k` for thousands, `M` for millions and `G` for billions: `1.5k` is 1,500 (with a number format that uses a comma as the decimal mark, write `1,5k`).
- How numbers are written (1,234 or 1 234 and so on) is a personal setting, see [6.2](#62-number-format-every-player).

### 4.2 Account balances

The account cards show what is on each account. Press the number to change it:

- Type a new number to **set** the balance, for example `5000`.
- Type `+200` or `-50` to **change** the balance by that amount.

Either way the change is written to the history as a **Manual adjustment**, so the history always adds up.

You cannot spend more than an account holds. **Add transaction**, **Move money** and the **Pay** buttons refuse an
amount the account cannot cover, and say so.

### 4.3 Add transaction

Open **Add transaction** in the history heading bar.

1. Fill in **Amount** (minus for an expense), choose the account (**Paid with**), a **Category** and write a
   **Description**.
2. Press **Add** or press Enter. The button changes its text to match the amount: *Add Expense* or *Add Income*.

A small orange **trash button** next to Add empties the form. It only appears while there is something to empty.

### 4.4 Buy an item by dragging it

You can drag an item onto the Finances tab, anywhere on it. The source can be the character's inventory, the Items
sidebar or a compendium.

- **Add transaction** opens and is filled in: the item's name as description, its **price** as a negative amount, and the
  category **Equipment**. Nothing is booked until you press the button, so you can change the amount, account or text
  first.
- If the item is **not on the character yet**, the button reads **Add Expense & Item**. When you press it, the transaction
  is booked and the item is added to the inventory (stacking and other rules are the system's own).
- If the item is **already in the inventory**, only the transaction is made. Nothing is added a second time.
- To **leave the item out**, empty the description, or press the trash button.
- Price is the item's **unit price**, even if the stack is larger than one.
- Only things that can be bought work this way: armour, weapons, equipment, tools, consumables, augments, components,
  computers and junk. Skills, spells, psionic abilities, traits, careers, species, ship positions and storage are dropped
  on the sheet as usual and do not become transactions.
- If the item has no price, only its name is filled in and you get a message about it.

**Undo last** removes the transaction only. It does not take the item out of the inventory again.

### 4.5 Move money

**Move money** transfers between the character's own accounts. Choose **From**, **To** and an amount (a positive
number). Total funds do not change. With more than two accounts, Move money stays locked until you have chosen both
accounts. The history shows the move as a **Transfer**.

### 4.6 The history

The history lists the newest entry first.

- **Date.** The in-game date is used when the world has a calendar (Simple Calendar), otherwise the real date. A
  real-world date has a tooltip that says so.
- **Category** under each description, shown in colour. **Account** as a coloured label.
- **Amount** and the **balance** after the entry. With an account filter on, the balance is that account's; with
  **All**, it is total funds.
- **Filters.** **All** or one account. A transfer is one row that shows both accounts.
- **Search** looks in the description and the category.
- **Show more** loads older entries, 50 at a time.
- **Balance before first entry** is added at the bottom when the character already had money before the first entry.
- **Undo last** removes the newest entry and reverses its effect on the balances (and on a loan, if the entry was a loan
  payment or a new loan). You are asked to confirm first. Undo can be used repeatedly to step back through the history.

### 4.7 Recurring items: Pension, Living costs, Ship payments

Press a group card to open its list. Each item has:

| Field | Meaning |
| --- | --- |
| **Name** | For example *Apartment* or *Ship mortgage*. |
| **Amount** | Negative for a cost, positive for income. |
| **Account** | Which account pays or receives it. |
| **Interval** | **Month** or **Year**. |
| **Active** (checkbox) | Items that are switched off stay in the list but are never counted or paid. |

The group shows a **Total** (for example *−800/month*) from the active items. The Traveller calendar has 13 months of 28
days and one extra day, Holiday, at the start of the year (365 days).

**Nothing is paid automatically.** You press **Pay** (or **Receive**, for income) when the payment is due. That books an
ordinary history entry in the item's category: Pension counts as Income, Living costs as Living, Ship payments as Ship.
The entry names the in-game month when the world has a calendar, for example *Apartment (month 3)*. A payment the account
cannot cover is refused. Use the trash button to remove an item and **Add item** for a new one.

Groups that are empty take little room: an empty group is one line (*Pension 0 ✎*), and two empty groups share the
place of one card. If all four are empty they sit in one row of small cards, and a name that does not fit is cut off with
"…" and shown in full when you hover over it.

### 4.8 Debt and loans

Debt is a list of **loans**, opened from the **Debt** card. A loan has a name (who from or what for), what is still
**owed**, an amount **per month** and the **account** payments are taken from. No interest is calculated. If you want
interest, add it as a recurring item.

- **Take a loan**: the money arrives on the account you choose (**Money goes to**), the loan is added to what you owe,
  and a history entry is made.
- **Add existing debt**: for a debt the character already has. No money is added to any account.
- **Pay** pays the monthly amount. **Pay off…** lets you pay another amount. You never pay more than what is owed, and a
  payment the account cannot cover is refused. Each payment is a history entry in the category **Loan**.
- **Total owed** is shown at the bottom, and **Net of debt** in the totals bar is total funds minus what you owe.

### 4.9 Financial Notes

Press the yellow notes button in the totals bar to open or close **Financial Notes**. It is the same notes field the
system has always had, so existing notes are still there.

## 5. The Inventory tab

The module also replaces the sheet's **Inventory** tab with a clearer one. It is on by default. Every player can switch it
off and get the system's own tab back, see [6.6](#66-settings-for-the-inventory-tab-and-the-portrait-every-player).

**Carried items first.** In every list the carried items come first and have a tinted background. A thin *Not equipped*
line separates them from the rest.

**Carrying and dropping.** Drag an item onto a carried row of its own list, or onto the list heading or the column
headings, and it is carried. Drag it onto a row that is not carried, or onto the *Not equipped* line, and it goes to the
backpack. Its magazines go with it, as with the equip button.

**Weapons.**

- A weapon with more than one way to fire gets a row of **fire mode buttons** (Single, Burst, Full Auto and so on, after
  the autofire rules of the world). Every click is **one attack** in that mode; nothing is stored on the weapon. The last
  mode used is marked until the page is reloaded.
- **Auto 3** is shown after the name of weapons with automatic fire, and the buttons say Burst and Full Auto without the
  rate of fire.
- At the right end of the name column a **pill** shows the magazine count (green, yellow or red, or *Unloaded*) with an
  arrow. Press it to show or hide the fire modes and the magazine row. Only the name itself attacks. Weapons start hidden,
  unless the setting *Automatically expand weapons* is on.

**The magazine.** The loaded magazine is shown directly under the weapon, in the weapon's own columns:

- a **bar** that turns yellow at a quarter or less and red when empty, and the **count** with **−** and **+**;
- under Qty, the **reserve** as *+2*: the magazines there are besides the loaded one (hover for the magazine's name and
  the full reserve text). The reserve counts every magazine that is not loaded, part-used ones too;
- the green check and the edit button as before. A weapon whose magazine is not chosen is marked **Unloaded**.

**Reload.** Reload is a plain icon like the others. It loads straight away when there is only one way to do it. When there
are more, it asks which magazine to load: a full one from the same stack, or another magazine that fits (the icon gets a
small arrow then). The system's Reload puts a part-used magazine aside as a new item that the weapon does not know about;
the module links it back to the weapon, and also finds such magazines that were put aside earlier (by name and size), so
they can be loaded again.

**Consumables.** Loaded magazines are left out of the Consumables list, since they are shown under their weapon. A line
under the list says how many, and can show them there too. The **Count** column shows what a stack holds, for example
*5/6 + 1 full* for Qty 2: the system keeps one count per stack, for one magazine, and the rest are full. A magazine shows
its weapon in brackets only when the name does not already contain it.

**Armour and equipment.** Armour has a radiation protection column (*Rad*), and secondary protection as *(+X)* after the
armour value, with the protection types on hover. Equipment & Tools has a weight column.

**Layout.** The name of each list stands in the black heading row. Each list sizes its columns to its own content, and
the name column takes the rest. When the name column gets too narrow, that list leaves out TL and Qty and labels Damage
*Dmg*; the other lists keep theirs. Qty stays in Consumables and Attachments, where it is edited. All icons on a row stay
(equip, chat, edit, delete) at the right end of the row, and they do not wrap to a second line. The battery icon that
creates a magazine is only shown on weapons with an ammo value.

## 6. Configuring the module

Open **Game Settings → Configure Settings → Twodsix Ledger**.

### 6.1 Accounts and categories (GM)

Press **Set up accounts and categories**. The settings apply to every character in the world.

**Accounts**

- There can be up to **four** accounts.
- **Cash is always the first account** and cannot be removed, but you can rename it. It is the sheet's own cash field.
- Add an account with **Add account** and give it a name. Leave a name empty to use the standard name.
- An account that is still in use cannot be removed. The window tells you which character uses it (a balance, a history
  entry, an item or a loan).

**Categories**

- The standard categories (Adjustment, Equipment, Income, Living, Loan, Medical, Other, Ship, Trade, Transfer) can be
  **renamed but not removed**, because the ledger itself uses them.
- Add your own with **Add category**. A category you add has no colour of its own and uses the plain text colour.

**Back to standard** puts everything back as it was. Press **Save** to apply your changes. Changes in the window do not take
effect until you save.

### 6.2 Number format (every player)

Under the same settings page, **Number format** decides how amounts are written and read. It is **per player**: every
player picks their own.

| Choice | Looks like |
| --- | --- |
| Follow the interface language (default) | depends on the language |
| Space | 1 234 567,5 |
| Comma | 1,234,567.5 |
| Dot | 1.234.567,5 |
| Apostrophe | 1’234’567.5 |

The choice also decides the **decimal mark** and how what you type is understood. With *Space*, `,` is the decimal mark and
`1 234` is one thousand two hundred thirty-four. This is what makes it possible to use an English interface with, for
example, Swedish number formatting.

### 6.3 Simple Calendar (optional)

If **Simple Calendar** is installed, the ledger shows the current in-game date next to Total funds and stamps every entry
with it. Without it, entries get the real-world date. Nothing needs to be set up.

### 6.4 Language

The module is available in English and Swedish and follows the language chosen in Foundry.

### 6.5 Going back to the system's sheet

The module registers a sheet called **Traveller Sheet (with ledger)** as the default for travellers. If you prefer the
system's own sheet for a character, change it in the sheet's configuration (the ⋮ menu → **Configure Sheet**). The ledger
data is kept.

### 6.6 Settings for the Inventory tab and the portrait (every player)

These are per player, under the same settings page:

| Setting | What it does |
| --- | --- |
| **Improved Inventory tab** (on) | The Inventory tab described above. Turn it off to use the system's own Inventory tab. |
| **Automatically expand weapons** (off) | Show the fire modes and the loaded magazine under every weapon from the start. When it is off, press the magazine pill after a weapon's name to show them. Changing the setting also resets weapons you have opened or closed by hand. |
| **Portrait keeps its aspect ratio** (off) | The portrait on the character sheet fits inside its frame instead of being stretched or cut, without a custom CSS rule. |

### 6.7 Tidy finance texts (GM)

Under Module Settings, **Tidy finance texts** looks through all characters for finance texts (Cash, Debt, and so on) that
have been filled with extra groups of digits, for example `15,404 419 494`. It shows a list of what it would change, and
rewrites only the text after you press the button. The amounts are never changed. If nothing is wrong, it says so.

The module also keeps the texts clean from now on, so you only need this once for characters that were already damaged.

### 6.8 Money from character generation

If the character was made with the **Twodsix Chargen MgT2e** module, the ledger picks up the money from character
generation the first time it runs for that character (when the world is opened, or when the character is created). It
happens once per character, and the chargen module is not needed for the ledger to work.

- Income and expenses (mustering-out cash, medical care, anagathics, lawyer, ...) become history entries labelled
  "Character generation" and no date. The Cash balance is not changed: it was already set. If the history would not add up to the
  balance, one "opening balance" entry makes up the difference.
- Debt (medical bills) becomes a loan, unless the character already has loans of its own saved.
- Pension becomes a recurring yearly item in the Pension group, unless one with the same amount already exists.
- Ship shares are not money, so they are added as a line in the financial notes.

Only one client does the import (the GM if one is online, otherwise the owner with the lowest user id). The chargen
data is never changed, and the character is marked with `flags.twodsix-ledger.chargenImported` so nothing is booked
twice. Data from a newer chargen format than the ledger understands is skipped and a warning is written to the
browser console.

## 7. Data, permissions and compatibility

**Where the data is stored.** Everything the ledger needs is saved on the character as flags (`flags.twodsix-ledger`): the transactions,
the digital balance and any extra accounts, the recurring items and the loans. **Cash** is the system's own number
(`system.financeValues.cash`), so other tools that read the character's cash see the same value.

**First time.** A character that has never had a ledger gets one built from what is already on the sheet: Pension, Living
costs, Ship payments and Debt become one item (or loan) each. Just opening the tab saves nothing; data is written when
something is changed.

**Permissions.** Players who own a character can use everything on its Finances tab. Others see the ledger but cannot
change it. Account and category setup is for the GM.

**Inventory tab.** It is built on a copy of the system's inventory template (twodsix 7.7.1). Using a fire mode button
is one attack and stores nothing on the weapon.

**Compatibility.** Foundry v14, Twodsix 7.7.0 or later (verified with 7.7.1). The sheet's own Debt number is kept equal to
the sum of the loans, so the rest of the sheet keeps showing the right debt.

**Uninstalling.** Disable the module to go back to the system's tab. The ledger data stays on the characters in case
you enable the module again.

## 8. Troubleshooting

**The Finances tab looks like the system's, not the ledger.**
Check that the module is enabled under **Manage Modules**, and that the character uses the sheet **Traveller Sheet (with
ledger)** (⋮ menu → **Configure Sheet**).

**"There is not enough money on that account."**
The ledger does not let an account go below zero. Move money in first, or choose another account.

**An account or category cannot be removed.**
It is still used. The settings window names the character. Move the balance or remove the items first.

**A number is read wrong, for example 1 234 becomes 1.**
The number format does not match how you type. Choose the format you use under **Number format**.

**Cash (or another finance text) on the system's own sheet shows a long row of numbers, such as `15,404 419 494`.**
Twodsix misreads numbers written with a space as thousands separator and adds a group at every change. The amounts are
right. Run **Tidy finance texts** under Module Settings once; the module then keeps the texts clean.

**A number typed as `10 500` on the system's own Finances tab becomes 10.**
Twodsix reads a space as the end of the number when it is written in a field of its own sheet (shown for a character that
does not use the ledger sheet, or when the module is off). Write `10500` there. The ledger's own fields read spaces correctly.

**The date shown is the real date and not the in-game date.**
No in-game date was recorded, for example because Simple Calendar was not active when the entry was made. A real-world
date has a tooltip that says so.

**An item I dropped was not turned into a transaction.**
Skills, traits, careers and the other kinds that cannot be bought are never turned into transactions. If it should be
bought, check that it is a kind of item that has a price.

**Something else.**
Report it on the GitHub page of the module, and say which Foundry, Twodsix and module versions you use.
