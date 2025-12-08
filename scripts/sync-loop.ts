import { db } from '@/server/db';
import Account from '@/lib/account';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runSyncLoop = async () => {
  console.log('🔁 Starting email sync loop...');

  while (true) {
    try {
      const accounts = await db.account.findMany();

      for (const account of accounts) {
        if (!account.token) {
          console.log(`⚠️ Account ${account.id} has no token, skipping`);
          continue;
        }

        const accountInstance = new Account(account.token);
        console.log(`🔄 Syncing emails for account: ${account.id}`);
        try {
          await accountInstance.syncEmails();
        } catch (syncError) {
          console.error(`❌ Failed to sync account ${account.id}:`, syncError);
        }
      }

      console.log(`✅ Sync cycle complete at ${new Date().toISOString()}`);
    } catch (err) {
      console.error('❌ Error in sync loop:', err);
    }

    await sleep(5000); // wait for 5 seconds before next sync cycle
  }
};

runSyncLoop();
