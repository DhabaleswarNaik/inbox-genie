import Account from "@/lib/account";
import { syncEmailsToDatabase } from "@/lib/sync-to-db";
import { db } from "@/server/db";
import { type NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { accountId, userId } = body;

    if (!accountId || !userId) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    const dbAccount = await db.account.findUnique({
      where: {
        id: accountId,
        userId,
      },
    });

    if (!dbAccount) {
      return NextResponse.json({ error: "ACCOUNT_NOT_FOUND" }, { status: 404 });
    }

    const account = new Account(dbAccount.token);

    console.log("🌐 Creating webhook subscription...");
    await account.createSubscription();

    console.log("🚀 Starting initial email sync (100 days)...");

    const response = await account.performInitialSync(100); // <- daysWithin = 100

    if (!response) {
      return NextResponse.json({ error: "FAILED_TO_SYNC" }, { status: 500 });
    }

    const { deltaToken, emails } = response;

    if (!Array.isArray(emails)) {
      return NextResponse.json({ error: "NO_EMAILS_RETURNED" }, { status: 500 });
    }

    console.log(`📥 Syncing ${emails.length} emails to database...`);
    await syncEmailsToDatabase(emails, accountId);

    await db.account.update({
      where: {
        id: accountId,
      },
      data: {
        nextDeltaToken: deltaToken,
      },
    });

    console.log("✅ Initial sync complete");
    return NextResponse.json({ success: true, deltaToken }, { status: 200 });
  } catch (error) {
    console.error("❌ Initial sync error:", error);
    return NextResponse.json({ error: "UNEXPECTED_ERROR" }, { status: 500 });
  }
};
