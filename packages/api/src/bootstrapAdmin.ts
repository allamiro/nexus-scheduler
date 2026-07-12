import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";

const BCRYPT_ROUNDS = 12;

// Seeds (or re-syncs) the built-in break-glass admin account from env
// on every startup. BOOTSTRAP_ADMIN_PASSWORD is the *ongoing* source of
// truth, not a one-time seed — changing it and restarting is how an
// operator recovers access without touching the database directly,
// which is the entire point of a break-glass account (REQUIREMENTS §4).
export async function syncBootstrapAdmin(config: AppConfig, logger: Logger): Promise<void> {
  if (!config.BOOTSTRAP_ADMIN_PASSWORD) {
    logger.info("BOOTSTRAP_ADMIN_PASSWORD not set — skipping built-in admin sync");
    return;
  }

  const passwordHash = await bcrypt.hash(config.BOOTSTRAP_ADMIN_PASSWORD, BCRYPT_ROUNDS);

  await prisma.user.upsert({
    where: { email: config.BOOTSTRAP_ADMIN_EMAIL },
    create: {
      email: config.BOOTSTRAP_ADMIN_EMAIL,
      displayName: "Built-in Admin",
      authSource: "LOCAL",
      role: "ADMIN",
      active: true,
      passwordHash,
    },
    update: {
      passwordHash,
      role: "ADMIN",
      active: true,
    },
  });

  logger.info({ email: config.BOOTSTRAP_ADMIN_EMAIL }, "built-in admin account synced from env");
}
