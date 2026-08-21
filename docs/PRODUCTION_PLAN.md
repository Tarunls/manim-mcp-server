# Lesson Studio — Production Readiness Plan

**Status:** Draft v1 · **Date:** 2026-08-21 · **Branch:** `codex/manim-studio-mvp` @ `15eb0c0`

---

## 0. Current State

| Item | Status |
|---|---|
| Local branch backup | Pushed to `origin/codex/ai-video-studio-mvp` (commit `d12c5ee`) |
| Working tree | Reset to `origin/codex/manim-studio-mvp` tip (`15eb0c0`), no merge |
| `npm run dev` | **Fixed** — was failing because `stripe` + new deps weren't installed after the branch switch. Ran `npm install`; server boots clean |
| **Live URL** | **http://127.0.0.1:4321** (HTTP 200 verified) |

### ⚠️ Security incident (action required)

The OpenAI key (`sk-proj-…`) and E2B key (`e2b_…`) were pasted into plaintext chat. Treat both as compromised:

- [ ] **Rotate the OpenAI key** at platform.openai.com after integration is done
- [ ] **Rotate the E2B key** at e2b.dev/dashboard
- Keys go only into `.env` (gitignored, confirmed), Convex env vars, or cloud Secret Manager. Never in code, commits, or chat.

---

## 1. Target Architecture

```
Browser ──► Convex Auth (users, sessions, projects metadata, credits, billing state)
                │
                ▼
        Node orchestrator (Express, thin)
        ├── SandboxManager (E2B pool, lifecycle, watchdogs)
        ├── ModelRouter (per-stage model/effort selection, token budgeting)
        ├── QuotaService (duration caps, concurrency, spend limits)
        └── ArtifactStore (object storage for mp4/posters/versions)
                │
                ▼
        E2B Firecracker sandbox (per active session)
        ├── codex app-server (JSON-RPC over stdio, bridged by orchestrator)
        ├── project files (synced in/out)
        └── Manim + FFmpeg + Remotion render toolchain (baked into template)
```

Key principle: **the orchestrator owns no rendering and no secrets beyond broker access.**
Everything expensive or risky runs inside a disposable microVM.

---

## 2. E2B Sandbox Orchestration (the hard part)

This is not "wrap codex in E2B and call it a day." At thousands of users we need full lifecycle management.

### 2.1 Custom template
Build `lesson-studio-agent` template (one-time, versioned):
- Node 22, `@openai/codex` CLI pinned
- Python + Manim + FFmpeg + fonts pre-installed (kills cold-start setup time)
- 4 vCPU / 8 GiB (Manim renders are CPU-bound; 512 MB default would thrash)
- Template rebuilt via CI when deps change; old template kept for rollback

### 2.2 SandboxManager responsibilities

| Concern | Design |
|---|---|
| **Spawning** | One sandbox per *active generation session*, created on demand from warm-pool-friendly template. Creation rate-limited (E2B allows 5/sec on Pro). Global semaphore sized to plan concurrency (100 on Pro, up to 1,100 negotiated) |
| **User↔sandbox binding** | Registry map `userId+projectId → sandboxId`, persisted in Convex so an orchestrator restart can reattach instead of orphaning sandboxes |
| **Connection stability** | Heartbeat every 15 s; RPC calls get retry-with-backoff; on transport drop, reconnect to same sandbox (E2B supports reconnect by ID) and `thread/resume` the codex thread — the user's browser SSE just buffers and replays |
| **Codex crashes** | Detect process exit inside sandbox → capture stderr → auto-restart codex once in-place with `thread/resume`; second failure fails the turn gracefully, refunds the credit hold, and surfaces a user-facing message |
| **Hangs** | Two-tier watchdog: (a) no RPC activity for 90 s during a turn → nudge/interrupt; (b) turn wall-clock cap (default 8 min, hard 15 min) → `turn/interrupt` → kill sandbox → mark failed. No silent infinite sandboxes, ever |
| **Sandbox lifetime** | Hard TTL (default 45 min continuous, well under Hobby's 1 h cap while we're small). Between turns, if idle > 5 min → snapshot needed files back → kill. Billing stops the moment it dies |
| **Cleanup** | On kill: sync artifacts out first (double-confirm), close codex stdio bridge, remove from registry, emit audit event. A periodic reaper sweeps for registry entries whose sandbox died unexpectedly |
| **Crash of orchestrator itself** | All sandbox IDs live in Convex; new orchestrator instance reconciles: resumes or kills every listed sandbox. No leaked compute |

