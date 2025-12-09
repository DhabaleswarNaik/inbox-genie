'use server'

import { auth } from '@clerk/nextjs/server';
import { getSubscriptionStatus } from './stripe-actions';
import { db } from '@/server/db';
import { FREE_ACCOUNTS_PER_USER, PRO_ACCOUNTS_PER_USER } from '@/app/constants';

export const getAurinkoAuthorizationUrl = async (serviceType: 'Google' | 'Office365') => {
    const { userId } = await auth();
    if (!userId) throw new Error('User not found');

    // Ensure user exists
    await db.user.upsert({
        where: { id: userId },
        create: {
            id: userId,
            role: 'user',
            emailAddress: ''
        },
        update: {}
    });

    const isSubscribed = await getSubscriptionStatus();
    const accounts = await db.account.count({ where: { userId } });

    if (!isSubscribed && accounts >= FREE_ACCOUNTS_PER_USER) {
        throw new Error('You have reached the maximum number of accounts');
    }
    if (isSubscribed && accounts >= PRO_ACCOUNTS_PER_USER) {
        throw new Error('You have reached the maximum number of accounts');
    }

    // ✅ FIX 1 — CORRECT PARAM NAME
    // ❌ scopes=
    // ✅ scope=

    // ✅ FIX 2 — USE AURINKO SCOPES, NOT MICROSOFT GRAPH SCOPES
    const scope = "email email.read email.modify";

    const params = new URLSearchParams({
        clientId: process.env.AURINKO_CLIENT_ID!,
        serviceType,
        responseType: "code",
        scope,
        returnUrl: `${process.env.NEXT_PUBLIC_URL}/api/aurinko/callback`
    });

    return `https://api.aurinko.io/v1/auth/authorize?${params.toString()}`;
};
