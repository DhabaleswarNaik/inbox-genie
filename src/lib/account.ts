import axios from "axios";
import { db } from "@/server/db";
import { refreshAurinkoToken } from "./aurinko";
import { syncEmailsToDatabase } from "./sync-to-db";
import type {
  EmailMessage,
  SyncResponse,
  SyncUpdatedResponse,
} from "@/lib/types";

const API_BASE_URL = "https://api.aurinko.io/v1";

type EmailAddress = {
  name: string;
  address: string;
};

class Account {
  private token: string;
  private accountId: string;

  constructor(token: string, accountId: string) {
    this.token = token;
    this.accountId = accountId;
  }

  private async startSync(daysWithin: number): Promise<SyncResponse> {
    const response = await axios.post<SyncResponse>(
      `${API_BASE_URL}/email/sync`,
      {},
      {
        headers: { Authorization: `Bearer ${this.token}` },
        params: {
          daysWithin,
          bodyType: "html",
        },
      }
    );

    return response.data;
  }

  async createSubscription() {
    // For local dev you should expose your app via ngrok/cloudflare and put
    // that URL into an env like AURINKO_WEBHOOK_URL.
    const baseUrl =
      process.env.AURINKO_WEBHOOK_URL ?? process.env.NEXT_PUBLIC_URL;

    if (!baseUrl) {
      throw new Error(
        "AURINKO_WEBHOOK_URL or NEXT_PUBLIC_URL must be set for webhooks"
      );
    }

    const notificationUrl = `${baseUrl}/api/webhooks/aurinko`;

    const res = await axios.post(
      `${API_BASE_URL}/subscriptions`,
      {
        resource: "/email/messages",
        notificationUrl,
      },
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.data;
  }

  /**
   * Main incremental sync entrypoint (used by webhooks / cron).
   * - Ensures token is fresh
   * - Uses nextDeltaToken
   * - Writes emails to DB
   * - Updates nextDeltaToken
   */
  async syncEmails() {
    // Prefer lookup by accountId; fall back to token for safety
    let account =
      (await db.account.findUnique({ where: { id: this.accountId } })) ??
      (await db.account.findUnique({ where: { token: this.token } }));

    if (!account) {
      console.error("❌ syncEmails: Account not found");
      throw new Error("Account not found");
    }

    // Refresh if expiring within 5 minutes
    if (
      account.refreshToken &&
      account.expiresAt &&
      account.expiresAt < Date.now() / 1000 + 300
    ) {
      try {
        console.log("🔄 Refreshing expired/expiring token...");
        const newToken = await refreshAurinkoToken(account.refreshToken);
        account = await db.account.update({
          where: { id: account.id },
          data: {
            token: newToken.accessToken,
            refreshToken: newToken.refreshToken,
            expiresAt: Math.floor(Date.now() / 1000) + newToken.expiresIn,
          },
        });
        this.token = newToken.accessToken;
        console.log("✅ Token refreshed");
      } catch (error) {
        console.error("❌ Failed to refresh token:", error);
      }
    }

    // If no delta token yet → do full initial sync
    if (!account.nextDeltaToken) {
      console.warn("⚠️ syncEmails: No delta token, performing initial sync");
      const initResponse = await this.performInitialSync();
      if (!initResponse) return;

      const { emails, deltaToken } = initResponse;

      await syncEmailsToDatabase(emails, account.id);
      await db.account.update({
        where: { id: account.id },
        data: { nextDeltaToken: deltaToken },
      });

      return;
    }

    // Otherwise perform delta sync
    let response: SyncUpdatedResponse | undefined;

    try {
      response = await this.getUpdatedEmails({
        deltaToken: account.nextDeltaToken ?? undefined,
      });
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response) {
        if (error.response.status === 401) {
          console.warn(
            "⚠️ syncEmails: Access token invalid (401), trying refresh..."
          );

          if (account.refreshToken) {
            try {
              const newToken = await refreshAurinkoToken(account.refreshToken);
              account = await db.account.update({
                where: { id: account.id },
                data: {
                  token: newToken.accessToken,
                  refreshToken: newToken.refreshToken,
                  expiresAt: Math.floor(Date.now() / 1000) + newToken.expiresIn,
                },
              });
              this.token = newToken.accessToken;

              // Retry once
              response = await this.getUpdatedEmails({
                deltaToken: account.nextDeltaToken ?? undefined,
              });
            } catch (refreshErr) {
              console.error(
                "❌ Failed to refresh token on 401 in syncEmails:",
                refreshErr
              );
              throw error;
            }
          } else {
            console.error("❌ No refresh token available for 401");
            throw error;
          }
        } else if (error.response.status === 410) {
          console.warn(
            "⚠️ syncEmails: Delta token invalid/expired (410), re-running initial sync"
          );
          const initResponse = await this.performInitialSync();
          if (!initResponse) return;

          const { emails, deltaToken } = initResponse;

          await syncEmailsToDatabase(emails, account.id);
          await db.account.update({
            where: { id: account.id },
            data: { nextDeltaToken: deltaToken },
          });

          return;
        }
      }

      console.error("❌ syncEmails: Error fetching updated emails", error);
      throw error;
    }

    if (!response) {
      console.warn("⚠️ syncEmails: No response from getUpdatedEmails");
      return;
    }

    let allEmails: EmailMessage[] = response.records || [];
    let storedDeltaToken = account.nextDeltaToken;

    if (response.nextDeltaToken) {
      storedDeltaToken = response.nextDeltaToken;
    }

    while (response.nextPageToken) {
      try {
        response = await this.getUpdatedEmails({
          pageToken: response.nextPageToken,
        });

        allEmails = allEmails.concat(response.records || []);
        if (response.nextDeltaToken) {
          storedDeltaToken = response.nextDeltaToken;
        }
      } catch (error) {
        console.error("❌ syncEmails: Error fetching next page", error);
        break;
      }
    }

    console.log(`📨 syncEmails: ${allEmails.length} emails to sync`);

    if (allEmails.length) {
      try {
        await syncEmailsToDatabase(allEmails, account.id);
      } catch (error) {
        console.error("❌ Error syncing emails to DB:", error);
      }
    } else {
      console.log("📭 No new emails to sync");
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

  /**
   * Initial full sync over last N days.
   * Returns all emails + final deltaToken.
   */
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
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.error(
          "🛑 Initial sync Axios error:",
          JSON.stringify(error.response?.data, null, 2)
        );
      } else {
        console.error("🛑 Error during initial sync:", error);
      }
      return null;
    }
  }

  /**
   * Send an email, with token refresh + retry on 401.
   */
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
    const doSend = async () => {
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
          replyTo: replyTo ? [replyTo] : undefined,
        },
        {
          params: { returnIds: true },
          headers: { Authorization: `Bearer ${this.token}` },
        }
      );

      return response.data;
    };

    try {
      const data = await doSend();
      console.log("📤 Email sent", data);
      return data;
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.warn(
          "⚠️ sendEmail: Access token invalid (401), trying refresh..."
        );

        let account =
          (await db.account.findUnique({ where: { id: this.accountId } })) ??
          (await db.account.findUnique({ where: { token: this.token } }));

        if (account?.refreshToken) {
          try {
            const newToken = await refreshAurinkoToken(account.refreshToken);
            await db.account.update({
              where: { id: account.id },
              data: {
                token: newToken.accessToken,
                refreshToken: newToken.refreshToken,
                expiresAt: Math.floor(Date.now() / 1000) + newToken.expiresIn,
              },
            });

            this.token = newToken.accessToken;

            const data = await doSend();
            console.log("📤 Email sent (after refresh)", data);
            return data;
          } catch (refreshError) {
            console.error(
              "❌ Failed to refresh token during sendEmail:",
              refreshError
            );
          }
        }
      }

      if (axios.isAxiosError(error)) {
        console.error(
          "❌ Send email error:",
          JSON.stringify(error.response?.data, null, 2)
        );
      } else {
        console.error("❌ Send email unexpected error:", error);
      }

      throw error;
    }
  }

  async getWebhooks() {
    const res = await axios.get(`${API_BASE_URL}/subscriptions`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
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
          "Content-Type": "application/json",
        },
      }
    );

    return res.data;
  }

  async deleteWebhook(subscriptionId: string) {
    const res = await axios.delete(
      `${API_BASE_URL}/subscriptions/${subscriptionId}`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.data;
  }
}

export default Account;
