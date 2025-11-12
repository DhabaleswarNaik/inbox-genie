// src/lib/stripe.ts
import Stripe from "stripe";

// ✅ Replace this with your real secret key (keep it in .env)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-11-20",
});

// Export it so other modules can import and reuse
export { stripe };
