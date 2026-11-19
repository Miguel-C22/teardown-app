import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "teardown_tech";
// Techs stay signed in for a work week on their phone
const SIGN_IN_DAYS = 7;
// Routes that work without signing in: health checks, signing in itself, and the bench PC script (it uses the pairing code)
const OPEN_ROUTES = ["/api/health", "/api/login", "/api/logout", "/api/me", "/api/hardware-reports"];

// Sign-in is on only when a team passcode is configured, so local runs and tests need nothing extra
export function signInRequired(): boolean {
  return !!process.env.TEAM_PASSCODE?.trim();
}

function signingSecret(): string {
  return process.env.SESSION_SECRET?.trim() || process.env.TEAM_PASSCODE!.trim();
}

function signature(value: string): string {
  return createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

function sameText(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

function readCookie(request: Request, name: string): string | null {
  for (const pair of (request.headers.cookie ?? "").split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex > 0 && pair.slice(0, separatorIndex).trim() === name) return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
  }
  return null;
}

// The cookie holds the tech's name and an expiry, signed so it can't be edited on the phone
export function signedInTech(request: Request): string | null {
  if (!signInRequired()) return null;
  const cookie = readCookie(request, COOKIE_NAME);
  if (!cookie) return null;
  const [encodedPayload, providedSignature] = cookie.split(".");
  if (!encodedPayload || !providedSignature || !sameText(signature(encodedPayload), providedSignature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as { name: string; expiresAt: number };
    return payload.expiresAt > Date.now() ? payload.name : null;
  } catch {
    return null;
  }
}

export function passcodeMatches(passcode: string): boolean {
  return signInRequired() && sameText(passcode.trim(), process.env.TEAM_PASSCODE!.trim());
}

export function setSignInCookie(response: Response, techName: string): void {
  const encodedPayload = Buffer.from(JSON.stringify({ name: techName, expiresAt: Date.now() + SIGN_IN_DAYS * 86_400_000 })).toString("base64url");
  const secure = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodedPayload}.${signature(encodedPayload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SIGN_IN_DAYS * 86_400}${secure ? "; Secure" : ""}`);
}

export function clearSignInCookie(response: Response): void {
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Blocks API calls from anyone not signed in, when sign-in is turned on
export function requireSignIn(request: Request, response: Response, next: NextFunction): void {
  if (!signInRequired() || !request.path.startsWith("/api/") || OPEN_ROUTES.some((route) => request.path === route)) {
    next();
    return;
  }
  if (signedInTech(request)) {
    next();
    return;
  }
  response.status(401).json({ error: "sign in required" });
}
