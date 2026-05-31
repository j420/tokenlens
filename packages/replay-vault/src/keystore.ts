/**
 * Local ed25519 keystore for the replay vault.
 *
 * On first use, generates a fresh ed25519 keypair and writes the private
 * key with mode 0600 to `~/.prune/keys/replay.pem`. On subsequent use,
 * loads the existing key. Operators rotating keys can simply delete the
 * file — the next vault append will lay down a fresh one (chain
 * verification will then reject any record signed by the old key, which
 * is the correct fail-closed behavior for an audit log).
 *
 * No cloud-side key escrow. No vendor lock-in. A reviewer can `cat`
 * the file and verify the format is standard PKCS#8 PEM.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { generateEd25519KeyPair } from "./digest.js";

export interface KeystoreKey {
  publicPem: string;
  privatePem: string;
  /** Absolute path the private key is loaded from / saved to. */
  privatePath: string;
}

export interface LoadKeyOptions {
  /** Override path. Defaults to PRUNE_VAULT_KEY env or ~/.prune/keys/replay.pem. */
  path?: string;
}

function defaultPath(override?: string): string {
  if (override) return override;
  const fromEnv = process.env.PRUNE_VAULT_KEY;
  if (fromEnv) return fromEnv;
  const home =
    process.env.HOME ||
    process.env.USERPROFILE ||
    (process.platform === "win32" ? "C:\\Users\\Default" : "/tmp");
  return `${home}/.prune/keys/replay.pem`;
}

export function loadOrCreateKey(opts: LoadKeyOptions = {}): KeystoreKey {
  const path = defaultPath(opts.path);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const privatePem = readFileSync(path, "utf8");
    return {
      privatePem,
      publicPem: derivePublicPem(privatePem),
      privatePath: path,
    };
  }
  const pair = generateEd25519KeyPair();
  writeFileSync(path, pair.privatePem, { encoding: "utf8" });
  // Best-effort 0600. On Windows this is a no-op (NTFS ACLs aren't
  // chmod-shaped); the underlying user-profile directory permissions
  // are the actual access boundary there.
  try {
    chmodSync(path, 0o600);
  } catch {
    // Silent — see comment above.
  }
  return { ...pair, privatePath: path };
}

function derivePublicPem(privatePem: string): string {
  // Round-trip via node:crypto so we don't depend on the caller having
  // already-paired keys saved.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createPrivateKey, createPublicKey } = require("node:crypto") as typeof import("node:crypto");
  const priv = createPrivateKey(privatePem);
  const pub = createPublicKey(priv);
  return pub.export({ format: "pem", type: "spki" }).toString();
}
