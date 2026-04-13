import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { auth } from "@/lib/auth";

export async function POST(request: Request) {
  console.log("[LOGIN] Received login request");

  const { password } = await request.json();
  console.log("[LOGIN] Password received:", password !== undefined ? "yes" : "no");

  const expected = process.env.AUTH_PASSWORD;
  const secret = process.env.AUTH_SECRET;

  if (!expected || !secret) {
    console.error("[LOGIN] Auth not configured: Missing AUTH_PASSWORD or AUTH_SECRET");
    return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
  }

  const passwordBuffer = Buffer.from(String(password));
  const expectedBuffer = Buffer.from(expected);

  if (
    passwordBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(passwordBuffer, expectedBuffer)
  ) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const token = auth.sign(secret);
  const response = NextResponse.json({ success: true });

  response.cookies.set({
    name: auth.COOKIE_NAME,
    value: token,
    ...auth.cookieOptions,
  });

  console.log("[LOGIN] Login successful, auth cookie set");
  return response;
}
