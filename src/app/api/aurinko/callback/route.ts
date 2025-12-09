import { getAurinkoToken, getAccountDetails } from "@/lib/aurinko";
import { db } from "@/server/db";
import { auth } from "@clerk/nextjs/server";
import axios from "axios";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Ensure user exists in DB BEFORE creating Account
  await db.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      role: "user",
      emailAddress: ""
    },
    update: {}
  });

  const params = req.nextUrl.searchParams;
  const status = params.get("status");

  if (status !== "success") {
    return NextResponse.json({ error: "ACCOUNT_CONNECTION_FAILED" }, { status: 400 });
  }

  const code = params.get("code");
  if (!code) {
    return NextResponse.json({ error: "MISSING_AUTH_CODE" }, { status: 400 });
  }

  console.log("🔁 Aurinko callback params:", {
    status,
    codePresent: !!code,
  });

  const token = await getAurinkoToken(code);

  if (!token) {
    return NextResponse.json({ error: "TOKEN_FETCH_FAILED" }, { status: 400 });
  }

  console.log("✅ Aurinko token response:", {
    accountId: token.accountId,
    hasAccessToken: !!token.accessToken,
    hasRefreshToken: !!token.refreshToken,
  });

  const details = await getAccountDetails(token.accessToken);

  if (!details) {
    return NextResponse.json({ error: "ACCOUNT_DETAILS_FAILED" }, { status: 400 });
  }

  const accountIdStr = String(token.accountId);

  await db.account.upsert({
  where: { id: String(token.accountId) },
  create: {
    id: String(token.accountId),
    userId,
    provider: "Aurinko",
    token: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + token.expiresIn,
    emailAddress: details.email,
    name: details.name,
  },
  update: {
    token: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + token.expiresIn,
  }
});


  console.log("✅ Account stored in DB:", accountIdStr);

  try {
    await axios.post(`${process.env.NEXT_PUBLIC_URL}/api/initial-sync`, {
      accountId: accountIdStr,
      userId,
    });
  } catch (err: any) {
    console.error("❌ Initial sync failed:", err.response?.data || err.message);
  }

  return NextResponse.redirect(new URL("/mail", req.url));
}
