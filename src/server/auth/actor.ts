import type { UserRole } from "@prisma/client";

/** The authenticated principal passed to every service function. */
export type Actor = {
  userId: string;
  role: UserRole;
  sessionId?: string;
  ip?: string | null;
};
