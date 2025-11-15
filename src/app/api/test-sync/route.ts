// src/app/api/test-sync/route.ts

/*import { db } from "@/server/db";
import Account from "@/lib/account";
import { syncEmailsToDatabase } from "@/lib/sync-to-db";
import { type NextRequest, NextResponse } from "next/server";
import axios from "axios";

export const GET = async (req: NextRequest) => {
  try {
    const testUserId = "user_350G7HzNXBcCgKdjskYtjQ2CtYT"; 
    const testAccountId = 159204;// Replace with an actual userId
    const dbAccount = await db.account.findFirst({
      where: { userId: testUserId },
    });

    if (!dbAccount) {
      console.log("❌ No account found for test user.");
      return NextResponse.json({ error: "ACCOUNT_NOT_FOUND" }, { status: 404 });
    }

    const account = new Account(dbAccount.token);

    console.log("🔁 Starting initial sync via `performInitialSync`...");
    const result = await account.performInitialSync();

    if (!result || !result.emails || !Array.isArray(result.emails)) {
      console.error("🚨 Sync returned no emails or invalid format.", result);
      return NextResponse.json({ error: "NO_EMAILS_RETURNED" }, { status: 500 });
    }

    console.log(`📥 ${result.emails.length} emails fetched. Starting DB sync...`);
    await syncEmailsToDatabase(result.emails, dbAccount.id);
    console.log("✅ Emails synced to database");

    console.log("💾 Updating delta token...");
    await db.account.update({
      where: { id: dbAccount.id },
      data: {
        nextDeltaToken: result.deltaToken,
      },
    });

    return NextResponse.json({ success: true, emailCount: result.emails.length }, { status: 200 });

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("🌐 Axios Error:", JSON.stringify(error.response?.data, null, 2));
    } else if (error instanceof Error) {
      console.error("🔥 Error:", error.message);
    } else {
      console.error("❓ Unknown error occurred during sync:", error);
    }

    return NextResponse.json({ error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
};*/
/**
 * test-sync/route.ts - Diagnostics route for syncing emails (last 100 days) and logging issues.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { syncEmailsToDatabase } from '@/lib/sync-to-db';

const API_BASE_URL = 'https://api.aurinko.io/v1';

export const GET = async (req: NextRequest) => {
    console.log('✅ Starting test-sync for all accounts at', new Date().toISOString());
    try {
        const accounts = await db.account.findMany();
        console.log(`🔍 Found ${accounts.length} account(s) to sync.`);
        if (accounts.length === 0) {
            console.log('⚠️ No accounts found to sync.');
            return NextResponse.json({ success: true, message: 'No accounts to sync' });
        }

        // Define date range for last 100 days
        const now = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 100);

        for (const account of accounts) {
            const accountId = account.id;
            console.log(`\n---\n📧 [Account ${accountId}] Begin sync diagnostics for account`);
            // Log token presence
            if (!account.token) {
                console.error(`❌ [Account ${accountId}] No auth token found. Skipping account.`);
                continue;
            }
            console.log(`🔑 [Account ${accountId}] Found auth token: ${account.token.substring(0, 10)}...`);

            // Log existing delta token (if any)
            if (account.nextDeltaToken) {
                console.log(`🔄 [Account ${accountId}] Existing nextDeltaToken: ${account.nextDeltaToken}`);
            } else {
                console.log(`ℹ️ [Account ${accountId}] No existing nextDeltaToken (initial sync).`);
            }

            try {
                // Start sync for last 100 days
                const syncUrl = `${API_BASE_URL}/email/sync?daysWithin=100&bodyType=html`;
                console.log(`📤 [Account ${accountId}] Sending POST to start sync: ${syncUrl}`);
                const syncRes = await fetch(syncUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${account.token}` }
                });
                if (!syncRes.ok) {
                    console.error(`❌ [Account ${accountId}] Aurinko /sync start responded with status ${syncRes.status}`);
                    continue;
                }
                let syncData = await syncRes.json();
                console.log(`🔄 [Account ${accountId}] Sync start response ready: ${syncData.ready}`);
                let syncReady = syncData.ready;
                let attempts = 0;
                // Wait for sync to be ready if not immediately
                while (!syncReady && attempts < 10) {
                    console.log(`⏳ [Account ${accountId}] Sync not ready. Waiting... (attempt ${attempts + 1})`);
                    await new Promise(res => setTimeout(res, 1000));
                    const resAttempt = await fetch(syncUrl, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${account.token}` }
                    });
                    if (!resAttempt.ok) {
                        console.error(`❌ [Account ${accountId}] Aurinko /sync start responded with status ${resAttempt.status} during retry`);
                        break;
                    }
                    syncData = await resAttempt.json();
                    syncReady = syncData.ready;
                    attempts++;
                }
                if (!syncReady) {
                    console.error(`❌ [Account ${accountId}] Sync did not become ready after ${attempts} attempts. Skipping account.`);
                    continue;
                }
                console.log(`✅ [Account ${accountId}] Sync is ready. syncUpdatedToken: ${syncData.syncUpdatedToken}, syncDeletedToken: ${syncData.syncDeletedToken}`);

                // Fetch updated emails using deltaToken from syncData.syncUpdatedToken
                const updatedUrl = `${API_BASE_URL}/email/sync/updated`;
                let deltaToken = syncData.syncUpdatedToken;
                let allEmails: any[] = [];
                let pageToken: string | undefined = undefined;
                let storedDeltaToken = deltaToken;
                let pageCount = 0;

                // Fetch pages of updated emails
                do {
                    let url = updatedUrl;
                    if (pageCount === 0) {
                        url = `${updatedUrl}?deltaToken=${encodeURIComponent(deltaToken)}`;
                    } else {
                        url = `${updatedUrl}?pageToken=${encodeURIComponent(pageToken!)}`;
                    }
                    console.log(`📥 [Account ${accountId}] GET ${url}`);
                    const pageRes = await fetch(url, {
                        headers: { 'Authorization': `Bearer ${account.token}` }
                    });
                    if (!pageRes.ok) {
                        console.error(`❌ [Account ${accountId}] Aurinko /sync/updated returned status ${pageRes.status}`);
                        break;
                    }
                    const pageData = await pageRes.json();
                    const records = pageData.records || [];
                    console.log(`📄 [Account ${accountId}] Retrieved ${records.length} email(s) in page ${pageCount + 1}. NextPageToken: ${pageData.nextPageToken ? 'yes' : 'no'}, NextDeltaToken: ${pageData.nextDeltaToken || 'no'}`);
                    // Append emails
                    allEmails.push(...records);
                    // Update next tokens
                    if (pageData.nextDeltaToken) {
                        storedDeltaToken = pageData.nextDeltaToken;
                    }
                    // Prepare for next iteration
                    if (pageData.nextPageToken) {
                        pageToken = pageData.nextPageToken;
                        pageCount++;
                        if (pageCount > 50) {
                            console.error(`❌ [Account ${accountId}] Page count exceeded limit. Possible pagination issue.`);
                            break;
                        }
                    } else {
                        break;
                    }
                } while (true);

                console.log(`🔢 [Account ${accountId}] Total emails fetched: ${allEmails.length}`);

                // If no emails fetched, warn
                if (allEmails.length === 0) {
                    console.warn(`⚠️ [Account ${accountId}] No emails fetched. Check if account has no emails or if there's a sync issue.`);
                }

                // Highlight missing dates in last 100 days
                const emailDates = new Set<string>();
                allEmails.forEach(email => {
                    // Determine date string for each email (YYYY-MM-DD)
                    const dateStr = new Date(email.sentAt).toISOString().split('T')[0];
                    emailDates.add(dateStr);
                });
                const missingDates: string[] = [];
                for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    if (!emailDates.has(dateStr)) {
                        missingDates.push(dateStr);
                    }
                }
                if (missingDates.length > 0) {
                    console.warn(`⚠️ [Account ${accountId}] No emails found on dates: ${missingDates.join(', ')}`);
                } else {
                    console.log(`✅ [Account ${accountId}] Emails cover all dates in the last 100 days (no gaps detected).`);
                }

                // Sync emails to database
                console.log(`⬇️ [Account ${accountId}] Calling syncEmailsToDatabase with ${allEmails.length} emails...`);
                await syncEmailsToDatabase(allEmails, accountId);
                console.log(`✅ [Account ${accountId}] syncEmailsToDatabase completed.`);

                // After syncing, check total count in DB for last 100 days
                try {
                    const dbCount = await db.email.count({
                        where: {
                            accountId: accountId,
                            sentAt: { gte: startDate }
                        }
                    });
                    console.log(`📊 [Account ${accountId}] Database has ${dbCount} emails dated within last 100 days.`);
                    if (dbCount < allEmails.length) {
                        console.warn(`⚠️ [Account ${accountId}] Database count (${dbCount}) is less than fetched emails (${allEmails.length}).`);
                    } else if (dbCount > allEmails.length) {
                        console.warn(`⚠️ [Account ${accountId}] Database count (${dbCount}) is greater than fetched emails (${allEmails.length}). Check for duplicates or previously synced emails.`);
                    } else {
                        console.log(`✅ [Account ${accountId}] Database count matches fetched email count (${dbCount}).`);
                    }
                } catch (countErr) {
                    console.error(`❌ [Account ${accountId}] Failed to count emails in DB:`, countErr);
                }

            } catch (accountError) {
                console.error(`❌ [Account ${accountId}] Sync failed with error:`, accountError);
            }
        }
        console.log('✅ test-sync complete for all accounts.');
        return NextResponse.json({ success: true, accountsProcessed: accounts.length });
    } catch (err) {
        console.error('❌ Unexpected error in test-sync route:', err);
        return NextResponse.json({ error: 'Test sync failed' }, { status: 500 });
    }
};

