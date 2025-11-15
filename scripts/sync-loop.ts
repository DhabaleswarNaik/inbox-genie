import { db } from '@/server/db';
import { syncEmailsToDatabase } from '@/lib/sync-to-db';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runSyncLoop = async () => {
  console.log('🔁 Starting email sync loop...');

  while (true) {
    try {
      const accounts = await db.account.findMany();

      for (const account of accounts) {
        console.log(`🔄 Syncing emails for account: ${account.id}`);
        await syncEmailsToDatabase([], account.id);
      }

      console.log(`✅ Sync complete at ${new Date().toISOString()}`);
    } catch (err) {
      console.error('❌ Error in sync loop:', err);
    }

    await sleep(1000); // wait for 1 second before next sync
  }
};

runSyncLoop();
