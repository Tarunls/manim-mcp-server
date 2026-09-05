/** Types for the plain-JavaScript lesson pipeline shared with the E2B bootstrap. */
declare module "*/scripts/lesson_pipeline.mjs" {
  export interface StoryboardBeat {
    id: string;
    narration: string;
    visual: string;
    seconds: number;
    start: number;
    end: number;
    duration: number;
  }

  export interface Storyboard {
    version: number;
    title: string;
    brief: string;
    format: "landscape" | "vertical";
    narration: { enabled: boolean; provider?: string; model?: string; voice?: string; voiceId?: string };
    totalSeconds: number;
    beats: StoryboardBeat[];
  }

  export interface PipelineProgress {
    stage: "brief" | "authoring" | "rendering" | "inspecting";
    label: string;
  }

  export interface AuthorLessonOptions {
    root: string;
    projectDir: string;
    brief: string;
    format?: "landscape" | "vertical";
    effort?: "quick" | "balanced" | "thorough";
    narration?: { enabled: boolean; voice?: string };
    design?: unknown;
    assets?: Array<{ localPath: string; title?: string }>;
    revision?: {
      request: string;
      storyboard?: Storyboard;
      scene?: string;
      attachments?: Array<{ path: string; label?: string }>;
    };
    openai: {
      baseUrl: string;
      apiKey: string;
      headers?: Record<string, string>;
      fetchImpl?: typeof fetch;
      maxOutputTokens?: number;
    };
    tts?: {
      speechifyKey?: string;
      elevenLabsKey?: string;
      proxyUrl?: string;
      callbackUrl?: string;
      callbackToken?: string;
    };
    onProgress?: (progress: PipelineProgress) => void | Promise<void>;
    signal?: AbortSignal;
    log?: (line: string) => void;
    maxRepairs?: number;
    review?: boolean;
    env?: NodeJS.ProcessEnv;
  }

  export interface AuthorLessonResult {
    storyboard: Storyboard;
    scene: string;
    metadata: Record<string, unknown>;
  }

  export function resolveModels(
    effort?: "quick" | "balanced" | "thorough",
    env?: NodeJS.ProcessEnv,
  ): { script: { model: string; reasoning: string }; code: { model: string; reasoning: string } };
  export function authorLesson(options: AuthorLessonOptions): Promise<AuthorLessonResult>;
  export function renderProject(options: {
    root: string;
    projectDir: string;
    quality: string;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>>;
  export const STORYBOARD_FILE: string;
  export const SCENE_FILE: string;
  export const NARRATION_FILE: string;
}
