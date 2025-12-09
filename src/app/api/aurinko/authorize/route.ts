import { NextResponse } from "next/server";
import { getAurinkoAuthorizationUrl } from "@/lib/aurinko";

export async function POST(req: Request) {
  try {
    const { serviceType } = await req.json();
    console.log("📤 Service Type Received:", serviceType);

    const url = await getAurinkoAuthorizationUrl(serviceType);
    console.log("✅ Generated URL:", url);

    return NextResponse.json({ url });
  } catch (err: any) {
    console.error("❌ API Error in /aurinko/authorize:", err.message || err);
    return NextResponse.json(
      { error: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}
