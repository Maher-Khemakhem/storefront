/*
 * Shared display formatting for the staff ERP and the storefront.
 * Identical in supermarket-erp/src/shared and supermarket-storefront/src/shared;
 * run `node scripts/check-shared-ui.mjs` from the repository root after editing.
 *
 * The backend Money type is authoritative. These helpers only format values the API
 * already calculated; they never compute prices, VAT or totals.
 */

/** Default locale for every screen: French as used in Tunisia (comma decimals, 0,000 TND). */
export const DEFAULT_LOCALE = "fr-TN";

/** The locale groups thousands with U+202F, which the UI font does not draw: use a plain no-break space. */
export const visibleSpaces = (text) => text.replace(/\u202f/g, "\u00a0");

const amountFormatters = new Map();

function amountFormatter(locale = DEFAULT_LOCALE) {
  if (!amountFormatters.has(locale)) {
    amountFormatters.set(locale, new Intl.NumberFormat(locale, {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
      useGrouping: "always", // 1 785,000 and not 1785,000, even where the locale groups only from 5 digits
    }));
  }
  return amountFormatters.get(locale);
}

/** Parses "12.500", "12.500 TND" or 12.5 into a number; returns null when not numeric. */
export function parseAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number.parseFloat(String(value).replace(/\s*TND\s*$/i, "").trim());
  return Number.isFinite(amount) ? amount : null;
}

/** Formats a TND amount with three decimals in the user's locale, e.g. "12,500 TND" (fr) or "12.500 TND" (en). */
export function formatMoney(value, { locale = DEFAULT_LOCALE, fallback = "—" } = {}) {
  const amount = parseAmount(value);
  return amount === null ? fallback : `${visibleSpaces(amountFormatter(locale).format(amount))} TND`;
}

/** Parses "1 unit(s)" or "0.500 kg" into its numeric value. */
export function quantityNumber(quantity) {
  const value = Number.parseFloat(String(quantity ?? "0").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/** Formats a quantity for its unit: whole units for EACH, three-decimal kilograms for WEIGHT. */
export function formatQuantity(quantity, unitType, { locale = DEFAULT_LOCALE, unitLabel = "unité", unitsLabel = "unités" } = {}) {
  const value = quantityNumber(quantity);
  if (unitType === "WEIGHT") return `${visibleSpaces(amountFormatter(locale).format(value))} kg`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} ${value === 1 ? unitLabel : unitsLabel}`;
}

/** Formats an ISO date-time; returns the fallback for empty or invalid input. */
export function formatDateTime(value, { locale = DEFAULT_LOCALE, fallback = "—", dateOnly = false } = {}) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString(locale, dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" });
}

/** Formats a VAT rate stored as a percentage (0–100, e.g. 19.00) as "19 %" (fr) or "19%" (en). */
export function formatVatRate(rate, { locale = DEFAULT_LOCALE } = {}) {
  if (rate === null || rate === undefined || rate === "") return null;
  const value = Number(rate);
  if (!Number.isFinite(value)) return null;
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(value / 100);
}
