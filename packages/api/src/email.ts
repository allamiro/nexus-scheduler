import nodemailer from "nodemailer";
import { decryptSecret } from "@nexus-scheduler/shared";
import { prisma } from "./db.js";
import type { AppConfig } from "./config.js";

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super("SMTP is not configured — set it in Admin Settings before sending email");
    this.name = "SmtpNotConfiguredError";
  }
}

// One-shot transporter per send rather than a long-lived cached one —
// SMTP settings can change at any time via the admin UI, and email
// volume here (password resets, eventually job notifications, §2.2) is
// low enough that reconnecting per send costs nothing that matters.
export async function sendEmail(
  config: AppConfig,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!settings?.smtpHost || !settings.smtpPort || !settings.smtpFromAddress) {
    throw new SmtpNotConfiguredError();
  }

  const auth =
    settings.smtpUsername && settings.smtpEncryptedPassword
      ? {
          user: settings.smtpUsername,
          pass: decryptSecret(settings.smtpEncryptedPassword, config.API_KEY_ENCRYPTION_KEY),
        }
      : undefined;

  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth,
  });

  await transporter.sendMail({
    from: settings.smtpFromAddress,
    to,
    subject,
    text,
  });
}
