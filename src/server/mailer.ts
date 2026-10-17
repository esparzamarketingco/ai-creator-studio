import nodemailer from "nodemailer";
import { env } from "./env";

/** Sends email when SMTP_URL is configured; otherwise logs the message to the server console. */
export async function sendEmail(to: string, subject: string, text: string) {
  const e = env();
  if (!e.SMTP_URL) {
    if (e.NODE_ENV !== "test") console.info(`[email:not-configured] to=${to} subject="${subject}"\n${text}`);
    return { delivered: false as const };
  }
  const transport = nodemailer.createTransport(e.SMTP_URL);
  await transport.sendMail({ from: e.EMAIL_FROM, to, subject, text });
  return { delivered: true as const };
}
