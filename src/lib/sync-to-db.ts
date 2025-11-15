import { db } from '@/server/db';
import type { EmailMessage, EmailAddress, EmailAttachment } from './types';
import pLimit from 'p-limit';
import { Prisma } from '@prisma/client';
import { OramaManager } from './orama';
import { getEmbeddings } from './embeddings';
import { turndown } from './turndown';

async function syncEmailsToDatabase(emails: EmailMessage[], accountId: string) {
  if (!emails || emails.length === 0) {
    console.log('📭 No emails to sync.');
    return;
  }

  console.log(`🔄 Syncing ${emails.length} emails to database for account ${accountId}`);

  const limit = pLimit(30);
  const oramaClient = new OramaManager(accountId);
  oramaClient.initialize();

  try {
    // Sync to Orama search
    const syncToOrama = async () => {
      await Promise.all(
        emails.map((email) =>
          limit(async () => {
            try {
              const body = turndown.turndown(email.body ?? email.bodySnippet ?? '');
              const payload = `From: ${email.from.name} <${email.from.address}>\nTo: ${email.to
                .map((t) => `${t.name} <${t.address}>`)
                .join(', ')}\nSubject: ${email.subject}\nBody: ${body}\nSentAt: ${new Date(
                email.sentAt
              ).toLocaleString()}`;
              const bodyEmbedding = await getEmbeddings(payload);

              await oramaClient.insert({
                title: email.subject,
                body: body,
                rawBody: email.bodySnippet ?? '',
                from: `${email.from.name} <${email.from.address}>`,
                to: email.to.map((t) => `${t.name} <${t.address}>`),
                sentAt: new Date(email.sentAt).toLocaleString(),
                embeddings: bodyEmbedding,
                threadId: email.threadId,
              });
            } catch (e) {
              console.error('❌ Orama insert error:', e);
            }
          })
        )
      );
    };

    const syncToDB = async () => {
      for (const [index, email] of emails.entries()) {
        await upsertEmail(email, index, accountId);
      }
    };

    await Promise.all([syncToOrama(), syncToDB()]);
    await oramaClient.saveIndex();
  } catch (error) {
    console.error('❌ Error in syncEmailsToDatabase:', error);
  }
}

