import { Router } from "express";
import { updateAppSettingsSchema, encryptSecret } from "@nexus-scheduler/shared";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";
import { recordAuditEvent } from "../audit.js";
import { sendEmail, SmtpNotConfiguredError } from "../email.js";
import type { AppConfig } from "../config.js";

const SETTINGS_ID = 1; // singleton row, enforced here rather than a real sequence

const PUBLIC_FIELDS = {
  productName: true,
  logoUrl: true,
  primaryColor: true,
  classificationBannerText: true,
  classificationBannerBgColor: true,
  classificationBannerTextColor: true,
} as const;

export function createSettingsRouter(config: AppConfig): Router {
  const router = Router();

  async function getOrCreateSettings() {
    return prisma.appSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID }, update: {} });
  }

  // Branding (§5) and the system-wide classification banner (§6) —
  // deliberately unauthenticated, since the banner has to render before/
  // independent of login resolving. Never includes SMTP config: that's
  // internal infrastructure detail (host, username, and — even
  // encrypted — password ciphertext) with no business being public.
  router.get("/", async (_req, res) => {
    const settings = await prisma.appSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID },
      update: {},
      select: PUBLIC_FIELDS,
    });
    res.json(settings);
  });

  // Full settings for the admin panel, including SMTP — password
  // presence only (`smtpPasswordSet`), never the ciphertext itself.
  router.get("/admin", requireAuth, requireAdmin, async (_req, res) => {
    const settings = await getOrCreateSettings();
    const { smtpEncryptedPassword, ...rest } = settings;
    res.json({ ...rest, smtpPasswordSet: !!smtpEncryptedPassword });
  });

  router.patch("/", requireAuth, requireAdmin, async (req, res) => {
    const parsed = updateAppSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const user = req.session.user!;
    const { smtpPassword, ...rest } = parsed.data;

    const data = {
      ...rest,
      ...(smtpPassword !== undefined
        ? {
            smtpEncryptedPassword:
              smtpPassword === "" ? null : encryptSecret(smtpPassword, config.API_KEY_ENCRYPTION_KEY),
          }
        : {}),
    };

    const settings = await prisma.appSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });

    await recordAuditEvent({
      req,
      actorType: "USER",
      actorId: user.id,
      actorEmail: user.email,
      action: "system_settings.update",
      targetType: "system_setting",
      targetId: String(SETTINGS_ID),
      result: "SUCCESS",
      // Never audit the raw password — record only that it changed.
      details: { ...rest, smtpPasswordChanged: smtpPassword !== undefined },
    });

    const { smtpEncryptedPassword, ...publicSettings } = settings;
    res.json({ ...publicSettings, smtpPasswordSet: !!smtpEncryptedPassword });
  });

  router.post("/smtp/test", requireAuth, requireAdmin, async (req, res) => {
    const user = req.session.user!;
    try {
      await sendEmail(config, user.email, "Nexus Scheduler test email", "SMTP is configured correctly.");
      res.status(204).send();
    } catch (err) {
      if (err instanceof SmtpNotConfiguredError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: err instanceof Error ? err.message : "failed to send test email" });
    }
  });

  return router;
}
