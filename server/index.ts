import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { StudioService } from "./studio-service.js";
import type { StudioEvent } from "./types.js";
import { parseProvider } from "./assets/service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const app = express();
const studio = new StudioService(root);
const port = Number(process.env.PORT || 4321);

app.use(express.json({ limit: "1mb" }));

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
  response.status(201).json(studio.createProject(prompt));
});

app.post("/api/projects/:id/messages", async (request, response) => {
  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
  if (!text) return response.status(400).json({ error: "Write a prompt first." });
  try {
    await studio.sendMessage(request.params.id, text);
    response.status(202).json(studio.getProject(request.params.id));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Could not start generation." });
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

app.get("/api/projects/:id/timeline", (request, response) => {
  try {
    response.json(studio.getTimeline(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Project not found." });
  }
});

app.put("/api/projects/:id/timeline", (request, response) => {
  try {
    response.json(studio.updateTimeline(request.params.id, request.body));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid timeline." });
  }
});

app.get("/api/renderers", (_request, response) => response.json(studio.getRenderers()));

app.post("/api/projects/:id/timeline/route", (request, response) => {
  try {
    response.json(studio.routeTimeline(request.params.id));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Could not route shots." });
  }
});

app.post("/api/projects/:id/render", async (request, response) => {
  try {
    response.status(201).json(await studio.renderTimeline(request.params.id));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not render timeline." });
  }
});

app.get("/api/assets/search", async (request, response) => {
  const query = typeof request.query.query === "string" ? request.query.query.trim() : "";
  if (!query) return response.status(400).json({ error: "Asset search requires a query." });
  try {
    response.json(await studio.assets.search({
      query,
      kind: typeof request.query.kind === "string" ? request.query.kind as any : undefined,
      provider: parseProvider(request.query.provider),
      commercialUse: request.query.commercial !== "false",
      modifications: request.query.modifications !== "false",
      limit: Number(request.query.limit || 24),
    }));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Asset search failed." });
  }
});

app.post("/api/projects/:id/assets/import", async (request, response) => {
  try {
    response.status(201).json(await studio.importAsset(request.params.id, request.body));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Asset import failed." });
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

if (!fs.existsSync(path.join(root, ".venv", "bin", "manim"))) {
  console.warn("Manim is not installed yet. Run: npm run setup:manim");
}