### 2.3 Scale path
- 0–20 concurrent: E2B Hobby (free, $100 credit)
- 20–100 concurrent: E2B Pro ($150/mo)
- >100: negotiate concurrency with E2B (they go to 1,100+) or add a second provider behind the same `SandboxManager` interface (Daytona/Modal have near-identical rates — the interface makes swapping trivial)
- Queue overflow users get "you're #N in line" instead of errors; queue depth triggers autoscaling alerts

---

## 3. Auth & Multi-Tenancy (Convex)

- **convex-auth** with email magic-code + Google OAuth
- Every Express route gets an auth middleware that validates the Convex-issued session; project access checked against ownership (today the server trusts any caller — unacceptable in prod)
- Stripe checkout/webhooks keyed to Convex userId (billing-service already models free/creator/pro tiers — moves its state into Convex tables)
- Projects metadata (id, owner, status, credits spent, versions index) in Convex; heavy artifacts stay on object storage, referenced by Convex
- Rate limits per user: N generations/hour on free, more on paid; global daily spend circuit-breaker that pauses generation if OpenAI burn exceeds threshold

---

## 4. Fine-Grained Model Routing

You were right that we can go finer than "sol vs terra." The insight: **output tokens are 6–25× more expensive than input**, and most pipeline stages are either cheap-output or cache-heavy-input. Routing is config-driven (`server/model-router.config.ts`) so we can tune without code changes.

Current prices (post 2026-07-30 cut): Sol $5/$30, Terra $2/$12, Luna $0.20/$1.20 per MTok (in/out); cached reads 90% off; reasoning effort scales output tokens dramatically, so cheap stages also get lower effort.

### Stage breakdown

