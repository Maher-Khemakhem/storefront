# supermarket-storefront

This guide covers the entire project, including its subfolders. Review based on local source inspected on 2026-10-18. See the [root guide](../AGENTS.md) for project-wide rules. Improvement items are review findings or suggested follow-up work, not a claim that fixes have been implemented.

## Contents

Files: [.gitignore](.gitignore), [DESIGN.md](DESIGN.md), [index.html](index.html), [package-lock.json](package-lock.json), [package.json](package.json), [README.md](README.md), [vite.config.js](vite.config.js).

Subfolders: [.github/](.github/), [src/](src/).

## Functionality

Builds the customer React/Vite application for catalog browsing, customer authentication, carts, checkout, Stripe test payment/demo payment, and order history.

Customers can search/filter the catalog, register/login, edit a server-backed cart, check out, follow demo or Stripe test payment flows, and review/cancel eligible orders. The backend remains responsible for final prices, reservations, ownership, expiry, and payment verification.

## Positive points

- Separate staff/customer applications and storage keys avoid UI session confusion.
- Uses the same inventory/pricing/order backend as the staff ERP.
- Includes Node tests for quantity saves, exact conversion rounding, and payment limits.

- checkout.js saves changed quantities sequentially before checkout and uses BigInt conversion to match backend HALF_UP rounding.
- api.js preserves HTTP status/path information for failed requests; CI builds the deployed /store/ asset path.

## Points to improve

- CI builds the storefront but currently omits npm test despite the existing test script.
- Most UI and orchestration remain in a single App.jsx.
- Payment flows are demo/test features; live-mode payment support is explicitly absent from the backend integration.

- readSession tolerates blocked storage, but saveSession and clearSession do not catch storage failures. Tokens stored in localStorage are accessible to scripts.
- Helper tests do not exercise rendered screens, stale responses, expired sessions, or the complete payment redirect/reconciliation flow.
- Catalog availability and cart quotes can change before checkout; show actionable feedback when server repricing or reservation fails.

## Working in this folder

Run npm ci, npm test, and npm run build here. Development uses port 5174; the deployed build uses npm run build -- --base=/store/. Never put Stripe secrets in browser environment variables.

