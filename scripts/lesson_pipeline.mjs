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
import designCatalog from "../shared/design-system.json" with { type: "json" };
import modelCatalog from "../shared/models.json" with { type: "json" };
import { buildTimeline, narrationProviderFromEnv, synthesizeScript } from "./narration.mjs";

export const STORYBOARD_FILE = "storyboard.json";
export const SCENE_FILE = "scene.py";
export const NARRATION_FILE = "narration.json";

export function resolveDesign(input = {}) {
  const requestedFont = String(input?.fontCategory || "");
  const requestedPalette = String(input?.colorPalette || "");
  const fontCategory = Object.hasOwn(designCatalog.fonts, requestedFont)
    ? requestedFont
    : designCatalog.defaultFontCategory;
  const colorPalette = Object.hasOwn(designCatalog.palettes, requestedPalette)
    ? requestedPalette
    : designCatalog.defaultColorPalette;
  return {
    fontCategory,
    font: designCatalog.fonts[fontCategory],
    colorPalette,
    colors: designCatalog.palettes[colorPalette],
    typography: designCatalog.typography,
    layout: designCatalog.layout,
  };
}

/** Which model each stage uses. Environment variables override the catalog so
 * a cheaper or newer model can be tried without a code change. */
export function resolveModels(effort = "balanced", env = process.env) {
  const tier = effort === "thorough" ? "thorough" : effort === "quick" ? "quick" : "balanced";
  const code = modelCatalog.code[tier];
  const envKeys = modelCatalog.env;
  const codeModel = tier === "thorough"
    ? env[envKeys.thoroughModel]?.trim() || code.model
    : tier === "balanced"
      ? env[envKeys.balancedModel]?.trim() || env[envKeys.codeModel]?.trim() || code.model
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
  required: ["title", "teachingGoal", "visualLanguage", "facts", "beats"],
  properties: {
    title: { type: "string", description: "A short title for the video." },
    teachingGoal: { type: "string", description: "One observable thing the viewer should understand or be able to explain after watching." },
    visualLanguage: { type: "string", description: "A concise art direction for shape, line, texture, motion, camera, and composition that fits this specific subject." },
    facts: {
      type: "array",
      description: "The claims and quantities that must stay true in narration and pictures.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "visualProof"],
        properties: {
          claim: { type: "string", description: "A fact, relationship, or causal claim used by the explanation." },
          visualProof: { type: "string", description: "What the picture must show so the claim is demonstrated rather than merely stated." },
        },
      },
    },
    beats: {
      type: "array",
      description: "The video in order, one entry per beat.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "purpose", "narration", "visual", "actions", "onScreenText", "checks", "seconds"],
        properties: {
          id: { type: "string", description: "A short stable slug for this beat." },
          purpose: { type: "string", description: "Why this beat exists in the explanation and what changes in the viewer's understanding." },
          narration: {
            type: "string",
            description: "Exactly what the narrator says during this beat, as spoken words. Empty when the video has no narration.",
          },
          visual: {
            type: "string",
            description: "What is on screen and how it moves during this beat, concretely enough that an animator can build it: the objects, any labels or numbers, what appears, what changes, what stays.",
          },
          actions: {
            type: "array",
            minItems: 1,
            description: "Ordered animation events inside the beat, each tied to the words that should trigger it.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "cue", "instruction"],
              properties: {
                id: { type: "string", description: "A stable short identifier unique inside this beat." },
                cue: { type: "string", description: "An exact short phrase copied from this beat's narration. Use an empty string only for a silent beat." },
                instruction: { type: "string", description: "The visible change at this cue, naming persistent objects and exact spatial or causal behavior." },
              },
            },
          },
          onScreenText: {
            type: "array",
            items: { type: "string" },
            description: "Every exact string that may be readable on screen in this beat. Keep this minimal.",
          },
          checks: {
            type: "array",
            items: { type: "string" },
            description: "Concrete visual facts a reviewer can verify in a still frame or transition, including counts, geometry, labels, and relationships.",
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

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["passed", "score", "issues", "notes"],
  properties: {
    passed: { type: "boolean", description: "True only when there are no critical or major issues." },
    score: { type: "number", description: "Overall quality score from 0 to 100 after considering the listed issues." },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "category", "time", "description", "requiredFix"],
        properties: {
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          category: { type: "string", enum: ["teaching", "accuracy", "timing", "layout", "typography", "motion", "style"] },
          time: { type: "number", description: "Approximate seconds into the video." },
          description: { type: "string" },
          requiredFix: { type: "string" },
        },
      },
    },
    notes: { type: "string", description: "A concise overall verdict explaining the score." },
  },
};

