import {
  CircleNotch,
  List,
  MagicWand,
  MonitorPlay,
  Star,
  X,
} from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { errorMessage, request } from "./lib/api";
import {
  generationLabel,
  type AccountState,
  type ChatMode,
  type ChatSide,
  type FloatingPosition,
} from "./lib/studio";
import { useStudioEvents } from "./hooks/useStudioEvents";
import { Sidebar } from "./studio/Sidebar";
import { ChatPanel } from "./studio/ChatPanel";
import { VideoWorkspace } from "./studio/VideoWorkspace";
import { BillingDialog } from "./studio/BillingDialog";
import { AccountDialog } from "./studio/AccountDialog";
import type {
  BillingPlanId,
  BillingState,
  ColorPalette,
  FontCategory,
  GenerationEffort,
  GenerationIntent,
  NarrationVoice,
  ReviewFocus,
  ReviewStrictness,
  SendMessageResult,
  StudioProject,
} from "./types";

const Marketing = lazy(() => import("./routes/Marketing"));
const Pricing = lazy(() => import("./routes/Pricing"));
const Policy = lazy(() => import("./routes/Policy"));
const AccessGate = lazy(() => import("./routes/AccessGate"));

function RouteFallback() {
  return <main className="route-fallback" aria-busy="true" />;
}

