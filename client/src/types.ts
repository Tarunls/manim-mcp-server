import type { StudioJob } from "../../shared/jobs";
import type { VideoProjectIR } from "../../shared/video-ir";

export type ProjectStatus = "idle" | "running" | "complete" | "error" | "cancelled";
export type ProjectStage = "ready" | "brief" | "authoring" | "rendering" | "inspecting" | "complete";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  streaming?: boolean;
}

export interface AgentAction {
  id: string;
  label: string;
  status: "running" | "done" | "failed";
  createdAt: string;
}

export interface RenderInfo {
  quality?: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  bitRate?: number;
  narration?: {
    status?: string;
    enabled?: boolean;
    provider?: string;
    model?: string;
    voice?: string;
    segments?: number;
    segmentDurations?: number[];
    audioFormat?: string;
    style?: string;
    rate?: string;
    disclosure?: string;
  };
}

export interface ProjectVersion {
  id: string;
  number: number;
  createdAt: string;
  prompt: string;
  videoUrl: string;
  posterUrl?: string;
  render?: RenderInfo;
  projectUrl?: string;
  proxyUrl?: string;
}

export interface StudioProject {
  id: string;
  title: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  stage: ProjectStage;
  threadId?: string;
  turnId?: string;
  videoUrl?: string;
  posterUrl?: string;
  proxyUrl?: string;
  versions: ProjectVersion[];
  error?: string;
  messages: ChatMessage[];
  actions: AgentAction[];
  timeline?: VideoProjectIR;
}

export interface AuthState {
  connected: boolean;
  email?: string;
  plan?: string;
  mode?: string;
}

export interface RuntimeState {
  codex: boolean;
  manim: boolean;
  ffmpeg: boolean;
}

export type StudioEvent =
  | { type: "snapshot"; projects: StudioProject[]; auth: AuthState; runtime: RuntimeState; jobs: StudioJob[] }
  | { type: "project"; project: StudioProject }
  | { type: "assistant_delta"; projectId: string; messageId: string; delta: string }
  | { type: "auth"; auth: AuthState }
  | { type: "runtime"; runtime: RuntimeState }
  | { type: "job"; job: StudioJob };
