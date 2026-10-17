"use server";
import { run, str } from "./run";
import { addIdea, clearAnalytics, createExperiment, deleteIdea, generateDemoData, importCsv, updateExperimentStatus } from "@/server/services/analytics";
import { AppError } from "@/server/errors";

export async function importCsvAction(_: unknown, fd: FormData) {
  return run(async (a) => {
    const f = fd.get("file");
    if (!f || typeof f === "string" || f.size === 0) throw new AppError("VALIDATION", "Choose a CSV file.");
    if (f.size > 5 * 1024 * 1024) throw new AppError("VALIDATION", "CSV files must be under 5 MB.");
    const r = await importCsv(a, str(fd, "workspaceId"), f.name, await f.text());
    return r;
  }, { message: "Imported." });
}

export async function demoDataAction(workspaceId: string) {
  return run((a) => generateDemoData(a, workspaceId), { message: "Demo data generated (labeled DEMO)." });
}

export async function clearAnalyticsAction(workspaceId: string, which: "demo" | "imported") {
  return run((a) => clearAnalytics(a, workspaceId, which), { message: "Cleared." });
}

export async function createExperimentAction(_: unknown, fd: FormData) {
  return run((a) => createExperiment(a, {
    workspaceId: str(fd, "workspaceId"), name: str(fd, "name"), hypothesis: str(fd, "hypothesis"),
    variable: str(fd, "variable") as "CAPTION", variantA: str(fd, "variantA"), variantB: str(fd, "variantB"), metric: str(fd, "metric"),
  }).then(() => undefined), { message: "Experiment created." });
}

export async function experimentStatusAction(id: string, status: "RUNNING" | "CONCLUDED") {
  return run((a) => updateExperimentStatus(a, id, status), { message: status === "RUNNING" ? "Started." : "Concluded." });
}

export async function addIdeaAction(_: unknown, fd: FormData) {
  return run((a) => addIdea(a, str(fd, "workspaceId"), str(fd, "title"), str(fd, "notes")).then(() => undefined), { message: "Added to backlog." });
}

export async function deleteIdeaAction(id: string) {
  return run((a) => deleteIdea(a, id));
}
