/**
 * The lesson pipeline: brief -> storyboard -> voice -> scene -> render.
 *
 * Every creative decision belongs to the model. This file only sequences the
 * stages, hands each one the facts it needs (the brief, the real audio
 * timeline, the frame size), and renders what comes back. There are no
 * content rules here: no required hook, no word counts, no style checks.
 *
 * Used by the E2B bootstrap (through the job-scoped model proxy) and by the
 * local studio (with a server-side OpenAI key).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import modelCatalog from "../shared/models.json" with { type: "json" };
import { buildTimeline, narrationProviderFromEnv, synthesizeSegments } from "./narration.mjs";

export const STORYBOARD_FILE = "storyboard.json";
export const SCENE_FILE = "scene.py";
export const NARRATION_FILE = "narration.json";

/** Which model each stage uses. Environment variables override the catalog so
 * a cheaper or newer model can be tried without a code change. */
export function resolveModels(effort = "balanced", env = process.env) {
  const tier = effort === "thorough" ? "thorough" : effort === "quick" ? "quick" : "balanced";
  const code = modelCatalog.code[tier];
  const envKeys = modelCatalog.env;
  const codeModel = tier === "thorough"
    ? env[envKeys.thoroughModel]?.trim() || code.model
    : env[envKeys.codeModel]?.trim() || code.model;
  const codeReasoning = tier === "thorough"
    ? env[envKeys.thoroughReasoning]?.trim() || code.reasoning
    : env[envKeys.codeReasoning]?.trim() || code.reasoning;
  return {
    script: {
      model: env[envKeys.scriptModel]?.trim() || modelCatalog.script.model,
      reasoning: env[envKeys.scriptReasoning]?.trim() || modelCatalog.script.reasoning,
    },
    code: { model: codeModel, reasoning: codeReasoning },
  };
}

const STORYBOARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "beats"],
  properties: {
    title: { type: "string", description: "A short title for the video." },
    beats: {
      type: "array",
      description: "The video in order, one entry per beat.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "narration", "visual", "seconds"],
        properties: {
          id: { type: "string", description: "A short stable slug for this beat." },
          narration: {
            type: "string",
            description: "Exactly what the narrator says during this beat, as spoken words. Empty when the video has no narration.",
          },
          visual: {
            type: "string",
            description: "What is on screen and how it moves during this beat, concretely enough that an animator can build it: the objects, any labels or numbers, what appears, what changes, what stays.",
          },
          seconds: {
            type: "number",
            description: "How long the beat should last if there were no narration. With narration the audio decides.",
          },
        },
      },
    },
  },
};

const SCENE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scene_py"],
  properties: {
    scene_py: { type: "string", description: "The complete contents of scene.py." },
  },
};

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["changed", "notes", "scene_py"],
  properties: {
    changed: { type: "boolean", description: "True when scene_py differs from the current file." },
    notes: { type: "string", description: "What was wrong and what changed, or why nothing needed to." },
    scene_py: { type: "string", description: "The complete scene.py to use. Return the current file unchanged when nothing needs to change." },
  },
};

function frameFacts(format) {
  return format === "vertical"
    ? { width: 1080, height: 1920, units: "4.5 units wide by 8 units tall (x from -2.25 to 2.25, y from -4 to 4)", label: "9:16 vertical, for phones" }
    : { width: 1920, height: 1080, units: "14.22 units wide by 8 units tall (x from -7.11 to 7.11, y from -4 to 4)", label: "16:9 widescreen" };
}

