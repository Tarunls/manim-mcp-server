#!/usr/bin/env node
/**
 * Create the Manim virtualenv. Replaces setup_manim.sh, which needed bash and
 * assumed .venv/bin, so it could not run on Windows at all.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const venv = path.join(root, ".venv");
const binDir = path.join(venv, isWindows ? "Scripts" : "bin");
const python = path.join(binDir, isWindows ? "python.exe" : "python");
const manim = path.join(binDir, isWindows ? "manim.exe" : "manim");

// No shell here on purpose. uv, python and manim are real executables, and
// routing them through cmd.exe makes it read `>=3.10` as an output redirect
// and mangles the quoting on `-c` probes.
function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function uvAvailable() {
  try {
    execFileSync("uv", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!uvAvailable()) {
  console.error(
    "uv is required. Install it from https://docs.astral.sh/uv/ " +
    "or with: pip install uv",
  );
  process.exit(1);
}

// Without a constraint uv takes the first interpreter it finds, which on a
// machine with several Pythons can be an ancient one. Manim 0.19 needs 3.9 or
// newer, so ask for that rather than discovering the problem during install.
const PYTHON_REQUIREMENT = process.env.MANIM_PYTHON || ">=3.10";

function createVenv() {
  try {
    run("uv", ["venv", ".venv", "--python", PYTHON_REQUIREMENT]);
    return;
  } catch {
    // uv's managed-Python download needs to create a directory link, which
    // fails on Windows without developer mode or admin rights. The stdlib venv
    // module has no such requirement, and uv pip is happy to install into a
    // venv it did not create.
    console.warn("uv could not provision an interpreter, falling back to python -m venv");
  }

  const candidates = [process.env.MANIM_PYTHON_EXE, "python3", "python"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["-c", "import sys; assert sys.version_info >= (3, 9)"],
                   { stdio: "ignore" });
      run(candidate, ["-m", "venv", ".venv"]);
      return;
    } catch {
      continue;
    }
  }
  console.error("No interpreter found with Python 3.9 or newer. "
                + "Set MANIM_PYTHON_EXE to one.");
  process.exit(1);
}

if (!fs.existsSync(python)) {
  console.log(`Creating .venv (python ${PYTHON_REQUIREMENT})`);
  createVenv();
}

console.log("Installing manim");
const REQUIREMENT = "manim>=0.19,<0.20";
try {
  run("uv", ["pip", "install", "--python", python, REQUIREMENT]);
} catch {
  // uv introspects the interpreter before installing, and that probe fails
  // against a venv built from the Windows Store Python. Its own pip does not
  // care, and is already sitting in the venv we just made.
  console.warn("uv pip could not use this interpreter, falling back to pip");
  run(python, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);
  run(python, ["-m", "pip", "install", "--quiet", REQUIREMENT]);
}

if (!fs.existsSync(manim)) {
  console.error(`Manim did not land at ${manim}`);
  process.exit(1);
}

run(manim, ["--version"]);
