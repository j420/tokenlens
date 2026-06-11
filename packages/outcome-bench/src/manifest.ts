/**
 * Task-manifest loading + validation.
 *
 * Manifests are the pre-registration artifact: they are committed to git
 * BEFORE any trial runs, so margins, prompts, caps, and oracle commands are
 * timestamped by history and cannot drift to fit the results.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TaskManifestSchema, type TaskManifest } from "./types.js";

export interface ManifestLoadResult {
  tasks: TaskManifest[];
  /** Files that failed validation, with reasons (reported, never dropped silently). */
  errors: Array<{ file: string; reason: string }>;
}

export function parseManifest(json: unknown): TaskManifest {
  return TaskManifestSchema.parse(json);
}

/** Load every `*.json` manifest under `dir` (non-recursive). */
export function loadManifestDir(dir: string): ManifestLoadResult {
  const tasks: TaskManifest[] = [];
  const errors: Array<{ file: string; reason: string }> = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  for (const f of files) {
    const path = join(dir, f);
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const parsed = TaskManifestSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push({
          file: path,
          reason: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
        continue;
      }
      tasks.push(parsed.data);
    } catch (e) {
      errors.push({ file: path, reason: (e as Error).message });
    }
  }
  // Duplicate task ids would silently merge cells in the analysis — refuse.
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.taskId)) {
      errors.push({
        file: dir,
        reason: `duplicate taskId "${t.taskId}"`,
      });
    }
    seen.add(t.taskId);
  }
  return { tasks, errors };
}

/** Only ready tasks are runnable; drafts await curation (no fabricated SHAs). */
export function runnableTasks(tasks: TaskManifest[]): TaskManifest[] {
  return tasks.filter((t) => t.status === "ready");
}