function describeDesign(design) {
  if (!design) return "";
  const font = design.font?.manim;
  const colors = design.colors || {};
  const swatches = Object.entries(colors).map(([name, value]) => `${name} ${value}`).join(", ");
  return [
    font ? `The studio's default font family is "${font}".` : "",
    swatches ? `Its default palette is: ${swatches}.` : "",
    "These are defaults, not requirements; do what serves the video.",
  ].filter(Boolean).join(" ");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function imageContent(imagePath) {
  const bytes = fs.readFileSync(imagePath);
  const extension = path.extname(imagePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  return { type: "input_image", image_url: `data:${mime};base64,${bytes.toString("base64")}`, detail: "high" };
}

class ModelClient {
  constructor({ baseUrl, apiKey, headers = {}, fetchImpl = fetch, maxOutputTokens = 32_000, log = () => {} }) {
    if (!baseUrl || !apiKey) throw new Error("A model endpoint and key are required.");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.headers = headers;
    this.fetchImpl = fetchImpl;
    this.maxOutputTokens = maxOutputTokens;
    this.log = log;
  }

  async json({ stage, model, reasoning, instructions, content, schemaName, schema, signal }) {
    const body = {
      model,
      instructions,
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: schemaName, schema, strict: true } },
      max_output_tokens: this.maxOutputTokens,
      store: false,
    };
    if (reasoning) body.reasoning = { effort: reasoning };
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (signal?.aborted) throw new Error("Generation was cancelled.");
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "x-orune-stage": stage,
            ...this.headers,
          },
          body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]) : AbortSignal.timeout(15 * 60_000),
        });
        const text = await response.text();
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          lastError = new Error(`The ${stage} model request failed with HTTP ${response.status}: ${text.slice(0, 400)}`);
          if (!retryable) throw lastError;
          this.log(`${stage}: HTTP ${response.status}, retrying`);
          await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
          continue;
        }
        const data = JSON.parse(text);
        const output = (data.output || [])
          .filter((item) => item.type === "message")
          .flatMap((item) => item.content || [])
          .filter((part) => part.type === "output_text")
          .map((part) => part.text)
          .join("");
        if (!output) {
          const reason = data.incomplete_details?.reason || data.status || "empty output";
          throw new Error(`The ${stage} model returned no text (${reason}).`);
        }
        try {
          return JSON.parse(output);
        } catch (error) {
          lastError = new Error(`The ${stage} model returned invalid JSON: ${error instanceof Error ? error.message : "parse error"}`);
          this.log(`${stage}: invalid JSON, retrying`);
          continue;
        }
      } catch (error) {
        if (signal?.aborted) throw new Error("Generation was cancelled.");
        lastError = error;
        if (error?.name === "TimeoutError" || error?.name === "AbortError") throw error;
        if (attempt === 3) break;
        if (!/HTTP 429|HTTP 5\d\d|invalid JSON|fetch failed|ECONNRESET|socket/i.test(String(error?.message))) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      }
    }
    throw lastError || new Error(`The ${stage} model request failed.`);
  }
}

const SCRIPT_INSTRUCTIONS = `You write short educational videos that are rendered as 2D animations with a narrator.
You are given a brief. Decide everything yourself: the angle, the opening, the length, the tone, the number of beats, what gets shown and in what order.
The rest of the pipeline needs only a list of beats. For each beat give the narration exactly as it will be spoken, and a concrete description of what is on screen and how it moves.
Assume the viewer just arrived with no context and has never seen the topic. Make sure they know what they are looking at before anything is done with it, and that whatever the narration mentions is visible when it is mentioned.
The narration is read aloud by a text-to-speech voice, so write it as spoken words: say symbols and formulas the way a person would say them out loud, and keep the written characters for the screen.`;

function scriptContent({ brief, format, narrationEnabled, previous, revisionRequest }) {
  const frame = frameFacts(format);
  const lines = [
    `Brief:\n${brief}`,
    "",
    `Frame: ${frame.label}.`,
    format === "vertical" ? "On phones the social app's own captions and buttons cover roughly the bottom fifth of the frame." : "",
    narrationEnabled
      ? "The video is narrated. Each beat's narration is synthesised as one clip; the clips decide the timing."
      : "The video is silent: leave every narration field empty and put any words the viewer needs on screen into the visual description.",
  ];
  if (previous) {
    lines.push(
      "",
      "This is a revision of an existing video. Its current storyboard:",
      JSON.stringify(previous, null, 2),
      "",
      `Requested change:\n${revisionRequest}`,
      "",
      "Return the full updated storyboard. Keep the narration of beats you are not changing word-for-word identical so their audio can be reused.",
    );
  }
  return [{ type: "input_text", text: lines.filter((line) => line !== undefined).join("\n") }];
}

