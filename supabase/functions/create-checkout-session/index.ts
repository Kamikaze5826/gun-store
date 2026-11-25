import { z } from "npm:zod@4";
import { endpoint, HttpError, parseBody } from "../_shared/http.ts";
import { closeOpenSession, settleCheckout, stripeClient } from "../_shared/stripe.ts";
import { authenticate, checkDatabase, serviceClient } from "../_shared/supabase.ts";

const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,50}$/);
const address = z.strictObject({
  recipient: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^\+?[\d ()-]{7,24}$/),
  address_line: z.string().trim().min(1).max(250),
  country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  region_code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,24}$/),
  postal_code: z.string().trim().max(24).optional(),
});
const input = z.strictObject({
  request_id: z.uuid(),
  cart_items: z.array(z.strictObject({ variant_id: z.uuid(), quantity: z.int().min(1).max(1000) })).min(1).max(50),
  shipping_address: address,
  shop_voucher_codes: z.record(z.uuid(), code).default({}),
  platform_voucher_code: code.nullish().transform((value) => value ?? null),
  expected_total: z.int().nonnegative().max(999_999_999_999).optional(),
  expected_currency: z.string().regex(/^[A-Z]{3}$/).optional(),
}).refine((value) => (value.expected_total === undefined) === (value.expected_currency === undefined),
  "Provide both expected_total and expected_currency");
const holdResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), order_id: z.uuid(), expires_at: z.string(), currency: z.string(),
    total: z.int().nonnegative(), checkout_url: z.string().nullable() }),
  z.object({ ok: z.literal(false), code: z.string(), shortages: z.unknown().optional(), preview: z.unknown().optional() }),
]);

Deno.serve(endpoint(async (request) => {
  const { user } = await authenticate(request);
  const { request_id, expected_total, expected_currency, ...inputData } = await parseBody(request, input);
  const quoteInput = { ...inputData, cart_items: inputData.cart_items.sort((a, b) => a.variant_id.localeCompare(b.variant_id)) };
  const db = serviceClient();
  const quote = await db.rpc("calculate_order_preview", quoteInput);
  const appUrl = Deno.env.get("APP_URL");
  if (!appUrl || !Deno.env.get("STRIPE_SECRET_KEY")) {
    checkDatabase(quote.error);
    const shortages = quote.data?.shortages;
    if (Array.isArray(shortages) && shortages.length) throw new HttpError(409, "INSUFFICIENT_STOCK", { shortages });
    throw new HttpError(503, "CHECKOUT_PROVIDER_UNAVAILABLE");
  }
  const app = new URL(appUrl).origin;
  // The transaction recalculates after locking. It also handles retries against existing holds,
  // including the last voucher use which the first request already reserved.
  const reservation = await db.rpc("reserve_inventory", {
    ...quoteInput, buyer: user.id, request_id, expected_quote: {
      ...(quote.error ? {} : quote.data),
      ...(expected_total === undefined ? {} : { client_total: expected_total, client_currency: expected_currency }),
    },
  });
  checkDatabase(reservation.error);
  const hold = holdResult.parse(reservation.data);
  if (!hold.ok) throw new HttpError(hold.code === "TOO_MANY_CHECKOUTS" ? 429 : 409, hold.code,
    hold.shortages ? { shortages: hold.shortages } : hold.preview ? { preview: hold.preview } : undefined);
  if (hold.checkout_url) return { url: hold.checkout_url, order_id: hold.order_id, expires_at: hold.expires_at };

  const stripe = stripeClient();
  const orderId = hold.order_id;
  const session = await stripe.checkout.sessions.create({
    mode: "payment", payment_method_types: ["card"], client_reference_id: orderId,
    metadata: { marketplace_order_id: orderId },
    payment_intent_data: hold.total > 0 ? { metadata: { marketplace_order_id: orderId }, transfer_group: orderId } : undefined,
    // The hold expires in 15 minutes. Stripe's minimum is 30 minutes after Session creation.
    expires_at: Math.floor(new Date(hold.expires_at).getTime() / 1000) + 35 * 60,
    success_url: `${app}/orders?order=${orderId}`,
    cancel_url: `${app}/checkout?cancel=${orderId}`,
    line_items: [{ quantity: 1, price_data: {
      currency: hold.currency.toLowerCase(), unit_amount: hold.total,
      product_data: { name: `Gun Store · ${orderId.slice(0, 8)}` },
    } }],
  }, { idempotencyKey: `marketplace-checkout-${orderId}` });
  if (!session.url) {
    await settleCheckout(stripe, session);
    throw new HttpError(409, "CHECKOUT_CLOSED");
  }
  const attached = await db.rpc("attach_checkout_session", {
    target_order: orderId, session_id: session.id, session_url: session.url,
  });
  checkDatabase(attached.error, true);
  if (!attached.data) {
    const latest = await closeOpenSession(stripe, session.id);
    await settleCheckout(stripe, latest);
    throw new HttpError(409, "CHECKOUT_CLOSED");
  }
  return { url: session.url, order_id: orderId, expires_at: hold.expires_at };
}));
