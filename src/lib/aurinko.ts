"use server";

import axios from "axios";
import type { EmailMessage } from "./types";

const AURINKO_BASE = "https://api.aurinko.io/v1";

/**
 * Build Aurinko OAuth Authorization URL
 * Uses proper Aurinko scopes + correct `scopes` param
 */
export async function getAurinkoAuthorizationUrl(
  serviceType: "Google" | "Office365"
) {
  // Aurinko Gmail scopes (official)
  const scopes = [
    "email",
    "email.read",
    "email.modify"
  ].join(" ");

  const params = new URLSearchParams({
    clientId: process.env.AURINKO_CLIENT_ID!,
    serviceType,
    responseType: "code",
    scope: scopes, // IMPORTANT: singular, not plural
    returnUrl: `${process.env.NEXT_PUBLIC_URL}/api/aurinko/callback`,
  });

  return `${AURINKO_BASE}/auth/authorize?${params.toString()}`;
}


/**
 * Exchange authorization code for accessToken + refreshToken
 * Uses /auth/token/{code} with HTTP Basic as per docs
 */
export async function getAurinkoToken(code: string) {
  console.log("🔍 getAurinkoToken: received code =", code);

  const clientId = process.env.AURINKO_CLIENT_ID;
  const clientSecret = process.env.AURINKO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("❌ Missing AURINKO_CLIENT_ID or AURINKO_CLIENT_SECRET");
    return null;
  }

  try {
    const url = `${AURINKO_BASE}/auth/token/${code}`;

    const response = await axios.post(
      url,
      {},
      {
        auth: {
          username: clientId,
          password: clientSecret,
        },
      }
    );

    console.log("✅ Aurinko token response:", {
      accountId: response.data?.accountId,
      hasAccessToken: !!response.data?.accessToken,
      hasRefreshToken: !!response.data?.refreshToken,
    });

    return response.data as {
      accountId: number;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      userId: string;
      userSession: string;
    };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error(
        "❌ Error fetching Aurinko token:",
        error.response?.data || error.message
      );
    } else {
      console.error("❌ Unknown error fetching Aurinko token:", error);
    }
    return null;
  }
}

/**
 * Refresh the token using refreshToken
 */
export async function refreshAurinkoToken(refreshToken: string) {
  try {
    const params = new URLSearchParams({
      clientId: process.env.AURINKO_CLIENT_ID as string,
      clientSecret: process.env.AURINKO_CLIENT_SECRET as string,
      grantType: "refresh_token",
      refreshToken,
    });

    const response = await axios.post(`${AURINKO_BASE}/auth/token`, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    return {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken ?? refreshToken,
      expiresIn: response.data.expiresIn,
    };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error(
        "❌ Error refreshing Aurinko token:",
        error.response?.data || error.message
      );
    } else {
      console.error("❌ Unknown error refreshing Aurinko token:", error);
    }
    throw new Error("Failed to refresh Aurinko token");
  }
}

/**
 * Fetch user account details from Aurinko
 */
export async function getAccountDetails(accessToken: string) {
  try {
    const response = await axios.get(`${AURINKO_BASE}/account`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return response.data as {
      email: string;
      name: string;
    };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error(
        "❌ Error fetching account details:",
        error.response?.data || error.message
      );
    } else {
      console.error("❌ Unknown error fetching account details:", error);
    }
    return null;
  }
}

/**
 * Fetch an individual email by ID
 */
export async function getEmailDetails(accessToken: string, emailId: string) {
  try {
    const response = await axios.get<EmailMessage>(
      `${AURINKO_BASE}/email/messages/${emailId}`,
      {
        params: { loadInlines: true },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return response.data;
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error(
        "❌ Error fetching email details:",
        error.response?.data || error.message
      );
    } else {
      console.error("❌ Unknown error fetching email details:", error);
    }
    throw error;
  }
}
