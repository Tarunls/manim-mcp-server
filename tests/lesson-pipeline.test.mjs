import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { authorLesson, resolveModels } from "../scripts/lesson_pipeline.mjs";
import { buildTimeline } from "../scripts/narration.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manimPython = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const canRender = fs.existsSync(manimPython) && spawnSync("ffmpeg", ["-version"]).status === 0;
const skipRender = canRender ? false : "Manim or FFmpeg is unavailable";

const GOOD_SCENE = `from manim import *

class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = "#FBFAF7"
        square = Square(color="#2E5266", fill_opacity=0.2)
        self.play(Create(square), run_time=1)
        self.wait(1)
        self.play(square.animate.shift(RIGHT), run_time=1)
        self.wait(1)
`;

const BROKEN_SCENE = `from manim import *

class GeneratedScene(Scene):
    def construct(self):
        self.play(Create(ThisDoesNotExist()))
`;

/** A stand-in for the Responses API: answers each stage in order and records
 * what it was asked, so the test can check the pipeline's contract. */
async function fakeModel(answers) {
  const calls = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const stage = request.headers["x-orune-stage"];
      calls.push({ stage, body, authorization: request.headers.authorization });
      const answer = answers[calls.length - 1];
      if (!answer) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "no scripted answer" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        id: `resp_${calls.length}`,
        status: "completed",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(answer) }] }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function temporaryProject(context) {
  const projectsRoot = path.join(root, "studio", "projects");
  fs.mkdirSync(projectsRoot, { recursive: true });
  const projectDir = fs.mkdtempSync(path.join(projectsRoot, "test-pipeline-"));
  context.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  return projectDir;
}

test("model catalog resolves a fast script model and effort-tiered code models", () => {
  const models = resolveModels("balanced", {});
  assert.ok(models.script.model);
  assert.ok(models.code.model);
  assert.equal(resolveModels("thorough", {}).code.reasoning, "high");
});

test("timeline lays clips end to end with a breath between them", () => {
  const timeline = buildTimeline([3, 2.5], { lead: 0.4, gap: 0.5 });
  assert.deepEqual(timeline, [{ start: 0.4, end: 3.4 }, { start: 3.9, end: 6.4 }]);
});

test("a silent lesson goes script -> scene -> render, and a broken scene is repaired once", { skip: skipRender }, async (context) => {
  const projectDir = temporaryProject(context);
  fs.writeFileSync(path.join(projectDir, "narration-config.json"), JSON.stringify({ enabled: false }));
  const model = await fakeModel([
    { title: "Squares", beats: [
      { id: "show", narration: "", visual: "A square appears.", seconds: 2 },
      { id: "move", narration: "", visual: "It slides right.", seconds: 2 },
    ] },
    { scene_py: BROKEN_SCENE },
    { scene_py: GOOD_SCENE },
  ]);
  const progress = [];
  try {
    const result = await authorLesson({
      root,
      projectDir,
      brief: "Show a square moving.",
      format: "landscape",
      effort: "quick",
      narration: { enabled: false },
      openai: { baseUrl: model.baseUrl, apiKey: "test-key" },
      onProgress: (event) => progress.push(event),
      env: process.env,
    });
    assert.deepEqual(model.calls.map((call) => call.stage), ["script", "code", "repair"]);
    assert.equal(model.calls[0].authorization, "Bearer test-key");
    assert.equal(model.calls[0].body.store, false);
    assert.equal(model.calls[0].body.text.format.type, "json_schema");
    // The repair request carries the render error so the model can fix it.
    assert.match(model.calls[2].body.input[0].content[0].text, /ThisDoesNotExist/);
    // The silent timeline comes from the storyboard's own seconds.
    assert.deepEqual(result.storyboard.beats.map((beat) => [beat.start, beat.end]), [[0, 2], [2, 4]]);
    assert.equal(result.metadata.renderer, "manim");
    assert.equal(result.metadata.width, 1920);
    assert.ok(Math.abs(Number(result.metadata.duration) - 4) < 0.2, `duration ${result.metadata.duration}`);
    assert.ok(fs.existsSync(path.join(projectDir, "output.mp4")));
    assert.ok(fs.existsSync(path.join(projectDir, "storyboard.json")));
    assert.ok(fs.existsSync(path.join(projectDir, "contact-sheet.png")));
    assert.deepEqual([...new Set(progress.map((event) => event.stage))], ["brief", "authoring", "rendering"]);
  } finally {
    await model.close();
  }
});

test("a revision hands the model the previous storyboard and scene", { skip: skipRender }, async (context) => {
  const projectDir = temporaryProject(context);
  fs.writeFileSync(path.join(projectDir, "narration-config.json"), JSON.stringify({ enabled: false }));
  const previous = {
    version: 2, title: "Squares", brief: "Show a square moving.", format: "landscape",
    narration: { enabled: false }, totalSeconds: 4,
    beats: [{ id: "show", narration: "", visual: "A square appears.", seconds: 4, start: 0, end: 4, duration: 4 }],
  };
  const model = await fakeModel([
    { title: "Squares", beats: [{ id: "show", narration: "", visual: "A blue square appears.", seconds: 2 }] },
    { scene_py: GOOD_SCENE },
  ]);
  try {
    await authorLesson({
      root, projectDir, brief: previous.brief, format: "landscape", effort: "quick",
      narration: { enabled: false },
      revision: { request: "Make the square blue.", storyboard: previous, scene: GOOD_SCENE },
      openai: { baseUrl: model.baseUrl, apiKey: "test-key" },
      env: process.env,
    });
    const scriptPrompt = model.calls[0].body.input[0].content[0].text;
    assert.match(scriptPrompt, /Make the square blue/);
    assert.match(scriptPrompt, /A square appears/);
    const codePrompt = model.calls[1].body.input[0].content[0].text;
    assert.match(codePrompt, /Current scene\.py/);
    assert.match(codePrompt, /Make the square blue/);
  } finally {
    await model.close();
  }
});
