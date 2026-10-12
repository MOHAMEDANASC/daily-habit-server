import "server-only";
import nodemailer from "nodemailer";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Send an email through the configured SMTP server.
 *
 * Without SMTP_HOST nothing can be delivered: in development the message is printed to the
 * server console (handy for password-reset links); in production an error is logged.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const env = getEnv();

  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === "production") {
      logger.error("SMTP is not configured; email was not sent", { subject: message.subject });
      return false;
    }
    console.info(`\n--- Email (SMTP not configured; development only) ---\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n---\n`);
    return true;
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });

  try {
    await transport.sendMail({ from: env.SMTP_FROM, ...message });
    return true;
  } catch (error) {
    logger.error("Failed to send email", { subject: message.subject, error });
    return false;
  }
}

export function passwordResetEmail(name: string, link: string): Pick<MailMessage, "subject" | "text" | "html"> {
  const safeName = name.replace(/[<>&"]/g, "");
  return {
    subject: "Reset your Habit Tracker password",
    text: `Hi ${safeName},\n\nWe received a request to reset your password. Open this link within 60 minutes to choose a new one:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email; your password will stay the same.`,
    html: `<p>Hi ${safeName},</p><p>We received a request to reset your password. This link works for 60 minutes:</p><p><a href="${link}">Choose a new password</a></p><p>If you didn't ask for this, you can ignore this email; your password will stay the same.</p>`,
  };
}
