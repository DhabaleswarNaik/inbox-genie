import type { EmailHeader, EmailMessage, SyncResponse, SyncUpdatedResponse } from '@/lib/types';
import { db } from '@/server/db';
import axios from 'axios';
import { syncEmailsToDatabase } from './sync-to-db';

const API_BASE_URL = 'https://api.aurinko.io/v1';

class Account {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async startSync(daysWithin: number): Promise<SyncResponse> {
    const response = await axios.post<SyncResponse>(
      `${API_BASE_URL}/email/sync`,
      {},
      {
        headers: { Authorization: `Bearer ${this.token}` },
        params: {
          daysWithin,
          bodyType: 'html',
        },
      }
    );
    return response.data;
  }

  async createSubscription() {
    const webhookUrl =
      process.env.NODE_ENV === 'development'
        ? 'https://potatoes-calculator-reports-crisis.trycloudflare.com'
        : process.env.NEXT_PUBLIC_URL;

    const res = await axios.post(
      `${API_BASE_URL}/subscriptions`,
      {
        resource: '/email/messages',
        notificationUrl: webhookUrl + '/api/aurinko/webhook',
      },
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return res.data;
  }

  async syncEmails() {
    const account = await db.account.findUnique({
      where: { token: this.token },
    });

    if (!account) {
      console.error('❌ syncEmails: Invalid token');
      throw new Error('Invalid token');
    }

    if (!account.nextDeltaToken) {
      console.warn('⚠️ syncEmails: No delta token');
      return;
    }

    let response = await this.getUpdatedEmails({ deltaToken: account.nextDeltaToken });
    let allEmails: EmailMessage[] = response.records || [];
    let storedDeltaToken = account.nextDeltaToken;

    if (response.nextDeltaToken) {
      storedDeltaToken = response.nextDeltaToken;
    }

    while (response.nextPageToken) {
      response = await this.getUpdatedEmails({ pageToken: response.nextPageToken });
      allEmails = allEmails.concat(response.records || []);
      if (response.nextDeltaToken) {
        storedDeltaToken = response.nextDeltaToken;
      }
    }

    console.log(`📨 syncEmails: ${allEmails.length} emails to sync`);
    if (!allEmails.length) {
      console.log('📭 No new emails to sync');
    } else {
      try {
        await syncEmailsToDatabase(allEmails, account.id);
      } catch (error) {
        console.error('❌ Error syncing emails to DB:', error);
      }
    }

    await db.account.update({
      where: { id: account.id },
      data: { nextDeltaToken: storedDeltaToken },
    });
  }

  async getUpdatedEmails({
    deltaToken,
    pageToken,
  }: {
    deltaToken?: string;
    pageToken?: string;
  }): Promise<SyncUpdatedResponse> {
    const params: Record<string, string> = {};
    if (deltaToken) params.deltaToken = deltaToken;
    if (pageToken) params.pageToken = pageToken;

    const response = await axios.get<SyncUpdatedResponse>(
      `${API_BASE_URL}/email/sync/updated`,
      {
        params,
        headers: { Authorization: `Bearer ${this.token}` },
      }
    );
    return response.data;
  }

  async performInitialSync() {
    try {
      const daysWithin = 100;
      let syncResponse = await this.startSync(daysWithin);

      while (!syncResponse.ready) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        syncResponse = await this.startSync(daysWithin);
      }

      let storedDeltaToken: string = syncResponse.syncUpdatedToken;
      let updatedResponse = await this.getUpdatedEmails({
        deltaToken: syncResponse.syncUpdatedToken,
      });

      if (updatedResponse.nextDeltaToken) {
        storedDeltaToken = updatedResponse.nextDeltaToken;
      }

      let allEmails: EmailMessage[] = updatedResponse.records || [];

      while (updatedResponse.nextPageToken) {
        updatedResponse = await this.getUpdatedEmails({
          pageToken: updatedResponse.nextPageToken,
        });
        allEmails = allEmails.concat(updatedResponse.records || []);
        if (updatedResponse.nextDeltaToken) {
          storedDeltaToken = updatedResponse.nextDeltaToken;
        }
      }

      return {
        emails: allEmails,
        deltaToken: storedDeltaToken,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('🛑 Initial sync Axios error:', JSON.stringify(error.response?.data, null, 2));
      } else {
        console.error('🛑 Error during initial sync:', error);
      }
    }
  }

  async sendEmail({
    from,
    subject,
    body,
    inReplyTo,
    references,
    threadId,
    to,
    cc,
    bcc,
    replyTo,
  }: {
    from: EmailAddress;
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
    to: EmailAddress[];
    cc?: EmailAddress[];
    bcc?: EmailAddress[];
    replyTo?: EmailAddress;
  }) {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/email/messages`,
        {
          from,
          subject,
          body,
          inReplyTo,
          references,
          threadId,
          to,
          cc,
          bcc,
          replyTo: [replyTo],
        },
        {
          params: { returnIds: true },
          headers: { Authorization: `Bearer ${this.token}` },
        }
      );

      console.log('📤 Email sent', response.data);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('❌ Send email error:', JSON.stringify(error.response?.data, null, 2));
      } else {
        console.error('❌ Send email unexpected error:', error);
      }
      throw error;
    }
  }

  async getWebhooks() {
    const res = await axios.get(`${API_BASE_URL}/subscriptions`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
    return res.data;
  }

  async createWebhook(resource: string, notificationUrl: string) {
    const res = await axios.post(
      `${API_BASE_URL}/subscriptions`,
      { resource, notificationUrl },
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return res.data;
  }

  async deleteWebhook(subscriptionId: string) {
    const res = await axios.delete(`${API_BASE_URL}/subscriptions/${subscriptionId}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
    return res.data;
  }
}

type EmailAddress = {
  name: string;
  address: string;
};

export default Account;