function sceneInstructions({ format, design, assets }) {
  const frame = frameFacts(format);
  const assetLines = assets.length
    ? `Images available in this project (load with ImageMobject using the relative path): ${assets.map((asset) => `${asset.localPath}${asset.title ? ` (${asset.title})` : ""}`).join("; ")}.`
    : "";
  return `You write Manim Community Edition v0.19 scenes. Return the complete contents of scene.py.

Facts about the render environment:
- The file must define one class named GeneratedScene that subclasses Scene. That is the class the renderer runs.
- There is no LaTeX installed, so Tex, MathTex and anything that shells out to LaTeX will fail. Use Text and MarkupText for everything, including formulas.
- The frame is ${frame.width}x${frame.height} pixels (${frame.label}). Manim maps it to ${frame.units}.
- Installed font families: "Orune Serif", "Orune Serif Text", "DejaVu Sans", "DejaVu Sans Mono".
- ${describeDesign(design)}
- The scene must not read files other than listed images, must not make network requests, and must not depend on any module beyond manim, numpy and the standard library.
${assetLines ? `- ${assetLines}` : ""}

Timing: each beat in the storyboard has a start and an end in seconds. The narration clips are laid onto the finished video at exactly those times and nothing else keeps voice and picture together, so the scene's elapsed time must track them: the run_time of the animations you play for a beat plus any self.wait() should add up to that beat's duration, and the total run time should equal the final end time. When a beat needs to hold on the finished picture, use self.wait for the remaining seconds.`;
}

function sceneContent({ brief, storyboard, previousScene, revisionRequest, repairError, attachments }) {
  const content = [];
  const lines = [`Brief:\n${brief}`, "", "Storyboard with timeline:", JSON.stringify(storyboard, null, 2)];
  if (previousScene && repairError) {
    lines.push(
      "",
      "The current scene.py failed to render. Fix it and return the complete corrected file.",
      "",
      "Current scene.py:",
      previousScene,
      "",
      "Render error output:",
      repairError,
    );
  } else if (previousScene) {
    lines.push(
      "",
      "This is a revision. The current scene.py is below; the storyboard above is already updated for the change.",
      "",
      "Current scene.py:",
      previousScene,
      "",
      `Requested change:\n${revisionRequest}`,
      "",
      "Return the complete new scene.py.",
    );
  }
  content.push({ type: "input_text", text: lines.join("\n") });
  for (const attachment of attachments || []) {
    content.push({ type: "input_text", text: attachment.label || "Attached image" });
    content.push(imageContent(attachment.path));
  }
  return content;
}

function runCommand(command, args, { cwd, env, signal, timeoutMs, onStderr }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} exceeded ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    const onAbort = () => {
      child.kill("SIGKILL");
      reject(new Error("Generation was cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      onStderr?.(String(chunk));
    });
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr });
    });
  });
}

function pythonCommand() {
  return process.platform === "win32" ? "python" : "python3";
}

/** Render the project. Returns the renderer's metadata on success; on failure
 * the error message carries the tail of the renderer output for the repair
 * step. */
export async function renderProject({ root, projectDir, quality, signal, env = process.env, timeoutMs = 20 * 60_000 }) {
  const result = await runCommand(
    pythonCommand(),
    [path.join(root, "scripts", "render_scene.py"), projectDir, quality],
    { cwd: projectDir, env, signal, timeoutMs },
  );
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "Manim render failed.").trim();
    const error = new Error(detail.slice(-6000));
    error.renderFailure = true;
    throw error;
  }
  const lastLine = result.stdout.trim().split("\n").filter(Boolean).at(-1) || "{}";
  try {
    return JSON.parse(lastLine);
  } catch {
    throw new Error("The renderer finished without metadata.");
  }
}

/**
 * Author and render one lesson. Options:
 *   root, projectDir            paths; projectDir must live under root/studio/projects
 *   brief                       the user's request (for a revision: the original brief)
 *   format                      "landscape" | "vertical"
 *   effort                      "quick" | "balanced" | "thorough"
 *   narration                   { enabled, voice }
 *   design                      contents of design-config.json (optional)
 *   assets                      [{ localPath, title }]
 *   revision                    { request, storyboard, scene, attachments: [{ path, label }] } (optional)
 *   openai                      { baseUrl, apiKey, headers?, fetchImpl? }
 *   tts                         provider options for narration.mjs (defaults to the environment)
 *   onProgress({ stage, label })
 *   signal                      AbortSignal
 */
