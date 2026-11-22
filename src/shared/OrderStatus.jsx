/*
 * Order status badge and progress indicator shared by the staff ERP and the storefront.
 * Identical in supermarket-erp/src/shared and supermarket-storefront/src/shared;
 * run `node scripts/check-shared-ui.mjs` from the repository root after editing.
 */
import { orderProgress, orderStatus } from "./orderStatus.js";

/** audience: "staff" (operational wording) or "customer" (wording written to the shopper). Both are French. */
export function OrderStatusBadge({ status, audience = "staff", className = "" }) {
  const meta = orderStatus(status);
  return (
    <span className={`status-badge ${className}`.trim()} data-tone={meta.tone} data-status={status}>
      {audience === "customer" ? meta.customer : meta.staff}
    </span>
  );
}

/** Confirmed → preparing → ready → collected. Renders nothing for unpaid, cancelled or expired orders. */
export function OrderProgress({ status, audience = "staff", label }) {
  const steps = orderProgress(status);
  if (!steps) return null;
  const words = audience === "customer" ? "customer" : "staff";
  return (
    <ol className="order-progress" aria-label={label || "Avancement de la commande"}>
      {steps.map((step) => (
        <li key={step.status} data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
          {orderStatus(step.status)[words]}
        </li>
      ))}
    </ol>
  );
}
