import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { isValidNearAccountId } from "./merchant-settings";

export const merchantSessionCookieName = "nearpay_merchant_session";

const sessionLifetimeSeconds = 60 * 60 * 24 * 30;

type MerchantSessionPayload = {
  accountId: string;
  expiresAt: number;
};

function getSessionSecret(): string {
  const secret =
    process.env.MERCHANT_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || secret.length < 32) {
    throw new Error(
      "Merchant sessions require MERCHANT_SESSION_SECRET or a configured Supabase service-role key.",
    );
  }
  return secret;
}

function signPayload(payload: string): Buffer {
  return createHmac("sha256", getSessionSecret()).update(payload).digest();
}

function readCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name === merchantSessionCookieName) {
      return valueParts.join("=") || null;
    }
  }
  return null;
}

export function getMerchantSessionAccountId(
  request: Request,
): string | null {
  const token = readCookie(request);
  if (!token) return null;

  const [encodedPayload, encodedSignature, ...extraParts] = token.split(".");
  if (!encodedPayload || !encodedSignature || extraParts.length > 0) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  try {
    const receivedSignature = Buffer.from(encodedSignature, "base64url");
    if (
      receivedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(receivedSignature, expectedSignature)
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<MerchantSessionPayload>;
    if (
      typeof payload.accountId !== "string" ||
      !isValidNearAccountId(payload.accountId) ||
      typeof payload.expiresAt !== "number" ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    return payload.accountId;
  } catch {
    return null;
  }
}

export function setMerchantSessionCookie(
  response: Response,
  accountId: string,
): void {
  const payload: MerchantSessionPayload = {
    accountId,
    expiresAt: Date.now() + sessionLifetimeSeconds * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = signPayload(encodedPayload).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  response.headers.append(
    "Set-Cookie",
    `${merchantSessionCookieName}=${encodedPayload}.${signature}; Path=/; Max-Age=${sessionLifetimeSeconds}; HttpOnly; SameSite=Strict${secure}`,
  );
}

export function clearMerchantSessionCookie(response: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${merchantSessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`,
  );
}
