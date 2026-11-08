# Mira Ledger

A personal money tracker that installs on your phone. Your data stays on your device. Receipts are read on the phone itself, unless you add your own Anthropic API key under Settings > Receipt reading. Then each receipt image, today's date and your category names go to Anthropic, and the phone is the backup.

- **Numbers you can check:** every total opens the entries behind it, and the month reads as one sum: started with + earned + borrowed − spent − debt payments = what you have now.
- **Everything is editable:** amount, type, source, account and date, on any entry, with Undo.
- **Receipts:** use a photo or banking screenshot, check what was read, and pick the account.
- **Debts:** each one is a running history, like a passbook.

## Files

- `core.js`: all the money logic, with no screen code.
- `app.js`: the screens.
- `tests.html`: open it in a browser to run the money tests. Run them after every change to `core.js`.
- `vendor/`: the font and the receipt reader, so the app works offline.

When you change `core.js`, `app.js` or `styles.css`, raise the `CACHE` version in `sw.js` so installed apps pick up the change.
