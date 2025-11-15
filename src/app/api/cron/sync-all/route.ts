import { db } from '@/server/db';
import Account from '@/lib/account';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const accounts = await db.account.findMany();

    for (const account of accounts) {
      if (!account.token) continue;
      const acc = new Account(account.token);
      await acc.syncEmails();
    }

    return new Response('Sync complete', { status: 200 });
  } catch (err) {
    console.error('Sync error:', err);
    return new Response('Sync failed', { status: 500 });
  }
}
