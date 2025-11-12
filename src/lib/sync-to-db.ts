import { db } from '@/server/db';
import type { EmailMessage, EmailAttachment, EmailAddress } from './types';
import pLimit from 'p-limit';
import { Prisma } from '@prisma/client';
import { OramaManager } from './orama';
import { getEmbeddings } from './embeddings';
import { turndown } from './turndown';

export async function syncEmailsToDatabase(emails: EmailMessage[], accountId: string) {
    console.log(`\n🔁 Syncing ${emails.length} emails to database for account: ${accountId}`);

    const limit = pLimit(10);
    const oramaClient = new OramaManager(accountId);
    oramaClient.initialize();

    async function syncToOrama() {
        await Promise.all(emails.map(email => limit(async () => {
            const body = turndown.turndown(email.body ?? email.bodySnippet ?? '')
            const payload = `From: ${email.from.name} <${email.from.address}>\nTo: ${email.to.map(t => `${t.name} <${t.address}>`).join(', ')}\nSubject: ${email.subject}\nBody: ${body}\n SentAt: ${new Date(email.sentAt).toLocaleString()}`
            const bodyEmbedding = await getEmbeddings(payload);
            await oramaClient.insert({
                title: email.subject,
                body: body,
                rawBody: email.bodySnippet ?? '',
                from: `${email.from.name} <${email.from.address}>`,
                to: email.to.map(t => `${t.name} <${t.address}>`),
                sentAt: new Date(email.sentAt).toLocaleString(),
                embeddings: bodyEmbedding,
                threadId: email.threadId
            })
        })))
    }

    async function syncToDB() {
        for (const [index, email] of emails.entries()) {
            console.log(`\n[${index + 1}/${emails.length}] ▶ Upserting: ${email.subject}`);
            await upsertEmail(email, index, accountId);
        }
    }

    try {
        await Promise.all([syncToOrama(), syncToDB()]);
        await oramaClient.saveIndex();
        console.log('✅ Sync to DB and Orama complete');
    } catch (err) {
        console.error('❌ Error during sync:', err);
    }
}

