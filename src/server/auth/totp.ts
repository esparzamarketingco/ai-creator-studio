import { authenticator } from "otplib";
import { decryptSecret, encryptSecret } from "../crypto";

authenticator.options = { window: 1 };

export function newTotpSecret() {
  const secret = authenticator.generateSecret();
  return { secret, enc: encryptSecret(secret) };
}

export function totpUri(email: string, secret: string) {
  return authenticator.keyuri(email, "AI Creator Studio", secret);
}

export function verifyTotp(code: string, secretEnc: string): boolean {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  return authenticator.check(clean, decryptSecret(secretEnc));
}

export const currentTotp = (secret: string) => authenticator.generate(secret);
