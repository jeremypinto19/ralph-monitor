import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ success: true });

  response.cookies.set({
    name: auth.COOKIE_NAME,
    value: "",
    ...auth.cookieOptions,
    maxAge: 0,
  });

  return response;
}