export async function authorLesson(options) {
  const {
    root,
    projectDir,
    brief,
    format = "landscape",
    effort = "balanced",
    narration = { enabled: false },
    design,
    assets = [],
    revision,
    openai,
    tts = narrationProviderFromEnv(),
    onProgress = () => {},
    signal,
    log = () => {},
    maxRepairs = 3,
    review = effort === "thorough",
    env = process.env,
  } = options;
  if (!brief?.trim()) throw new Error("A brief is required.");
  fs.mkdirSync(projectDir, { recursive: true });
  const models = resolveModels(effort, env);
  const client = new ModelClient({ ...openai, log, maxOutputTokens: openai.maxOutputTokens });
  const progress = async (stage, label) => {
    log(`${stage}: ${label}`);
    try {
      await onProgress({ stage, label });
    } catch {
      // Progress is best effort.
    }
  };
  const checkCancelled = () => {
    if (signal?.aborted) throw new Error("Generation was cancelled.");
  };

  // 1. Storyboard.
  await progress("brief", revision ? "Rewriting the script for the change" : "Writing the script");
  const previousStoryboard = revision?.storyboard;
  const storyboardResult = await client.json({
    stage: "script",
    model: models.script.model,
    reasoning: models.script.reasoning,
    instructions: SCRIPT_INSTRUCTIONS,
    content: scriptContent({
      brief,
      format,
      narrationEnabled: narration.enabled !== false,
      previous: previousStoryboard ? { title: previousStoryboard.title, beats: previousStoryboard.beats } : undefined,
      revisionRequest: revision?.request,
    }),
    schemaName: "storyboard",
    schema: STORYBOARD_SCHEMA,
    signal,
  });
  checkCancelled();
  const beats = (storyboardResult.beats || []).map((beat, index) => ({
    id: String(beat.id || `beat-${index + 1}`).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) || `beat-${index + 1}`,
    narration: narration.enabled === false ? "" : String(beat.narration || "").trim(),
    visual: String(beat.visual || "").trim(),
    seconds: Math.max(1, Number(beat.seconds) || 4),
  }));
  if (!beats.length) throw new Error("The script came back with no beats.");

  // 2. Voice, then the timeline. Real durations, not estimates.
  let narrationMeta = { enabled: false };
  const spokenIndexes = beats.map((beat, index) => (beat.narration ? index : -1)).filter((index) => index >= 0);
  if (narration.enabled !== false && spokenIndexes.length) {
    await progress("authoring", `Recording ${spokenIndexes.length} narration lines`);
    const synthesized = await synthesizeSegments({
      projectDir,
      texts: beats.map((beat) => beat.narration),
      voiceKey: narration.voice,
      provider: tts,
      signal,
    });
    checkCancelled();
    let clock = 0.4;
    const gap = 0.45;
    const segments = [];
    beats.forEach((beat, index) => {
      const clip = synthesized.segments[index];
      const duration = clip ? clip.duration : beat.seconds;
      beat.start = Number(clock.toFixed(3));
      beat.end = Number((clock + duration).toFixed(3));
      beat.duration = Number((beat.end - beat.start).toFixed(3));
      if (clip) {
        beat.narration = clip.text;
        segments.push({ beat: beat.id, start: beat.start, end: beat.end, text: clip.text, audio: clip.audio, duration: clip.duration });
      }
      clock = beat.end + gap;
    });
    narrationMeta = {
      enabled: true,
      provider: synthesized.provider,
      model: synthesized.model,
      voice: synthesized.voice,
      voiceId: synthesized.voiceId,
    };
    fs.writeFileSync(path.join(projectDir, NARRATION_FILE), JSON.stringify({ ...narrationMeta, segments }, null, 2));
  } else {
    const timeline = buildTimeline(beats.map((beat) => beat.seconds), { lead: 0, gap: 0 });
    beats.forEach((beat, index) => {
      beat.start = timeline[index].start;
      beat.end = timeline[index].end;
      beat.duration = Number((beat.end - beat.start).toFixed(3));
    });
    fs.rmSync(path.join(projectDir, NARRATION_FILE), { force: true });
  }
  const storyboard = {
    version: 2,
    title: String(storyboardResult.title || "").trim() || brief.slice(0, 80),
    brief,
    format,
    narration: narrationMeta,
    totalSeconds: beats.at(-1).end,
    beats,
  };
  fs.writeFileSync(path.join(projectDir, STORYBOARD_FILE), JSON.stringify(storyboard, null, 2));

  // 3. Scene code.
  await progress("authoring", revision ? "Rewriting the animation" : "Writing the animation");
  const instructions = sceneInstructions({ format, design, assets });
  const storyboardForModel = { title: storyboard.title, totalSeconds: storyboard.totalSeconds, beats };
  const sceneResult = await client.json({
    stage: "code",
    model: models.code.model,
    reasoning: models.code.reasoning,
    instructions,
    content: sceneContent({
      brief,
      storyboard: storyboardForModel,
      previousScene: revision?.scene,
      revisionRequest: revision?.request,
      attachments: revision?.attachments,
    }),
    schemaName: "scene",
    schema: SCENE_SCHEMA,
    signal,
  });
  checkCancelled();
  let scene = String(sceneResult.scene_py || "");
  if (!scene.trim()) throw new Error("The animation model returned an empty scene.");
  const scenePath = path.join(projectDir, SCENE_FILE);
  fs.writeFileSync(scenePath, scene);

  // 4. Render, repairing on failure.
  const quality = format === "vertical" ? "vertical" : "balanced";
  let metadata;
  for (let attempt = 0; ; attempt += 1) {
    await progress("rendering", attempt ? `Rendering again (fix ${attempt} of ${maxRepairs})` : "Rendering the video");
    try {
      metadata = await renderProject({ root, projectDir, quality, signal, env });
      break;
    } catch (error) {
      checkCancelled();
      if (!error?.renderFailure || attempt >= maxRepairs) throw error;
      log(`render failed: ${String(error.message).slice(-800)}`);
      await progress("authoring", `Fixing a render error (${attempt + 1} of ${maxRepairs})`);
      const repaired = await client.json({
        stage: "repair",
        model: models.code.model,
        reasoning: models.code.reasoning,
        instructions,
        content: sceneContent({ brief, storyboard: storyboardForModel, previousScene: scene, repairError: error.message }),
        schemaName: "scene",
        schema: SCENE_SCHEMA,
        signal,
      });
      checkCancelled();
      scene = String(repaired.scene_py || scene);
      fs.writeFileSync(scenePath, scene);
    }
  }

  // 5. Optional look at the result, only when the user asked for the most effort.
  const contactSheet = path.join(projectDir, "contact-sheet.png");
  if (review && fs.existsSync(contactSheet)) {
    await progress("inspecting", "Looking over the rendered frames");
    const reviewed = await client.json({
      stage: "review",
      model: models.code.model,
      reasoning: models.code.reasoning,
      instructions,
      content: [
        { type: "input_text", text: `Brief:\n${brief}\n\nStoryboard with timeline:\n${JSON.stringify(storyboardForModel, null, 2)}\n\nCurrent scene.py:\n${scene}\n\nBelow is a contact sheet of twelve frames sampled evenly from the rendered video, in reading order. Look for anything broken: text or objects cut off by the frame edge, things drawn on top of each other so neither can be read, a beat whose picture does not show what its storyboard entry describes. If something needs fixing, return the corrected complete scene.py with changed=true. Otherwise return the file unchanged with changed=false.` },
        imageContent(contactSheet),
      ],
      schemaName: "review",
      schema: REVIEW_SCHEMA,
      signal,
    });
    checkCancelled();
    if (reviewed.changed && reviewed.scene_py?.trim() && reviewed.scene_py !== scene) {
      log(`review: ${reviewed.notes}`);
      const previousScene = scene;
      scene = reviewed.scene_py;
      fs.writeFileSync(scenePath, scene);
      await progress("rendering", "Rendering the reviewed version");
      try {
        metadata = await renderProject({ root, projectDir, quality, signal, env });
      } catch (error) {
        checkCancelled();
        // A failed review edit must not lose the working video.
        log(`review render failed, keeping the earlier render: ${String(error.message).slice(-400)}`);
        scene = previousScene;
        fs.writeFileSync(scenePath, scene);
        metadata = await renderProject({ root, projectDir, quality, signal, env });
      }
    }
  }

  return { storyboard, scene, metadata };
}
