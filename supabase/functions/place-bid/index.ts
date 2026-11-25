import { z } from "npm:zod@4";
import { endpoint, HttpError, parseBody } from "../_shared/http.ts";
import { authenticate } from "../_shared/supabase.ts";

const input = z.strictObject({ product_id: z.uuid(), amount: z.int().min(1).max(999_999_999_999) });

Deno.serve(endpoint(async (request) => {
  const { client } = await authenticate(request);
  const { product_id, amount } = await parseBody(request, input);
  const { data, error } = await client.rpc("place_bid", { target_product: product_id, bid_amount: amount });
  if (error?.code === "22023") throw new HttpError(409, "BID_REJECTED", { message: error.message });
  if (error?.code === "42501") throw new HttpError(403, "BID_FORBIDDEN");
  if (error) throw new HttpError(500, "BID_FAILED");
  return { bid_id: data };
}));
