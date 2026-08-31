import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const renderScene = fileURLToPath(new URL("../scripts/render_scene.py", import.meta.url));
const python = ["python3", "python"].find(
  (candidate) => spawnSync(candidate, ["-c", "pass"]).status === 0,
);
const skip = python ? false : "python is unavailable";

const validPlan = {
  version: 1,
  lessonGoal: "Show why accumulated slices become an exact integral.",
  beats: [
    {
      id: "estimate",
      purpose: "Introduce a deliberately rough area estimate.",
      dominantVisual: "A curve with a small set of rectangles.",
      weight: 1,
      objects: [
        { id: "curve", role: "primary mathematical object", changePolicy: "preserve" },
        { id: "rectangles", role: "changing approximation", changePolicy: "flexible" },
        { id: "estimate-label", role: "adjacent label", changePolicy: "flexible" },
      ],
    },
    {
      id: "limit",
      purpose: "Resolve the estimate into exact accumulation.",
      dominantVisual: "The same curve above a continuous area fill.",
      weight: 1.2,
      objects: [
        { id: "curve", role: "primary mathematical object", changePolicy: "preserve" },
        { id: "area-fill", role: "payoff accumulation", changePolicy: "flexible" },
        { id: "integral-label", role: "adjacent label", changePolicy: "flexible" },
      ],
    },
  ],
};

function project(context, plan = validPlan) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orune-engine-contract-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  if (plan) fs.writeFileSync(path.join(directory, "scene-plan.json"), JSON.stringify(plan));
  return directory;
}

function run(code, args = []) {
  return spawnSync(python, ["-c", `
import ast, json, runpy, sys
from pathlib import Path
module = runpy.run_path(${JSON.stringify(renderScene)})
${code}
`, ...args], { encoding: "utf8" });
}

test("scene plan and named layout guards form one stable object contract", { skip }, (context) => {
  const directory = project(context);
  const source = `
assert_no_overlap(curve, rectangles, estimate_label, names=["curve", "rectangles", "estimate-label"])
watch_no_overlap(self, curve, integral_label, names=["curve", "integral-label"])
`;
  const result = run(`
project = Path(sys.argv[1])
plan = module["validate_scene_plan"](project, {"engineContract": 1})
tree = ast.parse(sys.argv[2])
module["validate_named_layout_guards"](tree, set(plan["_objectIds"]))
print(json.dumps(plan["_objectIds"]))
`, [directory, source]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["area-fill", "curve", "estimate-label", "integral-label", "rectangles"]);
});

test("unnamed collision guards are rejected before an expensive render", { skip }, (context) => {
  const directory = project(context);
  const result = run(`
project = Path(sys.argv[1])
plan = module["validate_scene_plan"](project, {"engineContract": 1})
module["validate_named_layout_guards"](ast.parse("assert_no_overlap(curve, label)"), set(plan["_objectIds"]))
`, [directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must pass names/);
});

test("engine contract rejects a missing semantic scene plan", { skip }, (context) => {
  const directory = project(context, null);
  const result = run(`
module["validate_scene_plan"](Path(sys.argv[1]), {"engineContract": 1})
`, [directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /scene-plan\.json is required/);
});

test("review sampling prioritizes stable beats and transition boundaries", { skip }, (context) => {
  const directory = project(context);
  const result = run(`
plan = module["validate_scene_plan"](Path(sys.argv[1]), {"engineContract": 1})
print(json.dumps(module["build_review_samples"](40, 30, plan)))
`, [directory]);
  assert.equal(result.status, 0, result.stderr);
  const samples = JSON.parse(result.stdout);
  assert.equal(samples.length, 12);
  assert.equal(new Set(samples.map((sample) => sample.frame)).size, 12);
  assert.ok(samples.some((sample) => sample.kind === "stable" && sample.beatId === "estimate"));
  assert.ok(samples.some((sample) => sample.kind === "stable" && sample.beatId === "limit"));
  assert.ok(samples.some((sample) => sample.kind === "transition" && sample.beatId === "estimate->limit"));
});

test("layout failures produce a smallest-target repair context", { skip }, (context) => {
  const directory = project(context);
  fs.writeFileSync(path.join(directory, "layout-audit.json"), JSON.stringify({
    version: 1,
    status: "failed",
    violations: [{ kind: "overlap", objects: ["rectangles", "estimate-label"], message: "too close" }],
  }));
  const result = run(`
plan = module["validate_scene_plan"](Path(sys.argv[1]), {"engineContract": 1})
print(json.dumps(module["write_repair_context"](Path(sys.argv[1]), plan)))
`, [directory]);
  assert.equal(result.status, 0, result.stderr);
  const repair = JSON.parse(result.stdout);
  assert.deepEqual(repair.targets, ["estimate-label", "rectangles"]);
  assert.ok(repair.preserve.includes("curve"));
  assert.ok(repair.preserve.includes("integral-label"));
  assert.ok(!repair.preserve.includes("rectangles"));
});