function frameFacts(format) {
  return format === "vertical"
    ? { width: 1080, height: 1920, units: "8 units wide by 14.22 units tall (x from -4 to 4, y from -7.11 to 7.11); ORIGIN is the centre of the screen", label: "9:16 vertical, for phones" }
    : { width: 1920, height: 1080, units: "14.22 units wide by 8 units tall (x from -7.11 to 7.11, y from -4 to 4); ORIGIN is the centre of the screen", label: "16:9 widescreen" };
}

function describeDesign(design) {
  const resolved = resolveDesign(design);
  const font = resolved.font.manim;
  const colors = resolved.colors;
  const swatches = Object.entries(colors).map(([name, value]) => `${name} ${value}`).join(", ");
  const type = resolved.typography;
  return `Use the requested font family "${font}" consistently. Use this palette by semantic role: ${swatches}. Use one stable type scale: title ${type.title}, section ${type.section}, label ${type.label}, annotation ${type.annotation}; never render readable text below ${type.minimum}. Keep peer elements at least ${resolved.layout.minimumGap} scene units apart and meaningful content at least ${resolved.layout.safeMargin} units inside the frame. Treat these as constraints unless the user's brief explicitly asks for a different visual identity.`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function cueTokens(value) {
  return String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

function timedActions(beat) {
  const actions = Array.isArray(beat.actions) ? beat.actions : [];
  const words = Array.isArray(beat._wordMarks) ? beat._wordMarks : [];
  const wordTokens = words.map((word) => cueTokens(word.text)[0] || "");
  const result = actions.map((action, index) => {
    const requested = cueTokens(action.cue);
    let matched = -1;
    if (requested.length && words.length) {
      for (let start = 0; start <= wordTokens.length - requested.length; start += 1) {
        if (requested.every((token, offset) => wordTokens[start + offset] === token)) {
          matched = start;
          break;
        }
      }
    }
    const fallback = beat.start + beat.duration * ((index + 0.5) / Math.max(actions.length, 1));
    return {
      id: String(action.id || `action-${index + 1}`).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) || `action-${index + 1}`,
      cue: String(action.cue || "").trim(),
      instruction: String(action.instruction || "").trim(),
      at: Number((matched >= 0 ? beat._chunkStart + words[matched].startOffset : fallback).toFixed(3)),
      timingSource: matched >= 0 ? "word" : "estimated",
    };
  });
  delete beat._wordMarks;
  delete beat._chunkStart;
  return result;
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
      service_tier: "default",
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

const SCRIPT_INSTRUCTIONS = `You are the director and teacher for a short, high-fidelity animated video. The subject can be mathematics, science, history, design, culture, a process, a story, or a general visual explanation.
You are given a brief. Decide the teaching goal, the explanatory argument, the art direction, the number of beats, and the exact relationship between words and pictures.

Build the explanation before writing prose. Record every fact or causal relationship the video depends on and specify how the picture will demonstrate it. Never use a visually convenient stand-in that contradicts the claim. Preserve object identity, scale relationships, counts, orientation, and cause-and-effect across beats.

For each beat, say why it exists, list every exact string shown on screen, and break the motion into actions. Each narrated action's cue must be a short exact phrase copied word-for-word from that beat's narration. These cues are aligned to provider word timestamps after speech is synthesized. Make checks specific enough that a reviewer can reject a wrong count, shape, placement, scale, label, or transition.

Assume the viewer just arrived with no context. Identify an object before transforming it, show the operation itself when the operation carries the idea, and let the result remain visible long enough to understand. Whatever the narration mentions must be visible when those words are spoken.
The narration is read aloud by a text-to-speech voice as ONE continuous take, in beat order, and the beats are only where the picture changes. So write the narration as a single flowing piece of speech that happens to be split across beats: every line continues the thought of the line before it, names things before pronouns stand in for them, and sounds like one person talking, not a list of captions.
The speech engine reads exactly what is written. It says single letters as letter names, and it reads "pi r" as the letters P R, so write symbols and formulas the way they should be spoken, for example "pi times r squared". Keep written notation only in onScreenText.

Use little on-screen text. Do not invent app chrome, dashboards, cards, badges, or decorative interface panels unless the subject itself is software. Prefer one strong visual argument over a collage of widgets.`;

function scriptContent({ brief, format, narrationEnabled, design, previous, revisionRequest }) {
  const frame = frameFacts(format);
  const lines = [
    `Brief:\n${brief}`,
    "",
    `Frame: ${frame.label}.`,
    `Design system: ${describeDesign(design)}`,
    format === "vertical" ? "On phones the social app's own captions and buttons cover roughly the bottom fifth of the frame, so nothing important should sit there. Do not draw anything to mark that area." : "",
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
- Import QualityScene with \`from scripts.manim_quality import QualityScene\`. The file must define one class named GeneratedScene that subclasses QualityScene. The renderer rejects any other base. QualityScene checks every stable key state for cropped, unreadably small, or overlapping Text.
- There is no LaTeX installed, so Tex, MathTex and anything that shells out to LaTeX will fail. Use Text and MarkupText for everything, including formulas.
- The frame is ${frame.width}x${frame.height} pixels (${frame.label}). Manim maps it to ${frame.units}. One unit is 135 pixels. For scale: Text at font_size=48 is about 0.58 units tall and a 12-character line at that size is about 3.6 units wide; font_size=32 is about 0.39 units tall. Default constants like UP, DOWN, LEFT, RIGHT are one unit; to_edge and to_corner respect this frame.
- Installed font families: "Orune Serif", "Orune Serif Text", "DejaVu Sans", "DejaVu Sans Mono".
- ${describeDesign(design)}
- The scene must not read files other than listed images, must not make network requests, and must not depend on any module beyond manim, numpy and the standard library.
${assetLines ? `- ${assetLines}` : ""}

Rendering cost: the renderer takes roughly 0.1 seconds of CPU per frame in which anything changes, at 30 frames per second, and a still frame held with self.wait costs nothing. So ten seconds of continuous motion costs about thirty seconds to render, and a scene where several always_redraw objects change on every frame for a minute takes many minutes. Recreating Text inside always_redraw is especially slow. Spend motion where it carries the idea.

Visual truth: animate the real operation the narration names. A fold must visibly rotate one side around a crease and land with the correct resulting shape; a stack representing powers of two must encode exponential growth rather than grow by equal increments. Keep persistent objects geometrically consistent between beats. Do not substitute a generic morph when the spatial operation itself is the explanation.

Composition: establish a small set of persistent regions before animating. Keep headings, diagrams, labels, counters, and annotations in their regions; remove obsolete text before its replacement enters. Use the storyboard's exact onScreenText instead of inventing extra UI. Never put a line, arrow, shape, or panel through readable text. Center deliberately within a known region or align to one shared edge; do not position unrelated objects with scattered magic coordinates.

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
export async function renderProject({ root, projectDir, quality, signal, env = process.env, timeoutMs = 12 * 60_000, onProgress }) {
  let result;
  let buffered = "";
  let lastReport = 0;
  const onStderr = (chunk) => {
    if (!onProgress) return;
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() || "";
    for (const line of lines) {
      const match = line.match(/^render-progress (\d+)\/(\d+)/);
      if (!match) continue;
      const now = Date.now();
      if (now - lastReport < 15_000 && Number(match[1]) < Number(match[2])) continue;
      lastReport = now;
      onProgress(`Rendering: ${match[1]} of ${match[2]} animations done`);
    }
  };
  try {
    result = await runCommand(
      pythonCommand(),
      [path.join(root, "scripts", "render_scene.py"), projectDir, quality],
      { cwd: projectDir, env, signal, timeoutMs, onStderr },
    );
  } catch (error) {
    if (signal?.aborted || !/exceeded \d+ seconds/.test(String(error?.message))) throw error;
    const slow = new Error(
      `The render did not finish within ${Math.round(timeoutMs / 60_000)} minutes and was stopped. `
      + "Rendering costs roughly 0.1 seconds per frame in which something changes (30 frames per second), so long stretches of continuous per-frame animation are what make a scene this slow. "
      + "Keep the same beats and timing, but make the scene cheaper to render: animate only what the viewer needs to see move, hold still frames with self.wait, and avoid always_redraw or updaters on objects that do not need to change every frame (especially Text).",
    );
    slow.renderFailure = true;
    throw slow;
  }
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
    maxReviewRepairs = 3,
    review = true,
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
      design,
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
    purpose: String(beat.purpose || "").trim(),
    narration: narration.enabled === false ? "" : String(beat.narration || "").trim(),
    visual: String(beat.visual || "").trim(),
    actions: (Array.isArray(beat.actions) ? beat.actions : []).map((action) => ({
      id: action.id,
      cue: narration.enabled === false ? "" : action.cue,
      instruction: action.instruction,
    })),
    onScreenText: (Array.isArray(beat.onScreenText) ? beat.onScreenText : []).map((value) => String(value).trim()).filter(Boolean),
    checks: (Array.isArray(beat.checks) ? beat.checks : []).map((value) => String(value).trim()).filter(Boolean),
    seconds: Math.max(1, Number(beat.seconds) || 4),
  }));
  if (!beats.length) throw new Error("The script came back with no beats.");
  if (env.ORUNE_STORYBOARD_ONLY) {
    const storyboardOnly = { version: 3, title: storyboardResult.title, teachingGoal: storyboardResult.teachingGoal, visualLanguage: storyboardResult.visualLanguage, facts: storyboardResult.facts, brief, format, beats };
    fs.writeFileSync(path.join(projectDir, STORYBOARD_FILE), JSON.stringify(storyboardOnly, null, 2));
    return { storyboard: storyboardOnly, scene: "", metadata: {} };
  }

  // 2. Voice, then the timeline. The script is read continuously and each
  // beat's start and end come from the provider's word timestamps.
  let narrationMeta = { enabled: false };
  const spokenIndexes = beats.map((beat, index) => (beat.narration ? index : -1)).filter((index) => index >= 0);
  if (narration.enabled !== false && spokenIndexes.length) {
    await progress("authoring", `Recording the narration (${spokenIndexes.length} lines)`);
    const synthesized = await synthesizeScript({
      projectDir,
      beats: beats.map((beat) => ({ id: beat.id, narration: beat.narration })),
      voiceKey: narration.voice,
      provider: tts,
      signal,
    });
    checkCancelled();
    const chunkByFirstBeat = new Map(synthesized.chunks.map((chunk) => [chunk.beats[0].id, chunk]));
    const beatOffsets = new Map(synthesized.chunks.flatMap((chunk) => chunk.beats.map((beat) => [beat.id, beat])));
    const gap = 0.45;
    let clock = 0.4;
    let chunkStart = 0;
    let activeChunk = null;
    const segments = [];
    for (const beat of beats) {
      const chunk = chunkByFirstBeat.get(beat.id);
      if (chunk) {
        activeChunk = chunk;
        chunkStart = clock;
        segments.push({ start: Number(chunkStart.toFixed(3)), end: Number((chunkStart + chunk.duration).toFixed(3)), text: chunk.text, audio: chunk.audio, duration: chunk.duration, beats: chunk.beats.map((entry) => entry.id) });
      }
      const offsets = beatOffsets.get(beat.id);
      if (offsets && activeChunk) {
        beat.start = Number((chunkStart + offsets.startOffset).toFixed(3));
        beat.end = Number((chunkStart + offsets.endOffset).toFixed(3));
        beat._wordMarks = offsets.words;
        beat._chunkStart = chunkStart;
        if (activeChunk.beats.at(-1).id === beat.id) {
          clock = chunkStart + activeChunk.duration + gap;
          activeChunk = null;
        }
      } else {
        beat.start = Number(clock.toFixed(3));
        beat.end = Number((clock + beat.seconds).toFixed(3));
        clock = beat.end;
      }
      beat.duration = Number((beat.end - beat.start).toFixed(3));
    }
    narrationMeta = {
      enabled: true,
      provider: synthesized.provider,
      model: synthesized.model,
      voice: synthesized.voice,
      voiceId: synthesized.voiceId,
      continuousReads: synthesized.chunks.length,
      wordTimestamps: synthesized.chunks.every((chunk) => chunk.hasMarks),
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
  beats.forEach((beat) => {
    beat.actions = timedActions(beat);
  });
  const storyboard = {
    version: 3,
    title: String(storyboardResult.title || "").trim() || brief.slice(0, 80),
    teachingGoal: String(storyboardResult.teachingGoal || "").trim(),
    visualLanguage: String(storyboardResult.visualLanguage || "").trim(),
    facts: (Array.isArray(storyboardResult.facts) ? storyboardResult.facts : []).map((fact) => ({
      claim: String(fact.claim || "").trim(),
      visualProof: String(fact.visualProof || "").trim(),
    })).filter((fact) => fact.claim && fact.visualProof),
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
  const storyboardForModel = {
    title: storyboard.title,
    teachingGoal: storyboard.teachingGoal,
    visualLanguage: storyboard.visualLanguage,
    facts: storyboard.facts,
    totalSeconds: storyboard.totalSeconds,
    beats,
  };
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
      metadata = await renderProject({ root, projectDir, quality, signal, env, onProgress: (label) => progress("rendering", label) });
      break;
    } catch (error) {
      checkCancelled();
      if (!error?.renderFailure || attempt >= maxRepairs) throw error;
      log(`render failed: ${String(error.message).slice(-800)}`);
      // Keep the failed attempt and its error beside the project so a slow or
      // broken scene can be studied afterwards; only scene.py is rendered.
      fs.writeFileSync(path.join(projectDir, `scene.failed-${attempt + 1}.py`), scene);
      fs.appendFileSync(path.join(projectDir, "render-errors.log"), `--- attempt ${attempt + 1}\n${error.message}\n\n`);
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

  // 5. Inspect beat-aware frames, repair at most twice, and always inspect the
  // revised render again. A repair is never accepted on code alone.
  if (review) {
    const reports = [];
    let passed = false;
    for (let round = 0; round <= maxReviewRepairs; round += 1) {
      const reviewSheets = (metadata.reviewSheets || [metadata.contactSheet || "contact-sheet.png"])
        .map((file) => path.join(projectDir, file))
        .filter((file) => fs.existsSync(file));
      if (!reviewSheets.length) throw new Error("The renderer produced no frames for quality review.");
      await progress("inspecting", round ? `Verifying the revised video (${round + 1} of ${maxReviewRepairs + 1})` : "Checking teaching, timing, layout, and motion");
      const content = [{
        type: "input_text",
        text: `Act as a strict animation director, teacher, fact checker, and visual QA critic. Diagnose only; do not write or propose code.\n\nBrief:\n${brief}\n\nStoryboard with word-timed actions and acceptance checks:\n${JSON.stringify(storyboardForModel, null, 2)}\n\nThe attached sheets show frames sampled at the start, middle, and end of each beat; timestamps are printed above the frames and sheets are chronological. Compare every frame and transition to the teaching goal, facts, visualProof statements, action cues, onScreenText, and beat checks. Reject wrong geometry, counts, scale relationships, object identity, causality, or motion semantics even when the frame looks polished. Reject narration that gets ahead of the picture. Reject clipped, tiny, inconsistent, off-grid, or overlapping text; meaningless UI; lines through labels; unstable component sizes; arbitrary alignment; and style drift. A fold must read as a fold around a crease, not a generic polygon morph.\n\nSet passed=true only if there are no critical or major issues and the score is at least 85. Otherwise list a minimal, precise set of observable issues with timestamps and required outcomes. Describe what must become visible, correct, or legible; leave implementation to the scene author.`,
      }];
      for (const sheet of reviewSheets) content.push(imageContent(sheet));
      const reviewed = await client.json({
        stage: "review",
        model: models.code.model,
        reasoning: models.code.reasoning,
        instructions,
        content,
        schemaName: "review",
        schema: REVIEW_SCHEMA,
        signal,
      });
      checkCancelled();
      const report = {
        round: round + 1,
        passed: reviewed.passed === true,
        score: Math.max(0, Math.min(100, Number(reviewed.score) || 0)),
        issues: Array.isArray(reviewed.issues) ? reviewed.issues : [],
        notes: String(reviewed.notes || ""),
      };
      reports.push(report);
      fs.writeFileSync(path.join(projectDir, "review-report.json"), JSON.stringify({ passed: report.passed, rounds: reports }, null, 2));
      log(`review ${round + 1}: score ${report.score}; ${report.notes}`);
      if (report.passed) {
        passed = true;
        break;
      }
      if (round >= maxReviewRepairs) {
        throw new Error(`The rendered video did not pass quality review after ${maxReviewRepairs} repairs: ${report.notes || "major issues remain"}`);
      }
      await progress("authoring", `Repairing quality issues ${round + 1} of ${maxReviewRepairs}`);
      const repaired = await client.json({
        stage: "repair",
        model: models.code.model,
        reasoning: models.code.reasoning,
        instructions,
        content: sceneContent({
          brief,
          storyboard: storyboardForModel,
          previousScene: scene,
          repairError: `The rendered scene failed visual quality review. Correct every issue without regressing facts or checks that already pass.\n\n${JSON.stringify(report, null, 2)}`,
          attachments: reviewSheets.map((sheet, index) => ({ path: sheet, label: `Chronological review sheet ${index + 1}` })),
        }),
        schemaName: "scene",
        schema: SCENE_SCHEMA,
        signal,
      });
      checkCancelled();
      const replacement = String(repaired.scene_py || "");
      if (!replacement.trim() || replacement === scene) {
        throw new Error(`The scene repair did not address the failed quality review: ${report.notes || "major issues remain"}`);
      }
      const previousScene = scene;
      scene = replacement;
      fs.writeFileSync(path.join(projectDir, `scene.before-review-${round + 1}.py`), previousScene);
      fs.writeFileSync(scenePath, scene);
      await progress("rendering", `Rendering quality revision ${round + 1} of ${maxReviewRepairs}`);
      try {
        metadata = await renderProject({ root, projectDir, quality, signal, env });
      } catch (error) {
        checkCancelled();
        scene = previousScene;
        fs.writeFileSync(scenePath, scene);
        throw new Error(`The quality-review edit failed to render: ${String(error.message).slice(-1200)}`);
      }
    }
    if (!passed) throw new Error("The rendered video exhausted quality review without passing.");
  }

  return { storyboard, scene, metadata };
}
