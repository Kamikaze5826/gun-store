import Stripe from "npm:stripe@18.5.0";
import { env, HttpError } from "./http.ts";
import { checkDatabase, serviceClient } from "./supabase.ts";

export { Stripe };

export function stripeClient() {
  return new Stripe(env("STRIPE_SECRET_KEY"), {
    httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2,
  });
}

export function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id ?? null;
}

export async function closeOpenSession(stripe: Stripe, sessionId: string) {
  const current = await stripe.checkout.sessions.retrieve(sessionId);
  if (current.status !== "open") return current;
  try {
    return await stripe.checkout.sessions.expire(sessionId);
  } catch (error) {
    const latest = await stripe.checkout.sessions.retrieve(sessionId);
    if (latest.status !== "open") return latest;
    throw error;
  }
}

export async function recordRefund(refund: Stripe.Refund) {
  const requestId = refund.metadata?.refund_request_id;
  const attempt = Number(refund.metadata?.refund_attempt);
  if (!requestId || !Number.isSafeInteger(attempt) || attempt < 1) return null;
  const { data, error } = await serviceClient().rpc("record_refund_result", {
    target_request: requestId, attempt, stripe_id: refund.id, stripe_status: refund.status,
    amount: refund.amount, currency: refund.currency, payment_intent: stripeId(refund.payment_intent),
  });
  checkDatabase(error, true);
  return data;
}

export async function recordLateRefund(refund: Stripe.Refund) {
  const orderId = refund.metadata?.marketplace_order_id;
  const intentId = stripeId(refund.payment_intent);
  if (!orderId || !intentId || refund.metadata?.automatic_late_payment !== "true") return;
  let update = serviceClient().from("orders").update({
    late_refund_id: refund.id, late_refund_status: refund.status ?? "pending", checkout_closed_at: new Date().toISOString(),
  }).eq("id", orderId).eq("late_payment_intent_id", intentId);
  if (refund.status !== "succeeded") {
    update = update.or("late_refund_status.is.null,late_refund_status.in.(pending,requires_action)");
  }
  const { error } = await update;
  checkDatabase(error, true);
  if (refund.status === "failed" || refund.status === "canceled") {
    console.error("Late payment refund requires reconciliation", orderId, refund.id);
  }
}

export async function settleCheckout(stripe: Stripe, session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.marketplace_order_id;
  if (!orderId || !["paid", "no_payment_required"].includes(session.payment_status)) return;
  const intentId = stripeId(session.payment_intent);
  const payment = intentId ? await stripe.paymentIntents.retrieve(intentId) : null;
  if (payment && payment.status !== "succeeded") throw new HttpError(500, "PAYMENT_NOT_SETTLED");
  const db = serviceClient();
  const { data, error } = await db.rpc("confirm_inventory_deduction", {
    order_id: orderId, checkout_session_id: session.id, payment_intent_id: intentId,
    charge_id: stripeId(payment?.latest_charge), amount: session.amount_total, currency: session.currency,
  });
  checkDatabase(error, true);
  if (data === "late" && intentId) {
    const latest = await db.from("orders").select("late_refund_id").eq("id", orderId).single();
    checkDatabase(latest.error, true);
    if (latest.data?.late_refund_id) return;
    // Stripe expires idempotency keys. Recover an existing refund by payment intent as well.
    const refunds = await stripe.refunds.list({ payment_intent: intentId, limit: 100 });
    const existing = refunds.data.find((entry) => entry.metadata?.marketplace_order_id === orderId
      && entry.metadata.automatic_late_payment === "true");
    const refund = existing ?? await stripe.refunds.create({
      payment_intent: intentId, metadata: { marketplace_order_id: orderId, automatic_late_payment: "true" },
    }, { idempotencyKey: `marketplace-late-${intentId}` });
    await recordLateRefund(await stripe.refunds.retrieve(refund.id));
  }
}
