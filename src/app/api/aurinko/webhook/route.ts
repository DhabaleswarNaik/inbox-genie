import { NextRequest } from "next/server";
import crypto from "crypto";
import Account from "@/lib/account";
import { db } from "@/server/db";
import { waitUntil } from "@vercel/functions";

const AURINKO_SIGNING_SECRET = process.env.AURINKO_SIGNING_SECRET;

export const POST = async (req: NextRequest) => {
  console.log("📩 Received webhook POST");

  // STEP 1 — Validation token for subscription handshake
  const query = req.nextUrl.searchParams;
  const validationToken = query.get("validationToken");
  if (validationToken) {
    console.log("🔐 Webhook validation handshake");
    return new Response(validationToken, { status: 200 });
  }

  // STEP 2 — Signature verification
  const timestamp = req.headers.get("X-Aurinko-Request-Timestamp");
  const signature = req.headers.get("X-Aurinko-Signature");
  const rawBody = await req.text();

  if (!timestamp || !signature || !rawBody || !AURINKO_SIGNING_SECRET) {
    console.error("❌ Missing required webhook headers");
    return new Response("Bad Request", { status: 400 });
  }

  const basestring = `v0:${timestamp}:${rawBody}`;
  const expectedSignature = crypto
    .createHmac("sha256", AURINKO_SIGNING_SECRET)
    .update(basestring)
    .digest("hex");

  if (signature !== expectedSignature) {
    console.error("❌ Webhook signature mismatch");
    return new Response("Unauthorized", { status: 401 });
  }

  // STEP 3 — Parse payload
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("❌ Invalid JSON payload");
    return new Response("Invalid JSON", { status: 400 });
  }

  console.log("📦 Webhook payload keys:", Object.keys(payload || {}));

  // STEP 4 — Validate accountId
  const accountId = payload?.accountId?.toString();
  if (!accountId) {
    console.error("❌ Missing accountId in payload");
    return new Response("Missing accountId", { status: 400 });
  }

  // STEP 5 — Load DB account
  const account = await db.account.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    console.error("❌ Account not found in DB");
    return new Response("Account not found", { status: 404 });
  }

  // FIX — Pass both token AND accountId to Account()
  const acc = new Account(account.token, accountId);

  // STEP 6 — Run sync in background
  waitUntil(
    acc
      .syncEmails()
      .then(() => console.log("✅ Background sync triggered via webhook"))
      .catch((err) => console.error("❌ Background sync error:", err))
  );

  return new Response(null, { status: 200 });
};
