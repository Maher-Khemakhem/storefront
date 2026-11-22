import test from "node:test";
import assert from "node:assert/strict";
import { convertedCents, paymentLimitMessage, quantityRequest, saveCartQuantities } from "./checkout.js";

const milk = { productId: "milk", productName: "Milk", unitType: "EACH", quantity: "1 unit(s)" };
const tomato = { productId: "tomato", productName: "Tomatoes", unitType: "WEIGHT", quantity: "0.500 kg" };
const config = { enabled: true, rate: 0.3, currency: "EUR", minimumAmountCents: 50, maximumAmountCents: 99999999 };

test("checkout saves all unsaved quantities in sequence before returning the final priced cart", async () => {
  const requests = [];
  let previousFinished = true;
  const finalCart = { items: [milk, tomato], subtotal: "8.250 TND", totalAmount: "9.818 TND" };
  const result = await saveCartQuantities({ items: [milk, tomato] }, { milk: "4", tomato: "0.125" }, async (body) => {
    assert.equal(previousFinished, true);
    previousFinished = false;
    await Promise.resolve();
    requests.push(body);
    previousFinished = true;
    return finalCart;
  });
  assert.deepEqual(requests, [
    { productId: "milk", quantityValue: 4, unitType: "EACH" },
    { productId: "tomato", quantityValue: 0.125, unitType: "WEIGHT" },
  ]);
  assert.equal(result, finalCart);
});

test("unchanged quantities are not saved again", async () => {
  const cart = { items: [milk, tomato] };
  assert.equal(await saveCartQuantities(cart, {}, () => assert.fail("unexpected update")), cart);
});

test("invalid quantity anywhere prevents every update", async () => {
  await assert.rejects(saveCartQuantities({ items: [milk, tomato] }, { milk: "3", tomato: "0.0001" }, () => assert.fail("invalid cart was saved")), /trois décimales/);
});

test("a failed save stops checkout and preserves completed saves", async () => {
  const saved = [];
  await assert.rejects(saveCartQuantities({ items: [milk, tomato] }, { milk: "3", tomato: "1.5" }, async (body) => {
    if (body.productId === "tomato") throw new Error("Stock changed");
    return { items: [{ ...milk, quantity: "3 unit(s)" }, tomato] };
  }, (cart) => saved.push(cart)), /Stock changed/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].items[0].quantity, "3 unit(s)");
});

test("quantity payloads keep units and decimal precision", () => {
  assert.equal(quantityRequest(tomato, "0,125").quantityValue, 0.125);
  for (const invalid of ["", "0", "-1", "1.5", "2147483648"]) {
    assert.throws(() => quantityRequest(milk, invalid));
  }
});

test("EUR cents match the backend HALF_UP rounding at the minimum charge", () => {
  assert.equal(convertedCents("1.649 TND", "0.30"), 49);
  assert.equal(convertedCents("1.650 TND", "0.30"), 50);
  assert.equal(convertedCents("12.345 TND", "0.30"), 370);
  assert.equal(convertedCents("0.001 TND", "0.30"), 0);
  assert.equal(convertedCents("10 TND", "1e-3"), 1);
});

test("payment limits use the server configuration and allow valid totals", () => {
  assert.match(paymentLimitMessage("1.649 TND", config), /au moins 0,50 EUR/);
  assert.equal(paymentLimitMessage("1.650 TND", config), "");
  assert.match(paymentLimitMessage("4000000 TND", config), /dépasse/);
  assert.equal(paymentLimitMessage("0.001 TND", { ...config, enabled: false }), "");
  assert.equal(paymentLimitMessage(undefined, config), "");
});
