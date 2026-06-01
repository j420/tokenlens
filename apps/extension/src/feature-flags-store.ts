/**
 * Node-side TCRP feature-flag reader/writer for the extension.
 *
 * Reads ~/.prune/feature-flags.json on activation; watches the file for
 * external mutations (e.g., enterprise team-policy push); persists changes
 * via atomic tmp+rename. Pure schema lives in `@prune/shared`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_TCRP_FLAGS,
  resolveFeatureId,
  validateFlags,
  withFeatureMutation,
  type TcrpFeatureFlags,
  type TcrpFeatureId,
  type TcrpFeatureMode,
  type TcrpFeatureState,
} from "@prune/shared";

type Listener = (flags: TcrpFeatureFlags) => void;

const FLAG_DIR = path.join(os.homedir(), ".prune");
const FLAG_PATH = path.join(FLAG_DIR, "feature-flags.json");

export class FeatureFlagStore {
  private flags: TcrpFeatureFlags = DEFAULT_TCRP_FLAGS;
  private listeners = new Set<Listener>();
  private watcher: fs.FSWatcher | null = null;
  private fileWatcherDebounce: NodeJS.Timeout | null = null;

  /**
   * Synchronously load flags from disk on construction. We block here on
   * purpose: features check the flag before doing anything, so the store must
   * be hydrated before the first session event fires.
   */
  constructor() {
    this.flags = this.readFromDisk();
  }

  /** Current flag state. Returns a frozen reference; callers must not mutate. */
  get current(): TcrpFeatureFlags {
    return this.flags;
  }

  /** Subscribe to flag changes (file mutations + local writes). */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Mutate a single feature, persist, and notify subscribers. Returns the
   * resolved feature id if the input was valid, otherwise undefined.
   */
  setFeature(
    idOrName: string,
    mutation: Partial<TcrpFeatureState>
  ): TcrpFeatureId | undefined {
    const id = resolveFeatureId(idOrName);
    if (!id) return undefined;
    const next = withFeatureMutation(this.flags, id, mutation, "local");
    this.flags = next;
    this.persist(next);
    this.notify();
    return id;
  }

  /** Convenience wrappers used by command handlers. */
  disable(idOrName: string, reason?: string): TcrpFeatureId | undefined {
    return this.setFeature(idOrName, {
      enabled: false,
      mode: "disabled",
      reason,
      disabledAt: new Date().toISOString(),
    });
  }

  enable(
    idOrName: string,
    mode: TcrpFeatureMode = "general"
  ): TcrpFeatureId | undefined {
    return this.setFeature(idOrName, {
      enabled: true,
      mode,
      reason: undefined,
      disabledAt: undefined,
    });
  }

  /**
   * Watch the flag file for external writes (enterprise policy push or
   * direct edits). Debounced to coalesce rapid mutations.
   */
  startWatching(): void {
    if (this.watcher) return;
    try {
      ensureDir(FLAG_DIR);
      this.watcher = fs.watch(FLAG_DIR, (_event, filename) => {
        if (filename !== path.basename(FLAG_PATH)) return;
        if (this.fileWatcherDebounce) clearTimeout(this.fileWatcherDebounce);
        this.fileWatcherDebounce = setTimeout(() => {
          const fresh = this.readFromDisk();
          if (JSON.stringify(fresh) !== JSON.stringify(this.flags)) {
            this.flags = fresh;
            this.notify();
          }
        }, 150);
      });
    } catch {
      // Filesystem may be restricted (sandboxed extension host). Watching is
      // best-effort — explicit setFeature() calls still work without it.
    }
  }

  dispose(): void {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // ignore
      }
      this.watcher = null;
    }
    if (this.fileWatcherDebounce) {
      clearTimeout(this.fileWatcherDebounce);
      this.fileWatcherDebounce = null;
    }
    this.listeners.clear();
  }

  private readFromDisk(): TcrpFeatureFlags {
    try {
      if (!fs.existsSync(FLAG_PATH)) return DEFAULT_TCRP_FLAGS;
      const raw = fs.readFileSync(FLAG_PATH, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return validateFlags(parsed);
    } catch {
      return DEFAULT_TCRP_FLAGS;
    }
  }

  private persist(flags: TcrpFeatureFlags): void {
    try {
      ensureDir(FLAG_DIR);
      const tmp = `${FLAG_PATH}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(flags, null, 2), "utf8");
      fs.renameSync(tmp, FLAG_PATH);
    } catch {
      // Persistence failure should not crash the extension; in-memory state
      // remains correct for this session.
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.flags);
      } catch {
        // listener errors must not poison the broadcast
      }
    }
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export { FLAG_PATH };
