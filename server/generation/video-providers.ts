import fs from "node:fs";

export type GeneratedVideoProviderId = "openai" | "runway" | "google";
export type GeneratedVideoStatus = "queued" | "running" | "complete" | "failed";

export interface GeneratedVideoRequest {
  prompt: string;
  width: number;
  height: number;
  seconds: number;
  referenceImageUrl?: string;
  model?: string;
}

export interface GeneratedVideoJob {
  provider: GeneratedVideoProviderId;
  id: string;
  status: GeneratedVideoStatus;
  progress: number;
  outputUrl?: string;
  error?: string;
  model?: string;
  request: GeneratedVideoRequest;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function json(response: Response) {
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(body.error?.message || body.error || body.message || `Provider request failed with ${response.status}.`);
  return body;
}

async function saveResponse(response: Response, destination: string) {
  if (!response.ok) throw new Error(`Provider download failed with ${response.status}.`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
  return destination;
}

export interface GeneratedVideoProvider {
  id: GeneratedVideoProviderId;
  available(): boolean;
  submit(request: GeneratedVideoRequest): Promise<GeneratedVideoJob>;
  inspect(job: GeneratedVideoJob): Promise<GeneratedVideoJob>;
  download(job: GeneratedVideoJob, destination: string): Promise<string>;
}

export class OpenAIVideoProvider implements GeneratedVideoProvider {
  readonly id = "openai" as const;
  constructor(private token = process.env.OPENAI_API_KEY, private fetcher: Fetcher = fetch) {}
  available() { return Boolean(this.token); }
  private headers() { return { Authorization: `Bearer ${required(this.token, "OPENAI_API_KEY")}`, "Content-Type": "application/json" }; }
  async submit(request: GeneratedVideoRequest): Promise<GeneratedVideoJob> {
    const model = request.model || "sora-2-pro";
    const seconds = [4, 8, 12, 16, 20].reduce((best, value) => Math.abs(value - request.seconds) < Math.abs(best - request.seconds) ? value : best, 4);
    const landscape = request.width >= request.height;
    const size = request.width >= 1920 ? (landscape ? "1920x1080" : "1080x1920") : (landscape ? "1280x720" : "720x1280");
    const body: Record<string, unknown> = { model, prompt: request.prompt, seconds: String(seconds), size };
    if (request.referenceImageUrl) body.input_reference = { image_url: request.referenceImageUrl };
    const data = await json(await this.fetcher("https://api.openai.com/v1/videos", { method: "POST", headers: this.headers(), body: JSON.stringify(body) }));
    return this.from(data, request);
  }
  private from(data: Record<string, any>, request: GeneratedVideoRequest): GeneratedVideoJob {
    const status = data.status === "completed" ? "complete" : data.status === "failed" ? "failed" : data.status === "in_progress" ? "running" : "queued";
    return { provider: this.id, id: data.id, status, progress: Number(data.progress || (status === "complete" ? 100 : 0)), error: data.error?.message, model: data.model, request };
  }
  async inspect(job: GeneratedVideoJob): Promise<GeneratedVideoJob> {
    return this.from(await json(await this.fetcher(`https://api.openai.com/v1/videos/${encodeURIComponent(job.id)}`, { headers: this.headers() })), job.request);
  }
  async download(job: GeneratedVideoJob, destination: string) {
    return saveResponse(await this.fetcher(`https://api.openai.com/v1/videos/${encodeURIComponent(job.id)}/content`, { headers: { Authorization: `Bearer ${required(this.token, "OPENAI_API_KEY")}` } }), destination);
  }
}

export class RunwayVideoProvider implements GeneratedVideoProvider {
  readonly id = "runway" as const;
  constructor(private token = process.env.RUNWAYML_API_SECRET || process.env.RUNWAY_API_KEY, private fetcher: Fetcher = fetch) {}
  available() { return Boolean(this.token); }
  private headers() { return { Authorization: `Bearer ${required(this.token, "RUNWAYML_API_SECRET")}`, "Content-Type": "application/json", "X-Runway-Version": "2024-11-06" }; }
  async submit(request: GeneratedVideoRequest): Promise<GeneratedVideoJob> {
    const body = { model: request.model || "gen4.5", promptText: request.prompt, ratio: request.width >= request.height ? "1280:720" : "720:1280", duration: request.seconds <= 5 ? 5 : 10, ...(request.referenceImageUrl ? { promptImage: request.referenceImageUrl } : {}) };
    const endpoint = request.referenceImageUrl ? "image_to_video" : "text_to_video";
    const data = await json(await this.fetcher(`https://api.dev.runwayml.com/v1/${endpoint}`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) }));
    return { provider: this.id, id: data.id, status: "queued", progress: 0, model: body.model, request };
  }
  async inspect(job: GeneratedVideoJob): Promise<GeneratedVideoJob> {
    const data = await json(await this.fetcher(`https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(job.id)}`, { headers: this.headers() }));
    const status: GeneratedVideoStatus = data.status === "SUCCEEDED" ? "complete" : ["FAILED", "CANCELED"].includes(data.status) ? "failed" : data.status === "RUNNING" ? "running" : "queued";
    return { ...job, status, progress: Number(data.progressRatio || (status === "complete" ? 1 : 0)) * 100, outputUrl: data.output?.[0], error: data.failure || data.failureCode };
  }
  async download(job: GeneratedVideoJob, destination: string) {
    return saveResponse(await this.fetcher(required(job.outputUrl, "Runway output URL")), destination);
  }
}

