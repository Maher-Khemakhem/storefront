# Marché Central interface

A grocery storefront should help customers find products, compare prices,
choose units or kilograms, and manage their basket.

Palette: forest `#174A34`, leaf `#246646`, mint `#E8F2E9`, lemon `#F1D65A`,
white `#FFFFFF`, muted text `#5B7062`. Use lemon for the introductory shopping
action and forest for purchase controls.

Outfit carries the brand, headings, and product names; DM Sans handles body
copy and controls. Keep fallbacks local, labels in sentence case, and monetary
amounts in three-decimal TND. Content and product details align left.

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
