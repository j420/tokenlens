import { runTests } from "@vscode/test-electron";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const extensionDevelopmentPath = resolve(__dirname, "../../apps/extension");
const extensionTestsPath = resolve(__dirname, "./suite/index.cjs");

try {
  const code = await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ["--disable-extensions", "--no-sandbox"],
  });
  process.exit(code ?? 0);
} catch (e) {
  console.error("Failed to run VS Code tests:", e.message);
  process.exit(1);
}
