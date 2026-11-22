import test from "node:test";
import assert from "node:assert/strict";
import { formatMoney, formatQuantity, formatVatRate, parseAmount } from "./shared/format.js";
import { ORDER_PROGRESS, ORDER_STATUSES, STAFF_NEXT_STATUS, orderProgress, orderStatus } from "./shared/orderStatus.js";

const nbsp = /[   ]/;

test("money defaults to French formatting with three decimals (0,000 TND)", () => {
  assert.equal(formatMoney("12.5 TND"), "12,500 TND");
  assert.equal(formatMoney(0), "0,000 TND");
  assert.match(formatMoney("1234.5"), new RegExp(`^1${nbsp.source}234,500 TND$`));
  assert.equal(formatMoney("12.5 TND", { locale: "en" }), "12.500 TND");
  assert.equal(formatMoney("pas un prix", { fallback: "Prix indisponible" }), "Prix indisponible");
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("0.000 TND"), 0);
});

test("quantities keep whole units for EACH and three-decimal kilograms for WEIGHT", () => {
  assert.equal(formatQuantity("1 unit(s)", "EACH"), "1 unité");
  assert.equal(formatQuantity("4 unit(s)", "EACH"), "4 unités");
  assert.equal(formatQuantity("0.5 kg", "WEIGHT"), "0,500 kg");
});

test("VAT rates stored as percentages render as French percentages", () => {
  assert.match(formatVatRate("19.00"), new RegExp(`^19${nbsp.source}%$`));
  assert.match(formatVatRate(7), new RegExp(`^7${nbsp.source}%$`));
  assert.equal(formatVatRate(null), null);
});

test("every backend order status has a tone and French wording for staff and customers", () => {
  const backend = ["PENDING_PAYMENT", "EXPIRED", "CONFIRMED", "PREPARING", "READY", "COMPLETED", "CANCELLED"];
  for (const status of backend) {
    const meta = ORDER_STATUSES[status];
    assert.ok(meta, status);
    assert.ok(["success", "warning", "danger", "info", "neutral"].includes(meta.tone), status);
    assert.ok(meta.staff && meta.customer && meta.customerHint, status);
  }
  assert.equal(orderStatus("SOMETHING_NEW").tone, "neutral");
});

test("order progress marks done, current and upcoming steps, and hides off-path orders", () => {
  assert.deepEqual(orderProgress("PREPARING").map((step) => step.state), ["done", "current", "todo", "todo"]);
  assert.deepEqual(orderProgress("COMPLETED").map((step) => step.state), ["done", "done", "done", "done"]);
  assert.equal(orderProgress("CANCELLED"), null);
  assert.equal(orderProgress("PENDING_PAYMENT"), null);
  for (const [from, to] of Object.entries(STAFF_NEXT_STATUS)) {
    assert.equal(ORDER_PROGRESS.indexOf(to), ORDER_PROGRESS.indexOf(from) + 1);
  }
});
