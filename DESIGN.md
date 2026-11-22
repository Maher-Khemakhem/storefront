# Marché Central interface

A grocery storefront should help customers find products, compare prices,
choose units or kilograms, and manage their basket.

Palette: the same brand blue as the staff app (`--brand-*` in `src/shared/tokens.css`): deep blue `#143A63` for
headings and the top bar, action blue `#1D62A8` for purchase controls, pale blue `#EEF4FB` for panels. The yellow accent
`#F5C542` is used only for the logo mark and the basket count, always with dark blue `#0E2A47` text (9:1 contrast).

Outfit carries the brand, headings, and product names; DM Sans handles body
copy and controls. Keep fallbacks local, labels in sentence case, and monetary
amounts in French three-decimal TND (`0,000 TND`). Content and product details align left.

```text
┌───────────────────────────────────────────────┐
│ Marché Central      Shop     Account  Basket   │
├───────────────────────────────────────────────┤
│ Shopping introduction  │ Produce illustration │
├───────────────────────────────────────────────┤
│ Search                                        │
│ Department choices                            │
│ Stock filter                         Sort     │
│ Product    Product    Product    Product      │
└───────────────────────────────────────────────┘
```

The produce basket is the main expressive element. Product imagery comes from
the catalog; unavailable images get a quiet, explicit placeholder. Keep the
catalog close to the introduction, with two columns on phones and four on wide
screens. Department choices stay available after filtering.

The previous decorative banner and formal serif styling felt detached from
everyday shopping. The produce illustration and compact product controls give
the storefront its own identity. Avoid invented freshness, delivery, or stock
promises. Loading, failure, and empty states each explain the next action.

Dialogs use native focus management and Escape support. Quantity forms use
whole units for EACH products and increments of 0.001 kg for WEIGHT products.
Basket edits save with Update or automatically before placing the order, so
typing does not issue intermediate requests and checkout cannot skip drafts.
Show the server-calculated VAT and total, and use the configured payment limits
to explain currency conversion constraints before creating a reservation.

## Shared with the other frontend

`src/shared/` is identical in the staff ERP and the storefront: semantic tokens
(status colors, spacing, type scale, z-index, motion), `format.js` (TND money with
three decimals via `Intl`, quantities, dates, VAT rates), `orderStatus.js` and the
`OrderStatusBadge` / `OrderProgress` components. An online order has the same tone
and progress steps on both surfaces: French operational labels for staff, friendly
English labels for customers. Status is never shown by color alone. Edit one copy,
copy it to the other app, then run `node scripts/check-shared-ui.mjs` from the
repository root. Brand colors and display fonts stay app-specific.
