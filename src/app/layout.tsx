// src/app/layout.tsx
import "../styles/globals.css"; // or "./globals.css" if it's in src/app/
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/components/theme-provider";
import localFont from "next/font/local";
import { TRPCReactProvider } from "@/trpc/react";

// ✅ Correct: load from /fonts (served from public/fonts)
const GeistSans = localFont({
  src: "/fonts/Geist-Regular.otf",
  variable: "--font-geist",
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
        <body>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <TRPCReactProvider>{children}</TRPCReactProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
