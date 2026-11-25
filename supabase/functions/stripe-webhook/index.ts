import { z } from "npm:zod@4";
import { endpoint, env, HttpError } from "../_shared/http.ts";
import { closeOpenSession, recordLateRefund, recordRefund, settleCheckout, Stripe, stripeClient } from "../_shared/stripe.ts";
import { checkDatabase, serviceClient } from "../_shared/supabase.ts";

const envelope = z.object({ id: z.string(), type: z.string(), data: z.object({ object: z.object({ id: z.string() }) }) });

Deno.serve(endpoint(async (request) => {
  const signature = request.headers.get("stripe-signature");
  if (!signature) throw new HttpError(400, "STRIPE_SIGNATURE_REQUIRED");
  const stripe = stripeClient();
  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, env("STRIPE_WEBHOOK_SECRET"),
      undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    throw new HttpError(400, "INVALID_STRIPE_SIGNATURE");
  }
  if (!envelope.safeParse(event).success) throw new HttpError(400, "INVALID_STRIPE_EVENT");
  const db = serviceClient();
  async function release(orderId: string, sessionId: string, reason: string) {
    const { error } = await db.rpc("release_expired_inventory", {
      target_order: orderId, checkout_session_id: sessionId, release_reason: reason,
    });
    checkDatabase(error, true);
  }
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await settleCheckout(stripe, event.data.object);
      break;
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object;
      const orderId = session.metadata?.marketplace_order_id;
      if (orderId) await release(orderId, session.id,
        event.type === "checkout.session.expired" ? "stripe_expired" : "payment_failed");
      break;
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object;
      const orderId = intent.metadata.marketplace_order_id;
      if (!orderId) break;
      const latestIntent = await stripe.paymentIntents.retrieve(intent.id);
      if (!["requires_payment_method", "canceled"].includes(latestIntent.status)) break;
      const sessions = await stripe.checkout.sessions.list({ payment_intent: intent.id, limit: 1 });
      const session = sessions.data[0];
      if (!session || session.metadata?.marketplace_order_id !== orderId) break;
      const current = await closeOpenSession(stripe, session.id);
      if (current.status === "expired") await release(orderId, current.id, "payment_failed");
      else if (current.payment_status === "paid") await settleCheckout(stripe, current);
      break;
    }
    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      const refund = event.data.object;
      if (refund.metadata?.refund_request_id) await recordRefund(await stripe.refunds.retrieve(refund.id));
      if (refund.metadata?.automatic_late_payment) await recordLateRefund(await stripe.refunds.retrieve(refund.id));
      break;
    }
  }
  return { received: true };
}));