export class GoogleVideoProvider implements GeneratedVideoProvider {
  readonly id = "google" as const;
  constructor(private token = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, private fetcher: Fetcher = fetch) {}
  available() { return Boolean(this.token); }
  private headers() { return { "x-goog-api-key": required(this.token, "GEMINI_API_KEY"), "Content-Type": "application/json" }; }
  async submit(request: GeneratedVideoRequest): Promise<GeneratedVideoJob> {
    const model = request.model || "veo-3.1-generate-preview";
    const body = { instances: [{ prompt: request.prompt }], parameters: { aspectRatio: request.width >= request.height ? "16:9" : "9:16", resolution: request.width >= 1920 ? "1080p" : "720p", durationSeconds: 8 } };
    const data = await json(await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) }));
    return { provider: this.id, id: data.name, status: "queued", progress: 0, model, request };
  }
  async inspect(job: GeneratedVideoJob): Promise<GeneratedVideoJob> {
    const data = await json(await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/${job.id}`, { headers: this.headers() }));
    const failed = Boolean(data.error);
    const outputUrl = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || data.response?.generatedVideos?.[0]?.video?.uri;
    const status: GeneratedVideoStatus = failed ? "failed" : data.done ? "complete" : "running";
    return { ...job, status, progress: data.done ? 100 : Number(data.metadata?.progressPercent || 0), outputUrl, error: data.error?.message };
  }
  async download(job: GeneratedVideoJob, destination: string) {
    return saveResponse(await this.fetcher(required(job.outputUrl, "Google video output URL"), { headers: { "x-goog-api-key": required(this.token, "GEMINI_API_KEY") }, redirect: "follow" }), destination);
  }
}

export class GeneratedVideoRegistry {
  readonly providers: GeneratedVideoProvider[];
  constructor(providers: GeneratedVideoProvider[] = [new OpenAIVideoProvider(), new RunwayVideoProvider(), new GoogleVideoProvider()]) { this.providers = providers; }
  available() { return this.providers.filter((provider) => provider.available()).map((provider) => provider.id); }
  get(id?: string) {
    const preferred = id || process.env.VIDEO_GENERATION_PROVIDER;
    const provider = (preferred ? this.providers.find((candidate) => candidate.id === preferred) : undefined) || this.providers.find((candidate) => candidate.available());
    if (!provider?.available()) throw new Error("No generated-video provider is configured.");
    return provider;
  }
}
