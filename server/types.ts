export type ProjectStatus = "idle" | "running" | "complete" | "error" | "cancelled";
export type ProjectStage = "ready" | "brief" | "authoring" | "rendering" | "inspecting" | "complete";
export type RendererKind = "manim" | "remotion" | "composite";
export type AgentModel = "gpt-5.6-sol" | "gpt-5.6-terra";
export type GenerationEffort = "quick" | "balanced" | "thorough";
export type AgentReasoningEffort = "medium" | "high" | "xhigh";
export type GenerationIntent = "auto" | "new" | "revise";
export type BillingPlanId = "free" | "creator" | "pro" | "studio";
export type ReviewFocus = "balanced" | "layout" | "motion" | "pedagogy" | "accessibility" | "polish";
export type ReviewStrictness = "quick" | "normal" | "obsessive";
export type FontCategory = "modern" | "editorial" | "technical" | "friendly" | "classic";
export type ColorPalette = "cinematic" | "studio" | "ocean" | "forest" | "sunset" | "monochrome" | "high-contrast";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  streaming?: boolean;
  attachment?: { type: "frameReview"; imageUrl: string; label: string };
}

export interface AgentAction {
  id: string;
  label: string;
  status: "running" | "done" | "failed";
  createdAt: string;
}

export interface RenderInfo {
  renderer?: RendererKind;
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
}

export interface FrameReview {
  id: string;
  versionId: string;
  time: number;
  frame: number;
  note: string;
  createdAt: string;
  cleanFrameUrl: string;
  annotatedFrameUrl: string;
}

export interface ProjectAsset {
  id: string;
  title: string;
  description?: string;
  provider: "Wikimedia Commons";
  sourceUrl: string;
  license: string;
  licenseUrl?: string;
  creator?: string;
  localPath: string;
  mediaUrl: string;
  sha256: string;
  importedAt: string;
}

export interface ReviewPreferences {
  focus: ReviewFocus;
  strictness: ReviewStrictness;
}

export interface DesignPreferences {
  fontCategory: FontCategory;
  colorPalette: ColorPalette;
}

export interface NarrationPreferences {
  enabled: boolean;
}

export interface GenerationPreferences {
  effort: GenerationEffort;
  model: AgentModel;
  reasoningEffort: AgentReasoningEffort;
}

export interface StudioProject {
  id: string;
  ownerId: string;
  favorite: boolean;
  title: string;
  prompt: string;
  renderer: RendererKind;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  stage: ProjectStage;
  threadId?: string;
  turnId?: string;
  videoUrl?: string;
  posterUrl?: string;
  versions: ProjectVersion[];
  reviews: FrameReview[];
  assets: ProjectAsset[];
  reviewPreferences: ReviewPreferences;
  designPreferences: DesignPreferences;
  narrationPreferences: NarrationPreferences;
  generationPreferences: GenerationPreferences;
  error?: string;
  messages: ChatMessage[];
  actions: AgentAction[];
}

export interface BillingEntitlements {
  creditsPerMonth: number;
  maxEffort: GenerationEffort;
  narration: boolean;
  licensedAssets: boolean;
}

export interface BillingState {
  userId: string;
  plan: BillingPlanId;
  planName: string;
  status: "free" | "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  creditsUsed: number;
  creditsRemaining: number;
  periodEnd: string;
  email?: string;
  isStaff: boolean;
  stripeConfigured: boolean;
  billingMode: "test" | "live" | "unconfigured";
  hasStripeCustomer: boolean;
  entitlements: BillingEntitlements;
}

export interface PricingPlan {
  id: BillingPlanId;
  name: string;
  monthlyPrice: number;
  description: string;
  entitlements: BillingEntitlements;
  features: string[];
}

export type StudioEvent =
  | { type: "snapshot"; projects: StudioProject[]; auth: AuthState; runtime: RuntimeState; billing: BillingState }
  | { type: "project"; project: StudioProject }
  | { type: "assistant_delta"; projectId: string; messageId: string; delta: string }
  | { type: "auth"; auth: AuthState }
  | { type: "runtime"; runtime: RuntimeState };

export interface AuthState {
  connected: boolean;
  email?: string;
  plan?: string;
  mode?: string;
}

export interface RuntimeState {
  codex: boolean;
  manim: boolean;
  remotion: boolean;
  ffmpeg: boolean;
}

export interface SendMessageResult {
  project: StudioProject;
  startedFresh: boolean;
  mode: "first-draft" | "revision";
}
