import { quantityNumber } from "./api.js";

export function quantityRequest(item, value) {
  const text = String(value).trim().replace(",", ".");
  const quantity = Number(text);
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Enter a quantity greater than zero for ${item.productName || item.name}.`);
  }
  if (item.unitType === "EACH" && (!Number.isInteger(quantity) || quantity > 2147483647)) {
    throw new Error(`${item.productName || item.name} must have a whole-unit quantity.`);
  }
  if (item.unitType === "WEIGHT" && (text.split(".")[1] || "").replace(/0+$/, "").length > 3) {
    throw new Error(`Use up to three decimal places for ${item.productName || item.name}.`);
  }
  return { productId: item.productId || item.id, quantityValue: quantity, unitType: item.unitType };
}

// Validate every draft first, then wait for each saved cart before checkout.
export async function saveCartQuantities(cart, quantities, save, onSaved = () => {}) {
  const updates = cart.items.map((item) => quantityRequest(item,
    quantities[item.productId] ?? quantityNumber(item.quantity)))
    .filter((update) => update.quantityValue !== quantityNumber(
      cart.items.find((item) => item.productId === update.productId).quantity));
  let savedCart = cart;
  for (const update of updates) {
    savedCart = await save(update);
    onSaved(savedCart);
  }
  return savedCart;
}

function decimalParts(value) {
  const match = String(value ?? "").replace(/\s*TND\s*$/i, "").trim()
    .match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const scale = (match[2] || "").length - Number(match[3] || 0);
  if (Math.abs(scale) > 30) return null;
  const digits = BigInt(match[1] + (match[2] || ""));
  return scale < 0
    ? { value: digits * 10n ** BigInt(-scale), divisor: 1n }
    : { value: digits, divisor: 10n ** BigInt(scale) };
}

export function convertedCents(total, rate) {
  const amount = decimalParts(total);
  const exchange = decimalParts(rate);
  if (!amount || !exchange || exchange.value <= 0n) return null;
  const numerator = amount.value * exchange.value * 100n;
  const denominator = amount.divisor * exchange.divisor;
  // Match BigDecimal HALF_UP without binary floating-point boundary errors.
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

export function paymentLimitMessage(total, config) {
  if (!config?.enabled) return "";
  const cents = convertedCents(total, config.rate);
  if (cents === null) return "";
  if (cents < config.minimumAmountCents) {
    return `Stripe requires at least ${(config.minimumAmountCents / 100).toFixed(2)} ${config.currency} after currency conversion. Increase quantities or add another product.`;
  }
  if (cents > config.maximumAmountCents) {
    return `This order exceeds Stripe’s ${(config.maximumAmountCents / 100).toFixed(2)} ${config.currency} payment limit. Reduce quantities or split the order.`;
  }
  return "";
}
