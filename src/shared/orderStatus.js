/*
 * Online order statuses shared by the staff ERP and the storefront.
 * Identical in supermarket-erp/src/shared and supermarket-storefront/src/shared;
 * run `node scripts/check-shared-ui.mjs` from the repository root after editing.
 *
 * Staff and customers see the same states (backend OnlineOrderStatus) with the same
 * tone. Both apps are French: staff labels are operational, customer labels are
 * written to the shopper ("Prête au retrait").
 */

export const ORDER_STATUSES = {
  PENDING_PAYMENT: {
    tone: "warning",
    staff: "En attente de paiement",
    customer: "En attente de paiement",
    customerHint: "Vos articles sont réservés. Payez avant l’échéance pour confirmer la commande.",
  },
  CONFIRMED: {
    tone: "info",
    staff: "Confirmée",
    customer: "Commande confirmée",
    customerHint: "Paiement reçu. Le magasin va bientôt préparer votre commande.",
  },
  PREPARING: {
    tone: "info",
    staff: "En préparation",
    customer: "En préparation",
    customerHint: "Un membre de l’équipe prépare vos courses.",
  },
  READY: {
    tone: "success",
    staff: "Prête au retrait",
    customer: "Prête au retrait",
    customerHint: "Présentez votre code de retrait au comptoir du magasin.",
  },
  COMPLETED: {
    tone: "neutral",
    staff: "Remise au client",
    customer: "Retirée",
    customerHint: "Merci pour votre commande.",
  },
  CANCELLED: {
    tone: "danger",
    staff: "Annulée",
    customer: "Annulée",
    customerHint: "Cette commande a été annulée et ses articles ont été remis en rayon.",
  },
  EXPIRED: {
    tone: "danger",
    staff: "Expirée",
    customer: "Paiement expiré",
    customerHint: "Le paiement n’a pas été effectué à temps, la réservation a été libérée.",
  },
};

/** The happy path both surfaces display as a progress indicator. */
export const ORDER_PROGRESS = ["CONFIRMED", "PREPARING", "READY", "COMPLETED"];

/** Staff workflow: the only forward transitions a staff member triggers with a button. */
export const STAFF_NEXT_STATUS = { CONFIRMED: "PREPARING", PREPARING: "READY" };

export function orderStatus(status) {
  return ORDER_STATUSES[status] || { tone: "neutral", staff: status || "—", customer: status || "Inconnu", customerHint: "" };
}

/** Returns "done" | "current" | "todo" for each progress step, or null when the order left the happy path. */
export function orderProgress(status) {
  const index = ORDER_PROGRESS.indexOf(status);
  if (index === -1) return null;
  return ORDER_PROGRESS.map((step, stepIndex) => ({
    status: step,
    state: stepIndex < index || status === "COMPLETED" ? "done" : stepIndex === index ? "current" : "todo",
  }));
}