async function upsertEmail(email: EmailMessage, index: number, accountId: string) {
  console.log(`📬 Upserting email ${index + 1}: ${email.subject}`);

  try {
    let emailLabelType: 'inbox' | 'sent' | 'draft' = 'inbox';

    if (email.sysLabels.includes('sent')) emailLabelType = 'sent';
    else if (email.sysLabels.includes('draft')) emailLabelType = 'draft';

    const addresses = [email.from, ...email.to, ...email.cc, ...email.bcc, ...email.replyTo];
    const uniqueAddresses = new Map(addresses.map((addr) => [addr.address, addr]));

    const upserted = await Promise.all(
      Array.from(uniqueAddresses.values()).map((address) =>
        upsertEmailAddress(address, accountId)
      )
    );

    const addressMap = new Map(upserted.filter(Boolean).map((addr) => [addr!.address, addr]));

    const fromAddress = addressMap.get(email.from.address);
    if (!fromAddress) {
      console.warn(`⚠️ Skipped email due to missing from address: ${email.id}`);
      return;
    }

    const toAddresses = email.to.map((a) => addressMap.get(a.address)).filter(Boolean);
    const ccAddresses = email.cc.map((a) => addressMap.get(a.address)).filter(Boolean);
    const bccAddresses = email.bcc.map((a) => addressMap.get(a.address)).filter(Boolean);
    const replyToAddresses = email.replyTo.map((a) => addressMap.get(a.address)).filter(Boolean);

    const thread = await db.thread.upsert({
      where: { id: email.threadId },
      update: {
        subject: email.subject,
        accountId,
        lastMessageDate: new Date(email.sentAt),
        done: false,
        participantIds: [
          fromAddress.id,
          ...toAddresses.map((a) => a!.id),
          ...ccAddresses.map((a) => a!.id),
          ...bccAddresses.map((a) => a!.id),
        ],
      },
      create: {
        id: email.threadId,
        subject: email.subject,
        accountId,
        lastMessageDate: new Date(email.sentAt),
        done: false,
        draftStatus: emailLabelType === 'draft',
        inboxStatus: emailLabelType === 'inbox',
        sentStatus: emailLabelType === 'sent',
        participantIds: [
          fromAddress.id,
          ...toAddresses.map((a) => a!.id),
          ...ccAddresses.map((a) => a!.id),
          ...bccAddresses.map((a) => a!.id),
        ],
      },
    });

    await db.email.upsert({
      where: { id: email.id },
      update: {
        subject: email.subject,
        sysLabels: email.sysLabels,
        threadId: thread.id,
        fromId: fromAddress.id,
        to: { set: toAddresses.map((a) => ({ id: a!.id })) },
        cc: { set: ccAddresses.map((a) => ({ id: a!.id })) },
        bcc: { set: bccAddresses.map((a) => ({ id: a!.id })) },
        replyTo: { set: replyToAddresses.map((a) => ({ id: a!.id })) },
        sentAt: new Date(email.sentAt),
        receivedAt: new Date(email.receivedAt),
        createdTime: new Date(email.createdTime),
        lastModifiedTime: new Date(),
        emailLabel: emailLabelType,
        body: email.body,
        bodySnippet: email.bodySnippet,
        internetMessageId: email.internetMessageId,
        internetHeaders: email.internetHeaders as any,
        inReplyTo: email.inReplyTo,
        references: email.references,
        keywords: email.keywords,
        sysClassifications: email.sysClassifications,
        sensitivity: email.sensitivity,
        meetingMessageMethod: email.meetingMessageMethod,
        threadIndex: email.threadIndex,
        nativeProperties: email.nativeProperties as any,
        hasAttachments: email.hasAttachments,
        folderId: email.folderId,
        omitted: email.omitted,
      },
      create: {
        id: email.id,
        threadId: thread.id,
        subject: email.subject,
        fromId: fromAddress.id,
        to: { connect: toAddresses.map((a) => ({ id: a!.id })) },
        cc: { connect: ccAddresses.map((a) => ({ id: a!.id })) },
        bcc: { connect: bccAddresses.map((a) => ({ id: a!.id })) },
        replyTo: { connect: replyToAddresses.map((a) => ({ id: a!.id })) },
        sentAt: new Date(email.sentAt),
        receivedAt: new Date(email.receivedAt),
        createdTime: new Date(email.createdTime),
        lastModifiedTime: new Date(),
        emailLabel: emailLabelType,
        body: email.body,
        bodySnippet: email.bodySnippet,
        internetMessageId: email.internetMessageId,
        internetHeaders: email.internetHeaders as any,
        inReplyTo: email.inReplyTo,
        references: email.references,
        keywords: email.keywords,
        sysClassifications: email.sysClassifications,
        sensitivity: email.sensitivity,
        meetingMessageMethod: email.meetingMessageMethod,
        threadIndex: email.threadIndex,
        nativeProperties: email.nativeProperties as any,
        hasAttachments: email.hasAttachments,
        folderId: email.folderId,
        omitted: email.omitted,
      },
    });

    const threadEmails = await db.email.findMany({
      where: { threadId: thread.id },
      orderBy: { receivedAt: 'asc' },
    });

    let threadFolderType: 'sent' | 'inbox' | 'draft' = 'sent';
    for (const threadEmail of threadEmails) {
      if (threadEmail.emailLabel === 'inbox') {
        threadFolderType = 'inbox';
        break;
      } else if (threadEmail.emailLabel === 'draft') {
        threadFolderType = 'draft';
      }
    }

    await db.thread.update({
      where: { id: thread.id },
      data: {
        inboxStatus: threadFolderType === 'inbox',
        draftStatus: threadFolderType === 'draft',
        sentStatus: threadFolderType === 'sent',
      },
    });

    for (const attachment of email.attachments ?? []) {
      await upsertAttachment(email.id, attachment);
    }
  } catch (error) {
    console.error(`❌ Failed to upsert email ${email.id}:`, error);
  }
}

async function upsertEmailAddress(address: EmailAddress, accountId: string) {
  try {
    const existing = await db.emailAddress.findUnique({
      where: { accountId_address: { accountId, address: address.address ?? '' } },
    });

    if (existing) {
      return await db.emailAddress.update({
        where: { id: existing.id },
        data: { name: address.name, raw: address.raw },
      });
    } else {
      return await db.emailAddress.create({
        data: { address: address.address ?? '', name: address.name, raw: address.raw, accountId },
      });
    }
  } catch (error) {
    console.error(`❌ Failed to upsert address ${address.address}:`, error);
    return null;
  }
}

async function upsertAttachment(emailId: string, attachment: EmailAttachment) {
  try {
    await db.emailAttachment.upsert({
      where: { id: attachment.id ?? '' },
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
  } catch (error) {
    console.error(`❌ Failed to upsert attachment ${attachment.id} on ${emailId}:`, error);
  }
}

export { syncEmailsToDatabase };
