import { timingSafeEqual } from "node:crypto";
import { z } from "npm:zod@4";
import { endpoint, env, HttpError, parseBody } from "../_shared/http.ts";
import { closeOpenSession, settleCheckout, stripeClient } from "../_shared/stripe.ts";
import { checkDatabase, serviceClient } from "../_shared/supabase.ts";

Deno.serve(endpoint(async (request) => {
  const encoder = new TextEncoder();
  const expected = encoder.encode(env("MARKETPLACE_MAINTENANCE_SECRET"));
  const supplied = encoder.encode(request.headers.get("x-marketplace-maintenance") ?? "");
  if (expected.length < 32 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new HttpError(401, "MAINTENANCE_AUTH_REQUIRED");
  }
  await parseBody(request, z.strictObject({}));
  const db = serviceClient();
  const stripe = stripeClient();
  const { data, error } = await db.from("orders").select("id,stripe_checkout_session_id")
    .in("payment_status", ["cancelled", "failed"]).is("checkout_closed_at", null)
    .not("stripe_checkout_session_id", "is", null).not("checkout_key", "is", null).order("expires_at").limit(40);
  checkDatabase(error, true);
  let failures = 0;
  let closed = 0;
  const work = data ?? [];
  for (let offset = 0; offset < work.length; offset += 4) {
    const batch = await Promise.allSettled(work.slice(offset, offset + 4).map(async (order) => {
      const session = await closeOpenSession(stripe, order.stripe_checkout_session_id);
      await settleCheckout(stripe, session);
      const updated = await db.from("orders").update({ checkout_closed_at: new Date().toISOString() })
        .eq("id", order.id).eq("stripe_checkout_session_id", session.id);
      checkDatabase(updated.error, true);
    }));
    for (const entry of batch) {
      if (entry.status === "fulfilled") closed += 1;
      else failures += 1;
    }
  }
  if (failures) console.error("Checkout reconciliation will retry", failures);
  return { closed, failures };
}));
