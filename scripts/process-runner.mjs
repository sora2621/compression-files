import { spawn } from "node:child_process";

export function runCommand(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        reject(new Error("benchmark command timed out"));
      },
      options.timeoutMs ?? 30 * 60_000,
    );
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-8_000_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-1_000_000);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `benchmark command failed (${code ?? "unknown"}): ${stderr.slice(-500)}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr, elapsedMs: performance.now() - startedAt });
    });
  });
}