async function upsertEmail(email: EmailMessage, index: number, accountId: string) {
    try {
        let emailLabelType: 'inbox' | 'sent' | 'draft' = 'inbox';
        if (email.sysLabels.includes('sent')) emailLabelType = 'sent';
        else if (email.sysLabels.includes('draft')) emailLabelType = 'draft';

        const addressesToUpsert = new Map();
        for (const address of [email.from, ...email.to, ...email.cc, ...email.bcc, ...email.replyTo]) {
            addressesToUpsert.set(address.address, address);
        }

        const upsertedAddresses: (Awaited<ReturnType<typeof upsertEmailAddress>> | null)[] = [];
        for (const address of addressesToUpsert.values()) {
            const upserted = await upsertEmailAddress(address, accountId);
            upsertedAddresses.push(upserted);
        }

        const addressMap = new Map(upsertedAddresses.filter(Boolean).map(a => [a!.address, a]));
        const fromAddress = addressMap.get(email.from.address);
        if (!fromAddress) {
            console.warn(`⚠ Failed to upsert 'from' address for: ${email.subject}`);
            return;
        }

        const toAddresses = email.to.map(addr => addressMap.get(addr.address)).filter(Boolean);
        const ccAddresses = email.cc.map(addr => addressMap.get(addr.address)).filter(Boolean);
        const bccAddresses = email.bcc.map(addr => addressMap.get(addr.address)).filter(Boolean);
        const replyToAddresses = email.replyTo.map(addr => addressMap.get(addr.address)).filter(Boolean);

        const thread = await db.thread.upsert({
            where: { id: email.threadId },
            update: {
                subject: email.subject,
                accountId,
                lastMessageDate: new Date(email.sentAt),
                participantIds: [...new Set([fromAddress.id, ...toAddresses.map(a => a!.id), ...ccAddresses.map(a => a!.id), ...bccAddresses.map(a => a!.id)])]
            },
            create: {
                id: email.threadId,
                accountId,
                subject: email.subject,
                lastMessageDate: new Date(email.sentAt),
                draftStatus: emailLabelType === 'draft',
                inboxStatus: emailLabelType === 'inbox',
                sentStatus: emailLabelType === 'sent',
                done: false,
                participantIds: [...new Set([fromAddress.id, ...toAddresses.map(a => a!.id), ...ccAddresses.map(a => a!.id), ...bccAddresses.map(a => a!.id)])]
            }
        });

        await db.email.upsert({
            where: { id: email.id },
            update: {
                threadId: thread.id,
                createdTime: new Date(email.createdTime),
                lastModifiedTime: new Date(),
                sentAt: new Date(email.sentAt),
                receivedAt: new Date(email.receivedAt),
                internetMessageId: email.internetMessageId,
                subject: email.subject,
                sysLabels: email.sysLabels,
                keywords: email.keywords,
                sysClassifications: email.sysClassifications,
                sensitivity: email.sensitivity,
                meetingMessageMethod: email.meetingMessageMethod,
                fromId: fromAddress.id,
                to: { set: toAddresses.map(a => ({ id: a!.id })) },
                cc: { set: ccAddresses.map(a => ({ id: a!.id })) },
                bcc: { set: bccAddresses.map(a => ({ id: a!.id })) },
                replyTo: { set: replyToAddresses.map(a => ({ id: a!.id })) },
                hasAttachments: email.hasAttachments,
                internetHeaders: email.internetHeaders as any,
                body: email.body,
                bodySnippet: email.bodySnippet,
                inReplyTo: email.inReplyTo,
                references: email.references,
                threadIndex: email.threadIndex,
                nativeProperties: email.nativeProperties as any,
                folderId: email.folderId,
                omitted: email.omitted,
                emailLabel: emailLabelType,
            },
            create: {
                id: email.id,
                emailLabel: emailLabelType,
                threadId: thread.id,
                createdTime: new Date(email.createdTime),
                lastModifiedTime: new Date(),
                sentAt: new Date(email.sentAt),
                receivedAt: new Date(email.receivedAt),
                internetMessageId: email.internetMessageId,
                subject: email.subject,
                sysLabels: email.sysLabels,
                internetHeaders: email.internetHeaders as any,
                keywords: email.keywords,
                sysClassifications: email.sysClassifications,
                sensitivity: email.sensitivity,
                meetingMessageMethod: email.meetingMessageMethod,
                fromId: fromAddress.id,
                to: { connect: toAddresses.map(a => ({ id: a!.id })) },
                cc: { connect: ccAddresses.map(a => ({ id: a!.id })) },
                bcc: { connect: bccAddresses.map(a => ({ id: a!.id })) },
                replyTo: { connect: replyToAddresses.map(a => ({ id: a!.id })) },
                hasAttachments: email.hasAttachments,
                body: email.body,
                bodySnippet: email.bodySnippet,
                inReplyTo: email.inReplyTo,
                references: email.references,
                threadIndex: email.threadIndex,
                nativeProperties: email.nativeProperties as any,
                folderId: email.folderId,
                omitted: email.omitted,
            }
        });

        for (const attachment of email.attachments) {
            if (!attachment.id) {
                console.warn(`⚠ Skipping attachment with missing ID for email ${email.id}`);
                continue;
            }
            await upsertAttachment(email.id, attachment);
        }
    } catch (err) {
        console.error(`❌ Failed upserting email ${email.subject}`, err);
    }
}

async function upsertEmailAddress(address: EmailAddress, accountId: string) {
    try {
        const existing = await db.emailAddress.findUnique({
            where: { accountId_address: { accountId, address: address.address ?? '' } },
        });
        if (existing) {
            return db.emailAddress.update({
                where: { id: existing.id },
                data: { name: address.name, raw: address.raw },
            });
        }
        return db.emailAddress.create({
            data: { address: address.address ?? '', name: address.name, raw: address.raw, accountId },
        });
    } catch (err) {
        console.warn(`⚠ Error upserting email address ${address.address}:`, err);
        return null;
    }
}

async function upsertAttachment(emailId: string, attachment: EmailAttachment) {
    try {
        await db.emailAttachment.upsert({
            where: { id: attachment.id },
            update: {
                name: attachment.name,
                mimeType: attachment.mimeType,
                size: attachment.size,
                inline: attachment.inline,
                contentId: attachment.contentId,
                content: attachment.content,
                contentLocation: attachment.contentLocation,
            },
            create: {
                id: attachment.id,
                emailId,
                name: attachment.name,
                mimeType: attachment.mimeType,
                size: attachment.size,
                inline: attachment.inline,
                contentId: attachment.contentId,
                content: attachment.content,
                contentLocation: attachment.contentLocation,
            },
        });
    } catch (err) {
        console.warn(`⚠ Failed to upsert attachment:`, err);
    }
}
