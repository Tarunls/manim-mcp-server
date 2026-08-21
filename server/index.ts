import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { isWindows, manimPath } from "./platform.js";
import { StudioService } from "./studio-service.js";
import type { ColorPalette, FontCategory, RendererKind, ReviewFocus, ReviewStrictness, StudioEvent } from "./types.js";

// The npm scripts used to set these with a `TMPDIR=/tmp node ...` prefix, which
// is bash syntax and fails on Windows, where /tmp does not exist either. Doing
// it here keeps the scripts portable and leaves the Windows temp dir alone.
if (!isWindows) {
  process.env.TMPDIR = "/tmp";
  process.env.TEMP = "/tmp";
  process.env.TMP = "/tmp";
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const app = express();
const studio = new StudioService(root);
const port = Number(process.env.PORT || 4321);

function rendererFrom(value: unknown): RendererKind | undefined {
  return value === "manim" || value === "remotion" || value === "composite" ? value : undefined;
}

function reviewFocusFrom(value: unknown): ReviewFocus | undefined {
  return ["balanced", "layout", "motion", "pedagogy", "accessibility", "polish"].includes(String(value)) ? value as ReviewFocus : undefined;
}

function reviewStrictnessFrom(value: unknown): ReviewStrictness | undefined {
  return ["quick", "normal", "obsessive"].includes(String(value)) ? value as ReviewStrictness : undefined;
}

function fontCategoryFrom(value: unknown): FontCategory | undefined {
  return ["modern", "editorial", "technical", "friendly", "classic"].includes(String(value)) ? value as FontCategory : undefined;
}

function colorPaletteFrom(value: unknown): ColorPalette | undefined {
  return ["studio", "ocean", "forest", "sunset", "monochrome", "high-contrast"].includes(String(value)) ? value as ColorPalette : undefined;
}

app.use(express.json({ limit: "16mb" }));

app.get("/api/state", (_request, response) => response.json(studio.getSnapshot()));

app.get("/api/events", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();

  const send = (event: StudioEvent) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  send(studio.getSnapshot());
  studio.on("event", send);
  const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 20_000);
  request.on("close", () => {
    clearInterval(heartbeat);
    studio.off("event", send);
  });
});

app.post("/api/auth/login", async (_request, response) => {
  try {
    response.json(await studio.login());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not start sign in." });
  }
});

app.post("/api/auth/logout", async (_request, response) => {
  try {
    await studio.logout();
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not sign out." });
  }
});

app.post("/api/projects", (request, response) => {
  const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
  response.status(201).json(studio.createProject(prompt, rendererFrom(request.body?.renderer) || "manim"));
});

app.post("/api/projects/:id/messages", async (request, response) => {
  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
  if (!text) return response.status(400).json({ error: "Write a prompt first." });
  try {
    await studio.sendMessage(request.params.id, text, rendererFrom(request.body?.renderer));
    response.status(202).json(studio.getProject(request.params.id));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not start generation." });
  }
});

app.patch("/api/projects/:id/review-preferences", (request, response) => {
  const focus = reviewFocusFrom(request.body?.focus);
  const strictness = reviewStrictnessFrom(request.body?.strictness);
  if (!focus || !strictness) return response.status(400).json({ error: "Choose a valid review focus and strictness." });
  try {
    response.json(studio.updateReviewPreferences(request.params.id, focus, strictness));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not update review settings." });
  }
});

app.patch("/api/projects/:id/design-preferences", (request, response) => {
  const fontCategory = request.body?.fontCategory === undefined ? undefined : fontCategoryFrom(request.body.fontCategory);
  const colorPalette = request.body?.colorPalette === undefined ? undefined : colorPaletteFrom(request.body.colorPalette);
  if ((!fontCategory && request.body?.fontCategory !== undefined) || (!colorPalette && request.body?.colorPalette !== undefined) || (!fontCategory && !colorPalette)) return response.status(400).json({ error: "Choose a valid font category or color palette." });
  try {
    response.json(studio.updateDesignPreferences(request.params.id, { fontCategory, colorPalette }));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not update design settings." });
  }
});

app.get("/api/projects/:id/frames", async (request, response) => {
  const versionId = typeof request.query.version === "string" ? request.query.version : "";
  const time = Number(request.query.time || 0);
  try {
    const frame = await studio.extractFrame(request.params.id, versionId, time);
    response.setHeader("X-Video-Frame", String(frame.frame));
    response.setHeader("X-Video-Time", frame.time.toFixed(6));
    response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    response.sendFile(frame.path);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Could not extract frame." });
  }
});

app.post("/api/projects/:id/reviews", async (request, response) => {
  try {
    const review = await studio.createFrameReview(request.params.id, {
      versionId: String(request.body?.versionId || ""),
      time: Number(request.body?.time || 0),
      note: String(request.body?.note || ""),
      annotatedImageData: String(request.body?.annotatedImageData || ""),
    });
    response.status(202).json(review);
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not send frame feedback." });
  }
});

app.get("/api/assets/search", async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (query.length < 2) return response.status(400).json({ error: "Search with at least two characters." });
  try {
    response.json({ results: await studio.searchAssets(query) });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Asset search failed." });
  }
});

app.post("/api/projects/:id/assets", async (request, response) => {
  try {
    response.status(201).json(await studio.importAsset(request.params.id, request.body));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not import asset." });
  }
});

app.post("/api/projects/:id/cancel", async (request, response) => {
  try {
    await studio.cancel(request.params.id);
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not cancel generation." });
  }
});

app.use("/media", express.static(path.join(root, "studio", "projects"), {
  fallthrough: false,
  immutable: false,
  setHeaders(response) {
    response.setHeader("Cache-Control", "no-cache");
  },
}));

if (process.env.NODE_ENV === "production") {
  const clientDir = path.join(root, "dist", "client");
  app.use(express.static(clientDir));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(clientDir, "index.html")));
} else {
  const vite = await createViteServer({
    root: path.join(root, "client"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Manim Studio is running at http://127.0.0.1:${port}`);
});

void studio.initialize();

function shutdown() {
  studio.bridge.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (!fs.existsSync(manimPath(root))) {
  console.warn("Manim is not installed yet. Run: npm run setup:manim");
}
