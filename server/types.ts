export type ProjectStatus = "idle" | "running" | "complete" | "error" | "cancelled";
export type ProjectStage = "ready" | "brief" | "authoring" | "rendering" | "inspecting" | "complete";
// The studio renders every lesson with Manim. The field is kept on stored
// project documents so rows written before the Manim-only change still parse.
export type RendererKind = "manim";
// Model names are configuration (shared/models.json plus ORUNE_* overrides),
// so the stored preference only records what a generation used.
export type AgentModel = string;
export type GenerationEffort = "quick" | "balanced" | "thorough";
export type AgentReasoningEffort = string;
export type GenerationIntent = "auto" | "new" | "revise";
export type BillingPlanId = "free" | "creator" | "pro" | "studio";
export type ReviewFocus = "balanced" | "layout" | "motion" | "pedagogy" | "accessibility" | "polish";
export type ReviewStrictness = "quick" | "normal" | "obsessive";
export type FontCategory = "serif" | "sans" | "mono";
export type ColorPalette = "paper" | "ochre" | "sage" | "monochrome";
export type NarrationVoice = "default-female" | "seductive-female" | "seductive-male" | "seductive-female-accent";

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
    hasAudio?: boolean;
    provider?: string;
    model?: string;
    voice?: string;
    voiceId?: string;
    segments?: number;
    segmentDurations?: number[];
    audioFormat?: string;
    style?: string;
    rate?: string;
    pausePolicy?: string;
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
  voice?: NarrationVoice;
}

export type VideoFormat = "landscape" | "vertical";

export interface GenerationPreferences {
  effort: GenerationEffort;
  model: AgentModel;
  reasoningEffort: AgentReasoningEffort;
  /** The frame the lesson is composed for. "vertical" is the 9:16 phone cut
   * used for TikTok and Reels; it changes the typographic grid, not just the
   * output size, so it must be chosen before the scene is written. */
  format: VideoFormat;
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
  /** A model endpoint is configured, so scripts and scenes can be written. */
  model: boolean;
  manim: boolean;
  ffmpeg: boolean;
}

export interface SendMessageResult {
  project: StudioProject;
  startedFresh: boolean;
  mode: "first-draft" | "revision";
}
