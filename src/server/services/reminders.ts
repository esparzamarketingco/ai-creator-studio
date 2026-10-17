import { db } from "../db";
import { addDays, dateInTz } from "../time";
import { notifyWorkspaceManagers } from "./notifications";

/** Daily: notify when tomorrow has no video, or tomorrow's video still needs approval. */
export async function dailyReminders() {
  const workspaces = await db.workspace.findMany();
  for (const ws of workspaces) {
    const tomorrow = addDays(dateInTz(new Date(), ws.defaultTimezone), 1);
    const concepts = await db.contentConcept.findMany({ where: { workspaceId: ws.id, plannedDate: tomorrow, status: { not: "ARCHIVED" }, } });
    if (!concepts.length) {
      await notifyWorkspaceManagers(ws.id, { type: "calendar", title: `No video planned for ${tomorrow}`, body: ws.name, link: `/calendar?date=${tomorrow}`, dedupeKey: `missing:${ws.id}:${tomorrow}` });
    }
    for (const c of concepts.filter((c) => !["APPROVED", "SCHEDULED", "PUBLISHED"].includes(c.status))) {
      await notifyWorkspaceManagers(ws.id, { type: "approval", title: `Tomorrow's video is not approved yet: ${c.title}`, body: ws.name, link: c.status === "AWAITING_APPROVAL" ? "/approval" : `/studio?concept=${c.id}`, dedupeKey: `pending:${c.id}:${tomorrow}` });
    }
  }
}
