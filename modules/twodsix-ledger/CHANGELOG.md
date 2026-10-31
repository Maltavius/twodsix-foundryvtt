# Changelog

## Unreleased

- New setting (per player) "Portrait keeps its aspect ratio": the portrait on the sheet fits inside its frame instead
  of being stretched or cut, without a custom CSS rule.
- New Inventory tab (on by default, each player can turn it off under Module Settings with "Improved Inventory tab"):
  - Carried items come first in every list and have a tinted background. A thin "Not equipped" line separates them
    from the rest.
  - Weapons with more than one way to fire get a row of fire mode buttons (Single, Burst, Full Auto and so on, after
    the autofire rules of the world). Every click is one attack in that mode; nothing is stored on the weapon. The last
    mode used is marked until the page is reloaded.
  - The loaded magazine is shown directly under the weapon: a bar that turns yellow at a quarter or less and red when
    empty, the count with - and +, the reserve, and the green check and edit button as before. A weapon whose magazine
    is not chosen is marked Unloaded.
  - Reload loads straight away when there is one way to do it, and asks which magazine when there are more (a full one
    from the same stack, or another magazine that fits).
  - Loaded magazines are left out of the Consumables list, since they are shown under their weapon. A line under the
    list says how many, and can show them there too.
  - All the icons on a row stay (equip, chat, edit, delete). The battery that creates a magazine is only shown on
    weapons with an ammo value, and the icons no longer wrap to a second line in any of the lists.
  - Auto 3 is shown after the name of weapons with automatic fire, and the buttons say Burst and Full Auto without the
    rate of fire. At the right end of the name column a pill with the magazine count (green, yellow or red, or Unloaded)
    and an arrow shows or hides the fire modes and the magazine row with its bar; only the name itself attacks. They
    start hidden; the new setting "Automatically expand weapons" shows them from the start. Changing the setting also
    resets weapons opened or closed by hand.
  - Reload is a plain icon like the others (with a tooltip), with a small arrow when there is more than one magazine to
    choose, in the icon column of the magazine row.
  - Reserve counts every magazine that is not loaded, part-used ones too ("2 in reserve, 1 part-used"). The system's
    Reload puts a part-used magazine aside as a new item that the weapon does not know about; the module links it to
    the weapon, and finds such magazines that were put aside earlier by name and size, so they can be loaded again.
  - Drag an item onto a carried row of its own list, or onto the list heading or column headings, and it is carried;
    drag it onto a row that is not carried (or the "Not equipped" line) and it goes to the backpack. Its magazines go
    with it, as with the equip button.
  - Each list sizes its columns to its own content, and the name column takes the rest. A list with no items lines up
    with the list above it. A list whose name column gets too narrow leaves out TL and Qty and labels Damage Dmg; the
    other lists keep theirs. Qty stays in Consumables and Attachments, where it is edited.
  - The list's name stands in the black heading row where "Name" was, instead of in a tab above it: one row less per
    list.
  - The icons sit at the right end of each row; on the magazine row Reload sits under the equip icon, the pen under
    the weapon's pen and the green check under the trash.
  - A magazine in the Consumables list shows its weapon in brackets only when its name does not already contain it
    (no more "Magazine: Snub Pistol (Snub Pistol)").
  - Armour has a radiation protection column, and secondary protection as (+X) after the armour value, with the
    protection types on hover. Equipment & Tools has a weight column.
- A trash button next to Add empties the form (amount, description, category and a dropped item). It is only there while
  there is something to empty.
- Drag an item (from the inventory, the sidebar or a compendium) onto the Finances tab, anywhere on it: Add
  transaction opens with the item's name, its price as a negative amount and the category Equipment. Nothing is added
  until you press Add, so you can change the amount, account or text first. An item without a price only fills in the
  name. Only things that can be bought count: skills, spells, psionic abilities, traits, careers, species, ship positions
  and storage are dropped on the sheet as usual.
- An item that is not on the character yet is also added to the inventory when you press Add: the button then reads
  "Add Expense & Item" (or Income, or Transaction). Emptying the description lets go of the item. An item that is
  already in the inventory is not added a second time.

## 0.4.3

- Works with twodsix 7.7.1. The system renamed the number behind Ship payments from `payment` to `payments`; the
  ledger now fills it in for characters from chargen or imports, like the other fields, and still works with 7.7.0.

## 0.4.2

- New setting **Number format** (per player): choose space, comma, dot or apostrophe as the thousands separator, or follow
  the interface language as before. It decides how amounts are shown and how typed amounts are read, so you can use an
  English interface with, for example, Swedish number formatting.
- Cash is now shown with the same number format as the other accounts (it used to show the text exactly as stored, often
  without a thousands separator). It is edited like the other accounts: `5000` sets it, `+200` and `-50` change it.
- Pension, Living costs, Ship payments and Debt take half the height while they are empty: one line, "Pension 0 ✎".
  Two empty ones share the place of one full card, and when all four are empty they sit side by side as four small
  cards. A name that does not fit is cut with "…" and shown in full when you hover over it. An empty group that is
  alone in its place looks like a normal card.
- The category colours in the history are back (a leftover style rule had switched them off).

## 0.4.1

- No spending beyond the balance: Add transaction, Move money and the Pay buttons refuse an amount the account does not
  have.
- A notes button (yellow) in the totals bar opens and closes Financial Notes, which takes no room while closed.
- The in-game date sits after Total funds. Net of debt has a short explanation on hover.
- Heading bars with rounded corners, like Financial Notes, with their buttons inside.
- The account cards switch to fewer columns earlier, Cr is hidden when space is tight, and the filter buttons wrap.
- Clean-up of styles and strings, tests for the settings, and a README, manifest and release flow for installing the
  module from a manifest URL.

## 0.4.0

- Accounts (up to four, Cash first) and categories can be set up in the module settings.
