import fs from "node:fs";
import path from "node:path";

/**
 * Platform differences, in one place.
 *
 * A virtualenv puts executables in .venv/bin on macOS and Linux and in
 * .venv/Scripts on Windows, with an .exe suffix. Three files were hardcoding
 * the first form, so nothing could find manim on Windows.
 */
export const isWindows = process.platform === "win32";

export function venvBin(root: string, name: string): string {
  const directory = fs.existsSync(path.join(root, ".venv")) ? ".venv" : "venv";
  return isWindows
    ? path.join(root, directory, "Scripts", `${name}.exe`)
    : path.join(root, directory, "bin", name);
}

export const manimPath = (root: string) => venvBin(root, "manim");

/**
 * npm installs CLIs on Windows as a .cmd shim, and CreateProcess cannot execute
 * one directly, so spawn("codex") fails with ENOENT. Going through the shell
 * lets cmd.exe resolve codex.cmd. Args here contain no spaces, so this does not
 * open a quoting hole.
 */
export const spawnThroughShell = isWindows;
