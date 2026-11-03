# Five-minute demo guide

```bash
npm install
npm run seed -- --force
npm run dev -w server            # terminal 1 — API on :4000
VITE_DEMO=1 npm run dev -w web   # terminal 2 — open http://localhost:5173
```

The sign-in page lists the demo accounts; click one to fill it in.

## 1. Cashier: make a sale (2 minutes)

1. Sign in as **Cashier** (`cashier@demo.shop`).
2. Cashiers land on **Point of sale**. Note the cashier menu has no Dashboard, Stock or Staff.
3. Click a few tiles. Each tile shows remaining stock, which goes down as you add to the cart. **Dishwashing Liquid** and **Seasoning Cubes** are out of stock and disabled.
4. Type `615000000004` (Instant Noodles) in the search box and press **Enter**. This is how a barcode scanner adds an item.
5. Choose **Cash**, tap one of the quick-cash buttons and watch the change update. Click **Charge**.
6. The receipt appears. **Print receipt** prints just the receipt (try *Save as PDF*).
7. Open **Sales**. A cashier sees only their own sales.
8. Open **Products**. There's no cost price or margin column for cashiers.

## 2. Manager: stock control (2 minutes)

1. Sign out and sign in as **Manager**.
2. The **Dashboard** shows 30 days of revenue and profit, payment split, categories, top products and three low-stock items.
3. Click **Receive stock**. Select *Dishwashing Liquid 750ml*, quantity `48`, keep the suggested cost, and click **Receive stock**. It appears at the top of the ledger as `+48 receive`.
4. Switch to **Stock adjustment**. Pick any product, enter a counted quantity lower than the system quantity, give a reason and record it. The ledger shows an `adjust` row with your name.
5. Go to **Sales**, open any completed sale, enter a reason and **Void sale**. The receipt shows VOIDED, and the ledger shows the items returned as `void` movements.
6. **Export CSV** downloads the filtered sales list.

## 3. Owner: staff and API (1 minute)

1. Sign in as **Owner**. **Staff** lets you add users, change roles and disable accounts. Disabling a user signs them out on their next request.
2. Visit http://localhost:4000/api/docs for the interactive OpenAPI documentation. Every endpoint, its schema and required role are listed.

## What is demo-only

- All accounts, products, suppliers and sales are fictional. The barcodes use an unassigned `615…` range.
- `VITE_DEMO=1` shows demo credentials on the sign-in page. Never build production with it.
- In development a random `JWT_SECRET` is generated each start, so restarting signs everyone out. Production refuses to start without `JWT_SECRET`.
