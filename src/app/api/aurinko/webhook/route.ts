import { NextRequest } from "next/server";
import crypto from "crypto";
import Account from "@/lib/account";
import { db } from "@/server/db";
import { waitUntil } from "@vercel/functions";

const AURINKO_SIGNING_SECRET = process.env.AURINKO_SIGNING_SECRET;

export const POST = async (req: NextRequest) => {
  console.log("📩 Received webhook POST");

  const query = req.nextUrl.searchParams;
  const validationToken = query.get("validationToken");
  if (validationToken) {
    console.log("🔐 Validating webhook endpoint");
    return new Response(validationToken, { status: 200 });
  }

  const timestamp = req.headers.get("X-Aurinko-Request-Timestamp");
  const signature = req.headers.get("X-Aurinko-Signature");
  const rawBody = await req.text();

  if (!timestamp || !signature || !rawBody || !AURINKO_SIGNING_SECRET) {
    console.error("❌ Missing required headers or body");
    return new Response("Bad Request", { status: 400 });
  }

  const basestring = `v0:${timestamp}:${rawBody}`;
  const expectedSignature = crypto
    .createHmac("sha256", AURINKO_SIGNING_SECRET)
    .update(basestring)
    .digest("hex");

  if (signature !== expectedSignature) {
    console.error("❌ Invalid webhook signature");
    return new Response("Unauthorized", { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("❌ Invalid JSON payload");
    return new Response("Invalid JSON", { status: 400 });
  }

  console.log("✅ Webhook validated. Processing sync...");

  const accountId = payload?.accountId?.toString();
  if (!accountId) {
    return new Response("Missing accountId", { status: 400 });
  }

  const account = await db.account.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    console.error("❌ Account not found for webhook payload");
    return new Response("Account not found", { status: 404 });
  }

  const acc = new Account(account.token);

  waitUntil(
    acc.syncEmails().then(() => {
      console.log("✅ Background email sync triggered by webhook");
    }).catch((err) => {
      console.error("❌ Error in background sync:", err);
    })
  );

  return new Response(null, { status: 200 });
};
