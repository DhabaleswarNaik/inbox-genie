// ✅ Load environment variables from .env before validation
import "dotenv/config";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * 🧠 Server-side environment variables
   * These are never exposed to the client.
   */
  server: {
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * 🌐 Client-side environment variables
   * Add public vars prefixed with NEXT_PUBLIC_ here if needed.
   */
  client: {
    // Example:
    // NEXT_PUBLIC_API_URL: z.string().url(),
  },

  /**
   * ⚙️ Runtime environment mapping
   * Maps actual environment variables to validation schema.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    // NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },

  /**
   * 🛠️ Skip validation if SKIP_ENV_VALIDATION=1 is set
   * Useful for Docker or CI/CD builds where .env isn’t yet loaded.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  /**
   * 🧹 Treat empty strings as undefined
   * So `SOME_VAR=''` fails validation.
   */
  emptyStringAsUndefined: true,
});
