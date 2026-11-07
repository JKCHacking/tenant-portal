# Tenant Portal

A lightweight static portal for one rental unit: lease progress, rent history, utility bills (electricity, water, internet) and payment receipts. Vanilla HTML/CSS/JS, no backend, no database, no build step. Hosted on GitHub Pages.

> **Security limitation — read first.** GitHub Pages is a static host. The login is a basic visitor deterrent, **not** access control: anyone who can reach the site can download the HTML, JS, `data/tenant.json` and receipt images directly. **Use mock data only.** Do not publish real tenant financial records or receipts until a proper data-protection solution is in place (see "Future improvements"). Note that a *private repository* does not make a GitHub Pages site private on most plans.

## Demo login

Mock data ships with the demo credentials `tenant` / `demo1234`. Replace them (below) and remove the `#demo-hint` line from `index.html`.

## Run locally

The app uses ES modules and `fetch`, so open it through a local server (not `file://`):

    python3 -m http.server 8080
    # then visit http://localhost:8080/

Run the calculation/validation/auth tests (Node 18+, no dependencies):

    node tools/test.mjs

## Change the login credentials

    node tools/generate-credentials.mjs

It prompts for a username and password (hidden), generates a random salt and a PBKDF2-SHA-256 hash (600,000 iterations), and prints an `AUTH_CONFIG` block. Paste it over the existing `AUTH_CONFIG` in `assets/js/auth.js`. The plaintext password is never stored.

## Deploy to GitHub Pages

1. Push this folder's contents to the repository root on `main`.
2. Repo **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, Folder = `/ (root)`.
3. Visit `https://<user>.github.io/<repo>/`. All paths are relative, so the repo subpath works.

## Update data (admin workflow)

1. Edit `data/tenant.json` (add payments, bills).
2. Add receipt images under `receipts/` (jpg, jpeg, png or webp).
3. Commit and push to `main`. Pages republishes; the tenant refreshes.

### Data model

Charges and payments are separate. Balances and statuses are always derived, never stored.

- `profile` — tenant, unit, lease dates, `contractMonths`, `monthlyRent`, `rentDueDay`.
- **Rent charges are generated** from the profile: one per contract month, ID `RENT-YYYY-MM`, due on `rentDueDay`. To change one month's amount or due date, add an override to `rentCharges`:
  `{ "period": "2026-03", "amountDue": 10000, "dueDate": "2026-03-10" }`
- `securityDeposit` — optional charge: `{ "id": "SECURITY-DEPOSIT", "amountDue": 24000, "dueDate": "2026-11-07" }`. If omitted, `id` defaults to `SECURITY-DEPOSIT`. Its paid amount, balance, status and payment date are derived from payment allocations, just like rent and utility bills.
- `utilityBills` — charges: `{ "id": "WATER-2026-10", "type": "water", "period": "2026-10", "amountDue": 468.25, "dueDate": "2026-11-20" }`. `type` is `electricity`, `water` or `internet`.
- `payments` — each references the charge(s) it covers:

      {
        "id": "RENT-2026-10-001",
        "date": "2026-10-05",
        "amount": 7000,
        "method": "GCash",
        "allocations": [{ "chargeId": "RENT-2026-10", "amount": 7000 }],
        "receipt": "receipts/rent/RENT-2026-10-001.png"
      }

  Use `"receipt": null` when there is none. A payment may be partial, or cover several charges (list several allocations), including rent and the security deposit together. Payment IDs must be unique.

### Status rules

- **Paid**: paid ≥ due. **Partially paid**: something paid, not settled. **Overdue**: nothing paid and due date is before today (Asia/Manila). **Pending**: nothing paid and not yet past due (future periods are never overdue).
- Only fully paid periods count toward rental progress.

`tenant.json` is validated on load; typos (unknown charge IDs, bad dates, duplicate IDs, over-allocated payments, bad receipt paths) show a friendly error to the tenant and details in the browser console.

## Structure

    index.html            login
    dashboard.html        dashboard (rendered only after the auth guard passes)
    assets/css            main, login, dashboard styles
    assets/js             auth, data, calculations, utils, dashboard
    data/tenant.json      mock data
    receipts/             rent/, security-deposit/ and utilities/{electricity,water,internet}/
    tools/                credential generator and tests (not needed in production)

## Future improvements

Encrypted tenant JSON, a local admin utility to generate encrypted records, IndexedDB caching of encrypted data, real authentication / secure data distribution, charts, printable summaries.
