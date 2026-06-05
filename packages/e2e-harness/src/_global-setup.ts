/**
 * vitest globalSetup — hermetic home directory.
 *
 * Some transcript-reading MCP handlers (context_health_report,
 * cache_habits_from_transcript) call `loadCachedSessionView`, which writes a
 * session cache under `os.homedir()/.prune/cache` when no override is given.
 * We redirect HOME (and USERPROFILE for parity) to a throwaway dir for the whole
 * test process so nothing touches the developer's real `~/.prune`. The dir is
 * removed on teardown.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup(): () => void {
  const home = mkdtempSync(join(tmpdir(), "prune-e2e-home-"));
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  return () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };
}
