# Changelog

## 0.4.2

- New setting **Number format** (per player): choose space, comma, dot or apostrophe as the thousands separator, or follow
  the interface language as before. It decides how amounts are shown and how typed amounts are read, so you can use an
  English interface with, for example, Swedish number formatting.
- Cash is now shown with the same number format as the other accounts (it used to show the text exactly as stored, often
  without a thousands separator). It is edited like the other accounts: `5000` sets it, `+200` and `-50` change it.
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
