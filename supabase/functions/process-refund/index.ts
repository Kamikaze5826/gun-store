import { z } from "npm:zod@4";
import { endpoint, HttpError, parseBody } from "../_shared/http.ts";
import { authenticate, checkDatabase, serviceClient } from "../_shared/supabase.ts";
import { closeOpenSession, recordRefund, settleCheckout, stripeClient } from "../_shared/stripe.ts";

const input = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("approve"), refund_request_id: z.uuid() }),
  z.strictObject({ action: z.literal("cancel_pending"), order_id: z.uuid() }),
]);
const refundJob = z.union([
  z.object({ status: z.literal("refunded"), stripe_refund_id: z.string().nullable() }),
  z.object({ status: z.enum(["seller_approved", "admin_resolved"]), stripe_refund_id: z.string().nullable(),
    payment_intent: z.string().nullable(), amount: z.int().nonnegative(),
    currency: z.string(), attempt: z.int().positive() }),
]);

Deno.serve(endpoint(async (request) => {
  const { user } = await authenticate(request);
  const payload = await parseBody(request, input);
  const db = serviceClient();
  const stripe = stripeClient();
  if (payload.action === "cancel_pending") {
    const { data, error } = await db.rpc("buyer_pending_checkout", { target_order: payload.order_id, actor: user.id });
    checkDatabase(error);
    const order = z.object({ checkout_session_id: z.string().nullable(), status: z.string() }).nullable().parse(data);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND");
    if (["cancelled", "failed"].includes(order.status)) return { status: "cancelled" };
    if (order.status !== "pending") throw new HttpError(409, "ORDER_ALREADY_PAID");
    if (order.checkout_session_id) {
      const session = await closeOpenSession(stripe, order.checkout_session_id);
      if (session.status !== "expired") {
        await settleCheckout(stripe, session);
        throw new HttpError(409, "CHECKOUT_ALREADY_COMPLETED");
      }
    }
    const release = await db.rpc("release_expired_inventory", {
      target_order: payload.order_id, release_reason: "cancelled", checkout_session_id: order.checkout_session_id,
    });
    checkDatabase(release.error, true);
    if (!release.data) {
      const latest = await db.rpc("buyer_pending_checkout", { target_order: payload.order_id, actor: user.id });
      checkDatabase(latest.error);
      if (!["cancelled", "failed"].includes(latest.data?.status)) throw new HttpError(409, "ORDER_ALREADY_PAID");
    }
    return { status: "cancelled" };
  }
  const { data, error } = await db.rpc("begin_refund", { target_request: payload.refund_request_id, actor: user.id });
  checkDatabase(error);
  const job = refundJob.parse(data);
  if (job.status === "refunded") return job;
  if (job.amount === 0) {
    const result = await db.rpc("record_refund_result", {
      target_request: payload.refund_request_id, attempt: job.attempt, stripe_id: null, stripe_status: "succeeded",
      amount: 0, currency: job.currency, payment_intent: job.payment_intent,
    });
    checkDatabase(result.error, true);
    return { status: result.data, stripe_refund_id: null };
  }
  if (!job.payment_intent) throw new HttpError(500, "PAYMENT_NOT_FOUND");
  const refund = job.stripe_refund_id ? await stripe.refunds.retrieve(job.stripe_refund_id)
    : await stripe.refunds.create({
      payment_intent: job.payment_intent, amount: job.amount,
      metadata: { refund_request_id: payload.refund_request_id, refund_attempt: String(job.attempt) },
    }, { idempotencyKey: `marketplace-refund-${payload.refund_request_id}-${job.attempt}` });
  return { status: await recordRefund(refund), stripe_refund_id: refund.id };
}));
