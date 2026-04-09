import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "auth-token";
const PAYLOAD = "authenticated";

function sign(secret: string): string {
  return createHmac("sha256", secret).update(PAYLOAD).digest("hex");
}

function verify(token: string, secret: string): boolean {
  const expected = sign(secret);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export const auth = {
  COOKIE_NAME,
  sign,
  verify,
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  },
};
