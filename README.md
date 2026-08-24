# Manim MCP Server

## Lesson Studio MVP

The production foundation is implemented; staging and launch certification remain. The trust boundaries, data flow, and security requirements are documented in [docs/PRODUCTION_ARCHITECTURE.md](docs/PRODUCTION_ARCHITECTURE.md), with current progress in [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

Hosted mode uses `EXECUTION_MODE=e2b`, PostgreSQL, Cloud Tasks, private GCS artifacts, and a pinned E2B template. Build that template with `npm run e2b:build-template`; production startup intentionally fails if any required hosted dependency is missing.

Deployment is defined in [infra/terraform](infra/terraform/README.md). Follow [the GCP runbook](docs/DEPLOYMENT_RUNBOOK.md) and [production checklist](docs/PRODUCTION_CHECKLIST.md); applying Terraform is a deliberate billable operation and is not part of ordinary application CI.

This repository includes a local prompt-to-video studio with an explicit per-project renderer choice. Choose Manim for equations and geometry, Remotion for editorial motion, or Composite when a Remotion-directed video should contain self-contained Manim inserts. Composite does not let two layout engines compete: Remotion always owns the final canvas.

Rendered revisions include a seven-frame filmstrip. Pause anywhere, select **Review frame**, draw with the default pen or choose a circle, arrow, or rectangle, add a note, and send the clean plus annotated frame to the model as direct high-detail image inputs. The reviewer isolates the smallest marked target and records nearby objects that must remain unchanged.

The agent automatically decides whether authentic imagery would help. When it would, it searches Wikimedia Commons with a context-rich query, downloads local candidate previews, visually checks at least three, and imports only a semantic match with creator, description, license, source URL, and SHA-256 digest. The manual asset picker remains available. Project settings expose a plain-language Thinking control, font categories, color palettes, voice control, review focus, and review depth; generation reads those settings from versioned JSON files.

New projects default to Composite, Balanced thinking, modern type, and the studio's cinematic visual language. Four representative frames from each of the successful Fourier and integral lessons are attached to every first-draft turn as visual quality targets, and the complete integral video is available locally as a pacing reference. The internal source scaffold lives under `reference-template/`, not as active renderable source. The agent is told to preserve the exemplars' pacing, hierarchy, spaciousness, and Manim/Remotion division of labor while rebuilding all subject-specific teaching content. Rendering is blocked until the current request has a fresh topic-specific beat plan and transformed source; unchanged template clips and leftover reference-topic content are rejected. The request selector can force a new template-based video or a revision; Auto starts standalone video prompts and failed first attempts in a fresh project instead of quietly reusing an old plan.

### Run it

Prerequisites:

- Node.js 22 or newer
- Python 3.10 or newer
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)
- FFmpeg and FFprobe available on `PATH`
- An [OpenAI Platform API key](https://platform.openai.com/api-keys)

From a fresh clone:

```sh
npm install
npm run setup:manim
cp .env.example .env
# Set OPENAI_API_KEY, IDENTITY_PLATFORM_API_KEY, and a 32+ character
# SESSION_SECRET in .env. Add the optional provider keys you use.
npm run build
npm run dev
```

Open `http://127.0.0.1:4321`.

`npm run setup:manim` creates a repository-local `.venv` and installs Manim Community Edition 0.19.x. The app stores local conversations and rendered media under `studio/projects/`; that directory is intentionally excluded from Git.

For narration, revoke any key that has been pasted into chat or committed anywhere, then place a replacement in a local `.env` file that is never committed:

```sh
cp .env.example .env
# Edit .env and set SPEECHIFY_API_KEY on the server only.
npm run dev
```

Or export it for the current shell before starting the server:

```sh
export SPEECHIFY_API_KEY="your-replacement-key"
npm run dev
```

Never put the key in a `VITE_*` variable. Vite exposes those values to browser code. Narration is generated server-side through `https://api.speechify.ai` with Speechify `simba-3.2`; the UI labels the result as an AI voice. The default voice is `geffen_32`, configurable through `SPEECHIFY_VOICE_ID`.

Narration uses 3-5 chapter-length passages instead of isolated sentence clips. The server adds warm SSML delivery, a slightly slower speaking rate, 160 kbps source audio, short fades, and loudness normalization. Timing is validated against the scene: a render fails if a passage overlaps the next visual chapter. Fallback TTS providers are forbidden, and completed videos are accepted only when metadata confirms Speechify `simba-3.2` and FFprobe finds a real audio track.

Local mode starts an isolated Codex App Server authenticated with `OPENAI_API_KEY`, so generation is usage-billed through the OpenAI API and never reuses a developer's ChatGPT/Codex OAuth session. Hosted E2B workers instead receive an active-job-scoped proxy token in `.env`; the upstream OpenAI key remains in the API service and direct E2B access to `api.openai.com` is blocked. The compatible Codex CLI is installed as a project dependency by `npm install`; the server places its temporary API credential cache outside the developer's normal Codex profile. Lesson Studio presents Faster, Balanced, and Try harder choices instead of model or reasoning jargon. Internally, Faster uses a cost-conscious configuration, Balanced preserves the studio's established high-quality default, and Try harder adds deeper reasoning for difficult generations.

### Billing

The front page and studio use a server-enforced monthly credit model: Free includes 1 credit, Creator is $20/month with 10 credits, and Pro is $49/month with 30 credits. Faster costs 1 credit, Balanced costs 2, and Try harder costs 4. Creator and Pro unlock Speechify narration and licensed visual search. Checkout and subscription management use Stripe-hosted pages; signed webhooks are the source of truth for paid access.

Install and authenticate the Stripe CLI, then create the test-mode product catalog once:

```sh
stripe login
npm run stripe:setup
```

Copy `.env.example` to `.env`, set `STRIPE_SECRET_KEY` to a Stripe sandbox or test secret, set `ALLOW_TEST_CHECKOUT=true` only for local or staging billing tests, and start the local webhook forwarder in a second terminal. Stripe CLI sandboxes can be kept separate from another Stripe account by naming the profile:

```bash
stripe sandbox create --non-interactive --from-git --project-name lesson-studio
STRIPE_CLI_PROJECT=lesson-studio npm run stripe:setup
stripe --project-name lesson-studio listen --events checkout.session.completed,checkout.session.async_payment_succeeded,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed --forward-to http://127.0.0.1:4321/api/stripe/webhook
```

Never commit the sandbox key. Put it in Secret Manager as `stripe_sandbox_api_key` for staging. Production must use a distinct live restricted key and keep `ALLOW_TEST_CHECKOUT=false`.

```sh
npm run stripe:listen
```

Copy the `whsec_...` value printed by the listener into `STRIPE_WEBHOOK_SECRET`, then restart the app. Never commit either secret. The setup script is idempotent because Checkout resolves the stable lookup keys `lesson_studio_creator_monthly` and `lesson_studio_pro_monthly` instead of hard-coded price IDs.

### Google Cloud deployment

The included `Dockerfile` packages Node, FFmpeg, Manim, and Remotion's browser dependencies for Cloud Run. `cloudbuild.yaml` caches the heavy rendering layers. The public homepage and pricing page require no account; the studio uses Google Cloud Identity Platform email/password accounts with mandatory email verification. Staff emails receive the full internal plan without requiring a Stripe subscription.

The scalable Terraform deployment expects these existing Secret Manager names:

- `openai_api_key` -> `OPENAI_API_KEY`
- `e2b_api_key` -> `E2B_API_KEY`
- `stripe_sandbox_api_key` -> `STRIPE_SECRET_KEY` in staging; use a separate live-key secret in production
- `stripe_webhook_secret` -> `STRIPE_WEBHOOK_SECRET`
- `speechify_key` -> `SPEECHIFY_API_KEY`
- `identity_platform_api_key` -> `IDENTITY_PLATFORM_API_KEY`
- `staff_emails` -> `STAFF_EMAILS`

Terraform generates the database URL, job callback secret, and audit secret, and grants each Cloud Run identity access only to its required secrets. The API stores metadata in regional Cloud SQL and media in private GCS; E2B generation is asynchronous through Cloud Tasks, so Cloud Run remains stateless and horizontally scalable. The older `identity:setup`, `gcp:storage`, and `stripe:cloud-webhook` scripts exist for the legacy singleton only and must not be used to mutate a Terraform-managed staging or production environment.

Public deployments must use a live Stripe secret before paid buttons are enabled. Keep `ALLOW_TEST_CHECKOUT=false` in production. Before collecting live payments, configure the appropriate tax registrations and decide whether Stripe Tax should be enabled; do not turn on automatic tax collection without those business decisions.

### Useful commands

```sh
npm run dev          # local server with reload
npm run check        # TypeScript validation
npm run build        # production client build + validation
npm run test         # unit and database-gated integration tests
npm run test:e2e     # desktop/mobile route, accessibility, and CSRF tests
npm start            # serve the production build
npm run setup:manim  # create/update the local Manim environment
npm run stripe:setup # create missing test products and monthly prices
npm run stripe:listen # forward selected test webhooks to the local app
npm run stripe:cloud-webhook # create and securely attach a Cloud Run test webhook
npm run identity:setup # provision Identity Platform and staff access
npm run gcp:storage # attach persistent Cloud Storage data
npm run smoke:identity # temporary real Identity Platform account/session test
npm run smoke:stripe # real sandbox Checkout creation against a disposable DB user
npm run smoke:e2b # pinned no-internet E2B runtime test with guaranteed teardown
```

If the app reports that Manim or FFmpeg is unavailable, confirm `.venv/bin/manim --version`, `ffmpeg -version`, and `ffprobe -version` work from the repository root. The MVP binds to `127.0.0.1:4321` by default; set `PORT` to use another local port.

### How generation works

1. The Node backend signs an isolated Codex worker into API-key mode, then starts one long-lived `codex app-server` process over stdio.
2. Each video gets its own folder under `studio/projects/` and its own Codex thread.
3. The renderer choice is fixed when generation starts. Codex writes `scene.py` for Manim, `video.tsx` for Remotion, or `video.tsx` plus `manim/*.py` and `composite.json` for Composite.
4. The matching render helper produces 1920×1080 video at 30 fps, validates layout, optimizes MP4 seeking, extracts a poster and twelve-frame contact sheet, and records the selected renderer in metadata.
5. If `narration.json` and a server API key are present, timed speech segments are generated and muxed into the MP4.
6. Every successful result is copied to an immutable `versions/vNNN/` folder, so older revisions remain playable in the same conversation.
7. Server-sent events stream normalized agent and render state to the browser. Raw reasoning and command output stay on the backend.

The server binds to `127.0.0.1` for local MVP use. Do not expose it directly to the internet. A hosted version should move rendering into isolated workers and add application authentication, rate limits, object storage, and per-user project authorization.

### Production build

```sh
npm run build
npm start
```

### Project output

Every successful generation remains editable:

```text
studio/projects/<project-id>/
  scene.py or video.tsx
  composite.json (Composite projects)
  manim/ (Composite insert sources)
  public/assets/ (licensed imported assets)
  assets.json
  asset-decision.json
  review-config.json
  review-report.json
  design-config.json
  reviews/ (clean and annotated frame feedback)
  narration-config.json
  narration.json (only used when AI voice is enabled)
  output.mp4
  poster.png
  contact-sheet.png
  metadata.json
  versions/
    v001/
    v002/
```

### Collision checks

Layout is checked by code as well as by image review. Manim projects use `assert_no_overlap` for stable poses and `watch_no_overlap` during motion. Remotion projects wrap independent visual groups in `LayoutItem`; `LayoutAudit` checks their browser bounds on every rendered frame. Intentional composites should be grouped so container-child overlap is not mistaken for a collision.

## MCP server

![Manim MCP Demo](Demo-manim-mcp.gif)


## Overview

This is an MCP (Model Context Protocol) server that executes Manim animation code and returns the generated video. It allows users to send Manim scripts and receive the rendered animation.

## Features

- Executes Manim Python scripts.
- Saves animation output in a visible media folder.
- Allows users to clean up temporary files after execution.
- Portable and configurable via environment variables.

## Installation

### Prerequisites

Ensure you have the following installed:

- Python 3.8+
- Manim (Community Version)
- MCP

### Install Manim

```sh
pip install manim
```

### Install MCP

```sh
pip install mcp
```

### Clone the Repository

```sh
git clone https://github.com/abhiemj/manim-mcp-server.git
cd manim-mcp-server
```

## Integration with Claude

To integrate the Manim MCP server with Claude, add the following to your `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
     "manim-server": {
      "command": "/absolute/path/to/python",
      "args": [
        "/absolute/path/to/manim-mcp-server/src/manim_server.py"
      ],
      "env": {
        "MANIM_EXECUTABLE": "/Users/[Your_username]/anaconda3/envs/manim2/Scripts/manim.exe"
      }
    }
  }
}
```

### Finding Your Python Path

To find your Python executable path, use the following command:

#### Windows (PowerShell):
```sh
(Get-Command python).Source
```

#### Windows (Command Prompt/Terminal):
```sh
where python
```

#### Linux/macOS (Terminal):
```sh
which python
```

This ensures that Claude can communicate with the Manim MCP server to generate animations dynamically.

## Contributing

1. Fork the repository.
2. Create a new branch:
   ```sh
   git checkout -b add-feature
   ```
3. Make changes and commit:
   ```sh
   git commit -m "Added a new feature"
   ```
4. Push to your fork:
   ```sh
   git push origin add-feature
   ```
5. Open a pull request.

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.

## Author

Created by **[abhiemj](https://github.com/abhiemj)**. Contributions welcome! 🚀

### **Listed in Awesome MCP Servers**  
This repository is featured in the [Awesome MCP Servers](https://github.com/punkpeye/awesome-mcp-servers) repository under the **Animation & Video** category. Check it out along with other great MCP server implementations!


## **Acknowledgments**  
- Thanks to the [Manim Community](https://www.manim.community/) for their amazing animation library.  
- Inspired by the open-source MCP ecosystem.

## Find me at
<a href="https://www.instagram.com/aiburner_official" target="blank"><img align="center" src="https://raw.githubusercontent.com/rahuldkjain/github-profile-readme-generator/master/src/images/icons/Social/instagram.svg" alt="aiburner_official" height="30" width="40" /></a>
@aiburner_official