export function App() {
  const pathname = window.location.pathname;
  const studioRoute = pathname.startsWith("/studio");
  const pricingRoute = pathname.startsWith("/pricing");
  const privacyRoute = pathname.startsWith("/privacy");
  const termsRoute = pathname.startsWith("/terms");

  const [access, setAccess] = useState<AccountState>({
    checked: false,
    configured: false,
    authenticated: false,
  });
  const { state, dispatch, retry } = useStudioEvents(
    studioRoute && access.authenticated,
  );
  const { projects, activeId, auth, billing, runtime, loaded, connection } =
    state;
  const activeProject = projects.find((project) => project.id === activeId);

  const [toast, setToast] = useState("");
  const [billingOpen, setBillingOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("docked");
  const [chatSide, setChatSide] = useState<ChatSide>("left");
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition>({
    x: Math.max(24, window.innerWidth - 520),
    y: 88,
  });
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("preview");

  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const pendingProjectRef = useRef<StudioProject>(undefined);
  const checkoutStarted = useRef(false);

  useEffect(() => {
    if (!studioRoute) return;
    const controller = new AbortController();
    request<{
      configured: boolean;
      authenticated: boolean;
      user?: AccountState["user"];
    }>("/api/auth/status", { signal: controller.signal })
      .then((status) => setAccess({ checked: true, ...status }))
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setAccess({ checked: true, configured: false, authenticated: false });
      });
    return () => controller.abort();
  }, [studioRoute]);

  useEffect(() => {
    if (!loaded || checkoutStarted.current) return;
    const parameters = new URLSearchParams(window.location.search);
    const controller = new AbortController();
    if (parameters.get("checkout") === "success") {
      checkoutStarted.current = true;
      void (async () => {
        try {
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const next = await request<BillingState>("/api/billing", {
              signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            if (next.plan !== "free") {
              dispatch({ type: "billing", billing: next });
              break;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 1_000));
            if (controller.signal.aborted) return;
          }
        } catch {
          // A snapshot from the event stream will carry the updated billing.
        } finally {
          if (!controller.signal.aborted)
            window.history.replaceState({}, "", "/studio");
        }
      })();
    } else {
      const requestedPlan = parameters.get("plan");
      if (
        requestedPlan === "creator" ||
        requestedPlan === "pro" ||
        requestedPlan === "studio"
      ) {
        checkoutStarted.current = true;
        void startCheckout(requestedPlan);
      }
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  function notify(message: string) {
    setToast(message);
  }

  function selectProject(id: string) {
    dispatch({ type: "select", id });
    setDraft("");
    setSendError("");
    setSidebarOpen(false);
  }

  async function createProject() {
    try {
      const project = await request<StudioProject>("/api/projects", {
        method: "POST",
        body: JSON.stringify({}),
      });
      dispatch({ type: "project", project });
      dispatch({ type: "select", id: project.id });
      setDraft("");
      setSendError("");
      setSidebarOpen(false);
      setMobilePane("chat");
    } catch (reason) {
      notify(errorMessage(reason, "Could not create a project."));
    }
  }

  async function toggleFavorite(project: StudioProject) {
    try {
      const updated = await request<StudioProject>(
        `/api/projects/${project.id}/favorite`,
        {
          method: "PATCH",
          body: JSON.stringify({ favorite: !project.favorite }),
        },
      );
      dispatch({ type: "project", project: updated });
    } catch (reason) {
      notify(errorMessage(reason, "Could not update favorites."));
    }
  }

  async function startCheckout(plan: BillingPlanId, email?: string) {
    try {
      const result = await request<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan, email }),
      });
      window.location.href = result.url;
    } catch (reason) {
      notify(errorMessage(reason, "Could not open checkout."));
    }
  }

  async function openBillingPortal() {
    try {
      const result = await request<{ url: string }>("/api/billing/portal", {
        method: "POST",
      });
      window.location.href = result.url;
    } catch (reason) {
      notify(errorMessage(reason, "Could not open billing."));
    }
  }

  async function sendMessage(
    text: string,
    intent: GenerationIntent,
    effort: GenerationEffort,
  ): Promise<boolean> {
    if (sending) return false;
    setSending(true);
    setSendError("");
    try {
      let project = activeProject;
      if (!project) {
        // Reuse a project created by an earlier failed send instead of
        // creating another one.
        pendingProjectRef.current ??= await request<StudioProject>(
          "/api/projects",
          { method: "POST", body: JSON.stringify({}) },
        );
        project = pendingProjectRef.current;
      }
      const result = await request<SendMessageResult>(
        `/api/projects/${project.id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ text, intent, effort }),
        },
      );
      pendingProjectRef.current = undefined;
      dispatch({ type: "project", project: result.project });
      dispatch({ type: "select", id: result.project.id });
      setMobilePane("preview");
      setDraft("");
      // Refreshing the credit balance must never surface as a send failure.
      request<BillingState>("/api/billing")
        .then((next) => dispatch({ type: "billing", billing: next }))
        .catch(() => undefined);
      return true;
    } catch (reason) {
      setSendError(errorMessage(reason, "Could not send the prompt."));
      return false;
    } finally {
      setSending(false);
    }
  }

  async function cancelGeneration() {
    if (!activeProject) return;
    try {
      await request(`/api/projects/${activeProject.id}/cancel`, {
        method: "POST",
      });
    } catch (reason) {
      notify(errorMessage(reason, "Could not stop the generation."));
    }
  }

  async function patchProjectPrefs(path: string, body: unknown) {
    if (!activeProject) return;
    try {
      const project = await request<StudioProject>(
        `/api/projects/${activeProject.id}/${path}`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
      dispatch({ type: "project", project });
    } catch (reason) {
      notify(errorMessage(reason, "Could not save the preference."));
      throw reason;
    }
  }

  if (privacyRoute)
    return (
      <Suspense fallback={<RouteFallback />}>
        <Policy kind="privacy" />
      </Suspense>
    );
  if (termsRoute)
    return (
      <Suspense fallback={<RouteFallback />}>
        <Policy kind="terms" />
      </Suspense>
    );
  if (pricingRoute)
    return (
      <Suspense fallback={<RouteFallback />}>
        <Pricing />
      </Suspense>
    );
  if (!studioRoute)
    return (
      <Suspense fallback={<RouteFallback />}>
        <Marketing />
      </Suspense>
    );

  if (access.checked && !access.authenticated) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <AccessGate
          configured={access.configured}
          onAuthorized={(user) =>
            setAccess((current) => ({
              ...current,
              authenticated: true,
              user,
            }))
          }
        />
      </Suspense>
    );
  }

  if (!access.checked || !loaded) {
    if (access.checked && connection === "reconnecting") {
      return (
        <main className="app-loading" aria-label="Loading Orune">
          <span className="wordmark">Orune</span>
          <p className="loading-error">
            Could not reach the studio. Retrying automatically.
          </p>
          <button className="button button-secondary" onClick={retry}>
            Retry now
          </button>
        </main>
      );
    }
    return (
      <main className="app-loading" aria-label="Loading Orune">
        <span className="wordmark">Orune</span>
        <div className="loading-line">
          <span />
        </div>
      </main>
    );
  }

  return (
    <main
      className={`app-shell mobile-${mobilePane} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <Sidebar
        projects={projects}
        activeId={activeId}
        billing={billing}
        account={access.user}
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onNew={() => void createProject()}
        onSelect={selectProject}
        onFavorite={(project) => void toggleFavorite(project)}
        onBilling={() => setBillingOpen(true)}
        onAccount={() =>
          access.user
            ? setAccountOpen(true)
            : notify("Account details are unavailable right now.")
        }
        onLogout={() =>
          void request("/api/auth/logout", { method: "POST" }).finally(() => {
            window.location.href = "/";
          })
        }
      />
      {sidebarOpen && (
        <button
          className="sidebar-scrim mobile-only"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close projects"
        />
      )}

      <div className="studio-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-only"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open projects"
            >
              <List size={19} />
            </button>
            <span className="topbar-title">
              {activeProject?.title || "Untitled video"}
            </span>
            {activeProject?.status === "running" && (
              <>
                <span className="topbar-divider" aria-hidden="true" />
                <span className="topbar-status" role="status">
                  <span className="status-dot" data-state="running" />
                  {generationLabel(activeProject)}
                </span>
              </>
            )}
            {activeProject?.status === "complete" && (
              <>
                <span className="topbar-divider" aria-hidden="true" />
                <span className="topbar-status" role="status">
                  <span className="status-dot" data-state="complete" />
                  Ready
                  <span className="mono">v{activeProject.versions.length}</span>
                </span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {activeProject && (
              <button
                className={`icon-button project-favorite-top ${activeProject.favorite ? "favorite-active" : ""}`}
                onClick={() => void toggleFavorite(activeProject)}
                aria-label={
                  activeProject.favorite
                    ? "Remove from favorites"
                    : "Add to favorites"
                }
                title={
                  activeProject.favorite
                    ? "Remove from favorites"
                    : "Add to favorites"
                }
              >
                <Star
                  size={16}
                  weight={activeProject.favorite ? "fill" : "regular"}
                />
              </button>
            )}
            <button className="plan-pill" onClick={() => setBillingOpen(true)}>
              <span>{billing.planName}</span>
              <strong>{billing.creditsRemaining} credits</strong>
            </button>
            <button
              className={`view-toggle ${chatCollapsed ? "active" : ""}`}
              onClick={() => {
                setChatCollapsed((value) => !value);
                setPreviewCollapsed(false);
              }}
              aria-label={chatCollapsed ? "Show chat" : "Collapse chat"}
              title={chatCollapsed ? "Show chat" : "Collapse chat"}
            >
              <MagicWand size={16} />
              <span>{chatCollapsed ? "Show chat" : "Chat"}</span>
            </button>
            <button
              className={`view-toggle ${previewCollapsed ? "active" : ""}`}
              onClick={() => {
                setPreviewCollapsed((value) => !value);
                setChatCollapsed(false);
              }}
              aria-label={previewCollapsed ? "Show video" : "Collapse video"}
              title={previewCollapsed ? "Show video" : "Collapse video"}
            >
              <MonitorPlay size={16} />
              <span>{previewCollapsed ? "Show video" : "Focus"}</span>
            </button>
          </div>
        </header>

        {connection === "reconnecting" && (
          <div className="connection-banner" role="status">
            <CircleNotch className="spin" size={13} /> Connection lost —
            reconnecting…
          </div>
        )}

        <div
          className={`studio-grid chat-side-${chatSide} ${chatMode === "floating" ? "chat-is-floating" : ""} ${chatCollapsed ? "chat-is-collapsed" : ""} ${previewCollapsed ? "preview-is-collapsed" : ""}`}
        >
          <ChatPanel
            key={`${activeProject?.id || "new"}:${billing.entitlements.maxEffort}`}
            project={activeProject}
            auth={auth}
            billing={billing}
            runtime={runtime}
            draft={draft}
            sendError={sendError}
            sending={sending}
            onDraft={setDraft}
            onSend={sendMessage}
            onCancel={() => void cancelGeneration()}
            onReviewPreferences={(focus: ReviewFocus, strictness: ReviewStrictness) =>
              patchProjectPrefs("review-preferences", { focus, strictness })
            }
            onDesignPreferences={(changes: {
              fontCategory?: FontCategory;
              colorPalette?: ColorPalette;
            }) => patchProjectPrefs("design-preferences", changes)}
            onNarrationPreferences={(changes: {
              enabled: boolean;
              voice?: NarrationVoice;
            }) =>
              patchProjectPrefs("narration-preferences", changes)
            }
            onGenerationPreferences={(effort: GenerationEffort) =>
              patchProjectPrefs("generation-preferences", { effort })
            }
            onNotify={notify}
            mode={chatMode}
            side={chatSide}
            floatingPosition={floatingPosition}
            onToggleMode={() => {
              setChatCollapsed(false);
              setPreviewCollapsed(false);
              setChatMode((value) =>
                value === "docked" ? "floating" : "docked",
              );
              if (chatMode === "docked")
                setFloatingPosition({
                  x: Math.max(20, window.innerWidth - 520),
                  y: 88,
                });
            }}
            onToggleSide={() =>
              setChatSide((value) => (value === "left" ? "right" : "left"))
            }
            onClose={() => setChatCollapsed(true)}
            onFloatingPosition={setFloatingPosition}
          />
          <VideoWorkspace
            key={activeProject?.id || "new"}
            project={activeProject}
            runtime={runtime}
          />
        </div>

        <nav className="mobile-tabs mobile-only" aria-label="Workspace view">
          <button
            className={mobilePane === "chat" ? "active" : ""}
            onClick={() => setMobilePane("chat")}
          >
            <MagicWand size={17} /> Chat
          </button>
          <button
            className={mobilePane === "preview" ? "active" : ""}
            onClick={() => setMobilePane("preview")}
          >
            <MonitorPlay size={17} /> Preview
          </button>
        </nav>
      </div>
      {billingOpen && (
        <BillingDialog
          billing={billing}
          onClose={() => setBillingOpen(false)}
          onCheckout={(plan) => void startCheckout(plan, billing.email)}
          onPortal={() => void openBillingPortal()}
        />
      )}
      {accountOpen && access.user && (
        <AccountDialog
          account={access.user}
          onClose={() => setAccountOpen(false)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            onClick={() => setToast("")}
            aria-label="Dismiss message"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </main>
  );
}
