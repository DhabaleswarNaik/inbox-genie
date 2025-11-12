'use client';

import { ModeToggle } from "@/components/theme-toggle";
import { UserButton } from "@clerk/nextjs";
import ComposeButton from "@/app/mail/components/compose-button";
import WebhookDebugger from "@/app/mail/components/webhook-debugger";

export default function BottomBar() {
  return (
    <div className="absolute bottom-4 left-4 z-50">
      <div className="flex items-center gap-4">
        <UserButton />
        <ModeToggle />
        <ComposeButton />
        {process.env.NODE_ENV === "development" && <WebhookDebugger />}
      </div>
    </div>
  );
}