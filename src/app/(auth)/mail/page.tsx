// ❌ REMOVE THIS
// 'use client';

import { Mail } from '@/app/mail/components/mail'
import { cookies } from 'next/headers'

export default async function MailPage() {
  const cookieStore = await cookies();

  const layout = cookieStore.get("react-resizable-panels:layout:mail")?.value;
  const collapsed = cookieStore.get("react-resizable-panels:collapsed")?.value;

  const defaultLayout = layout ? JSON.parse(layout) : undefined;
  const defaultCollapsed = collapsed ? JSON.parse(collapsed) : undefined;

  return (
    <>
      <div className="md:hidden">
        <img src="/examples/mail-dark.png" width={1280} height={727} alt="Mail" className="hidden dark:block" />
        <img src="/examples/mail-light.png" width={1280} height={727} alt="Mail" className="block dark:hidden" />
      </div>
      <div className="flex-col hidden md:flex h-screen overflow-scroll">
        <Mail
          defaultLayout={defaultLayout}
          defaultCollapsed={defaultCollapsed}
          navCollapsedSize={4}
        />
      </div>
    </>
  )
}
