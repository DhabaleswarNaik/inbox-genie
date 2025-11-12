'use client';

import dynamic from 'next/dynamic';
import { UserButton } from "@clerk/nextjs";
import { ModeToggle } from "@/components/theme-toggle";
import ComposeButton from "@/app/mail/components/compose-button";
import WebhookDebugger from "@/app/mail/components/webhook-debugger";

const MailPage = dynamic(() => import('@/app/mail/index'), {
  loading: () => <div>Loading...</div>,
  ssr: false,
});

export default function MailPageClientWrapper() {
  return (
    <>
      <div className="absolute bottom-4 left-4">
        <div className="flex items-center gap-4">
          <UserButton />
          <ModeToggle />
          <ComposeButton />
          {process.env.NODE_ENV === 'development' && (
            <WebhookDebugger />
          )}
        </div>
      </div>
      <MailPage />
    </>
  );
}
