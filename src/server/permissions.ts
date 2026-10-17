import type { Workspace, WorkspaceRole } from "@prisma/client";
import { db } from "./db";
import { AppError } from "./errors";
import type { Actor } from "./auth/actor";

export type WorkspaceAction = "view" | "edit" | "approve" | "publish" | "manage";

const RANK: Record<WorkspaceRole, number> = { REVIEWER: 1, CONTRIBUTOR: 2, MANAGER: 3 };
const NEEDS: Record<WorkspaceAction, number> = { view: 1, edit: 2, approve: 3, publish: 3, manage: 3 };

export type WorkspaceAccess = { workspace: Workspace; role: WorkspaceRole };

/**
 * Resolve the actor's access to a workspace and assert it allows `action`.
 * - Membership is required (owners are members of every workspace they create).
 * - The restricted ADULT workspace additionally requires the user's 18+ / authorization attestation.
 * - Global VIEWER accounts can never approve or publish.
 */
export async function requireWorkspace(actor: Actor, workspaceId: string, action: WorkspaceAction): Promise<WorkspaceAccess> {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
    include: { workspace: true, user: { select: { adultAccessAttestedAt: true, role: true } } },
  });
  if (!member) throw new AppError("NOT_FOUND", "Workspace not found.");
  if (member.workspace.kind === "ADULT" && !member.user.adultAccessAttestedAt) {
    throw new AppError("FORBIDDEN", "This workspace is restricted. Confirm adult access in Settings → Security first.");
  }
  if (RANK[member.role] < NEEDS[action]) {
    throw new AppError("FORBIDDEN", `Your workspace role (${member.role.toLowerCase()}) cannot ${action} here.`);
  }
  if ((action === "approve" || action === "publish") && member.user.role === "VIEWER") {
    throw new AppError("FORBIDDEN", "Viewer accounts cannot approve or publish.");
  }
  return { workspace: member.workspace, role: member.role };
}

/** Workspaces the actor may open (restricted ones hidden until attested). */
export async function listAccessibleWorkspaces(actor: Actor) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { adultAccessAttestedAt: true } });
  const members = await db.workspaceMember.findMany({
    where: { userId: actor.userId },
    include: { workspace: true },
    orderBy: { workspace: { kind: "asc" } },
  });
  return members.map((m) => ({
    ...m.workspace,
    role: m.role,
    locked: m.workspace.kind === "ADULT" && !user.adultAccessAttestedAt,
  }));
}

export function requireGlobalAdmin(actor: Actor) {
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") throw new AppError("FORBIDDEN", "Administrator access required.");
}