| # | Stage | Model | Effort | Rationale |
|---|---|---|---|---|
| 1 | Intent parse / request classification | **Luna** | low | trivial classification; wrong guess caught next stage |
| 2 | Topic research + beat plan draft | **Terra** | high | needs world knowledge + structure; near-Sol quality here |
| 3 | Beat plan critique / self-review | **Sol** | medium | the one place judgment pays for itself; reviews Terra's plan cheaply (small input) |
| 4 | Project graph authoring | **Terra** | high | structured JSON generation; validator catches errors deterministically |
| 5 | scene.py / video.tsx authoring | **Sol** | high | quality-critical core; never downgrade |
| 6 | Contact-sheet / poster visual inspection | **Sol** | medium | vision judgment gates quality; images dominate input (cached-cheap) |
| 7 | Layout/repair turn (only if #6 flags issues) | **Sol** | high | pay premium only when actually repairing |
| 8 | Narration script writing | **Terra** | medium | prose quality matters, but Terra handles 18–45-word passages fine |
| 9 | Asset search decision + candidate triage | **Luna** | low | classification over previews' descriptions |
| 10 | Revision requests (small edits) | **Terra** | high | scoped subtree edits; escalate to Sol only if review fails twice |
| 11 | Metadata/QA summaries, changelogs | **Luna** | low | boilerplate |
| 12 | Final acceptance review before delivery | **Sol** | medium | last line of defense; small focused input |

Escalation rule: any stage can be configured to *escalate* (retry once on the next tier up) instead of fail. Quality floor is enforced by deterministic validators + stage 12, not by brute-force model choice.

### Other cost levers
- Prompt-caching: stable system prompts + reference docs first in context → 90% discount on repeated input (codex threads naturally benefit since each turn resends history)
- Cap attached image resolution/count per review turn (contact sheet at high detail is expensive input)
- Per-turn token budgets enforced by the router; exceeding budget interrupts and escalates to a compacted context
- Kill idle sandboxes fast (compute is small but nonzero)

---

## 5. Cost Estimate Per Video

Assumptions from observing this workload: a first draft is ~10 turns, ~350–600K input tokens total (heavily cached after turn 1), 40–70K output tokens, 1 repair pass on ~half of videos, ~18 min sandbox time at 4 vCPU/8 GiB.

### Per-stage cost (first draft, optimized routing)

| Stage | Model | In (MTok, eff.) | Out (MTok) | Cost |
|---|---|---|---|---|
| Intent parse | Luna | 0.02 | 0.002 | ~$0.01 |
| Research + beat plan | Terra | 0.06 | 0.007 | ~$0.20 |
| Plan critique | Sol | 0.03 (cached) | 0.005 | ~$0.11 |
| Graph authoring | Terra | 0.08 (cached) | 0.010 | ~$0.14 |
| Code authoring | Sol | 0.12 (cached) | 0.022 | ~$0.54 |
| Visual inspection | Sol | 0.10 (cached, imgs) | 0.006 | ~$0.16 |
| Repair (50% of videos) | Sol | 0.08 avg | 0.009 | ~$0.19 |
| Narration | Terra | 0.04 (cached) | 0.004 | ~$0.09 |
| Asset triage | Luna | 0.02 | 0.002 | ~$0.01 |
| QA + metadata | Luna | 0.04 | 0.004 | ~$0.01 |
| Acceptance review | Sol | 0.03 (cached) | 0.004 | ~$0.09 |
| **Model subtotal** | | | | **≈ $1.55** |

### Compute + other

| Item | Calc | Cost |
|---|---|---|
| E2B sandbox | 18 min × (4×$0.000014 + 8×$0.0000045)/s ≈ 1080s × $0.000092 | ≈ $0.10 |
| Speechify narration (existing) | ~45 s audio | ~$0.05–0.15 |
| Object storage + egress | negligible amortized | < $0.01 |
| **All-in per first draft** | | **≈ $1.75 ± 0.40** |

### Scenarios

| Scenario | Est. cost/video |
|---|---|
| Today: everything Sol/xhigh, local render, no caching discipline | **$5.50 – $8.00** |
| Optimized routing above, healthy run | **≈ $1.75** |
| Repair-heavy video (2 repair passes) | **≈ $2.60** |
| Simple revision turn (existing video) | **≈ $0.35 – $0.70** |
| Blended (assume 55% clean drafts, 35% one repair, 10% heavy) | **≈ $2.05** |

At blended ~$2.05 COGS: Free tier (say 3 videos/mo) costs ~$6/user — free tier must be tightly capped; Creator/Pro tiers ($X/mo) price at ≥4× COGS margin. Exact consumer pricing is a business decision — flagging the unit economics so we pick plan limits consciously.

*(Sol promo $4/$20 runs through Nov 21, 2026 — estimates use conservative list prices where they differ. Recheck if OpenAI reprices.)*

---

## 6. Limits & Quotas (production hardening)

| Limit | Default | Where enforced |
|---|---|---|
| Max video duration | 90 s target, 120 s hard (validator rejects longer beat plans) | graph validator + render contract |
| Max turns per generation | 14 | orchestrator |
| Turn wall-clock | 8 min soft / 15 min hard | turn watchdog |
| Session (sandbox) lifetime | 45 min continuous | SandboxManager TTL |
| Sandbox idle timeout | 5 min → snapshot + kill | SandboxManager |
| Concurrent generations per user | 1 (free) / 3 (paid) | Convex + semaphore |
| Monthly generations | plan-based (free: 3) | billing service |
| Spend circuit breaker | global $ daily cap; kills new spawns when hit | QuotaService |
| File sync size cap | 200 MB/project round-trip | artifact store |
| Request payload/rate limits | standard express-rate-limit | middleware |

Every limit returns a *typed, user-visible* error ("Your video hit the 90-second cap — trim a beat") rather than a generic failure.

---

## 7. Observability & Ops

- Structured logs (pino) per request/session/sandbox with correlation IDs
- Metrics dashboard: spawn success rate, mean turn latency, codex crash count, hang-kill count, tokens+$ per stage per video, queue depth
- Alerting: sandbox leak (>N running with no session), spend anomaly, error-rate spike
- Per-video cost receipt stored in Convex (stage-by-stage token counts) — powers user-facing usage pages and our own tuning
- Staging environment: separate Convex deployment, separate E2B project, Stripe test mode

## 8. Delivery Plan (phases)

1. **Phase 1 — Sandbox runtime (week 1):** E2B template, SandboxManager with watchdogs/cleanup/reconnect, codex bridge over E2B, artifact sync. Dev flow still works locally without E2B (fallback executor).
2. **Phase 2 — Model router + limits (week 1–2):** stage router config, token budgeting, duration caps, typed limit errors, per-stage cost logging. Measure real per-stage tokens to replace estimates.
3. **Phase 3 — Convex + auth (week 2):** convex-auth (magic code + Google), users/projects/credits/billing tables, route-level authorization, Stripe wired to Convex state.
4. **Phase 4 — Production hardening (week 2–3):** rate limiting, circuit breakers, reaper, metrics/alerts, staging deploy, load test (simulate 50 concurrent generations).
5. **Phase 5 — Launch:** rotate keys, deploy prod (Convex prod + orchestrator on Fly/Railway/Cloud Run + E2B Pro), smoke tests, on-call runbook.

## 9. Decisions Needed From You

1. **Auth methods**: magic-code email only, or add Google OAuth? (recommend both)
2. **Deployment host** for the orchestrator: Fly.io, Railway, or Google Cloud Run (README hints Cloud Run)?
3. **Plan limits**: confirm free tier = 3 videos/month, max 90 s each?
4. **Consumer pricing** for Creator/Pro tiers (affects quota config only; Stripe test products already scaffolded).
5. Confirm you've **rotated both keys** once Phase 1 lands.
