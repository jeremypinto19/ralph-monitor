<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

More detail for this repo: **`.cursor/rules/`** (API routes, AWS/DynamoDB, PostHog, domain types, UI).

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Instructions for AI assistants and humans working in **ralph-monitor** (internal Ralph AI conversation monitoring dashboard).

## Vercel plugin (Cursor)

When work touches **deployment, Vercel project linking, environment variables on Vercel, Marketplace integrations, or platform-specific Next.js behavior**, **use the installed Vercel plugin** instead of guessing CLI flags or outdated platform docs.

- **Slash commands:** **`/deploy`** (preview by default; pass `prod` for production), **`/env`** (list / pull / add / remove / diff), **`/status`** (linked project, deployments, env overview), **`/bootstrap`** (preflight + safe startup for Vercel-linked resources), **`/marketplace`**, **`/conventions`**.
- **Skills:** Let the bundled Vercel skills apply automatically, or lean on them explicitly for **Next.js App Router**, **env vars**, **deployments & CI/CD**, **Turbopack**, **Cache Components**, **AI SDK / AI Gateway**, **Vercel Functions**, **shadcn**, and related topics.
- **Subagents:** Use **`ai-architect`**, **`deployment-expert`**, or **`performance-optimizer`** when the task matches their scope (AI architecture on Vercel, deploy/CI/CD/domains/env, Core Web Vitals and performance).
- **MCP:** Use the **`vercel`** MCP server’s tools when they fit the task. If tools are unavailable, authenticate that server first (e.g. **`mcp_auth`** for `plugin-vercel-vercel`).

Still treat **`node_modules/next/dist/docs/`** and **`.cursor/rules/`** as the source of truth for this repo’s Next.js APIs; the plugin complements that with Vercel platform workflows.

## Commands

```bash
npm run dev      # Next.js dev server (port 1412)
npm run build    # Production build
npm run lint     # ESLint (eslint-config-next)
npm start        # Production server (after build)
```

Package manager is **npm** (lockfile: `package-lock.json`). Do not introduce Yarn or pnpm unless the team standard changes.

---

## Architecture

- **`app/`** — Next.js App Router: pages (`page.tsx`), layouts, and **Route Handlers** under `app/api/*/route.ts`.
- **`components/`** — UI and feature components.
  - **`components/ui/`** — shadcn-style primitives (**base-nova** in `components.json`, not “new-york”).
- **`lib/`** — Shared logic: **`dynamo.ts`** (AWS SSM → STS → DynamoDB), **`posthog.ts`** (server HogQL), **`conversation-posthog-bundle.ts`** (batched HogQL journey + checkout enrich pipeline for the conversations dashboard), **`posthog-row-cache.ts`** (short-lived in-memory bridge between GET `/api/conversations` and POST `posthog-bundle` to avoid duplicate journey HogQL), **`conversation-feedback.ts`** (assistant message vote/reasons summary + Dynamo feedback parsing for the API), **`types.ts`** (domain types aligned with backend Pydantic), **`utils.ts`** (`cn()`, etc.).
- **`public/`** — Static assets.

Path alias: **`@/*`** → project root (`tsconfig.json`).

---

## STRICT RULES

These rules are **mandatory** unless the user explicitly overrides them.

### Always pull first

At the start of a session, before substantial work, run **`git pull`**. Do not stack changes on a stale default branch.

### Styling: shadcn + Tailwind only

- Prefer **shadcn** components from `components/ui/` and **Tailwind** utility classes. Avoid ad-hoc global CSS except in `app/globals.css` where tokens already live.
- Before inventing a new control, check for an existing primitive. Add missing shadcn pieces with the project’s toolchain, e.g. **`npx shadcn@latest add <component>`** (verify against `components.json`).
- Do **not** add other CSS/UI frameworks (MUI, Chakra, Ant Design, Bootstrap, styled-components as a pattern, raw `<style>` blocks for layout).
- Use **`cn()`** from `@/lib/utils` for conditional class names.

### No wild dependencies

Do **not** install new packages without **explicit user approval**. Especially: UI frameworks, global state libraries, or animation stacks. **Icons: `lucide-react` only.**

### Server vs client components

- Default to **Server Components** where it fits the App Router model.
- Add **`'use client'`** only when you need browser APIs, event handlers, or client-side React hooks.
- **Data:** prefer **Route Handlers** (`app/api`) + **`@/lib`** for server-side AWS/PostHog access. The app already uses **Client Components + `fetch` to `/api/*`** on interactive dashboard pages; **new** features should follow the same patterns as the nearest existing page (do not bypass `lib/` for AWS or PostHog from the client).

### AWS and PostHog (server)

- **DynamoDB access** is centralized in **`lib/dynamo.ts`**: `eu-west-3`, env **`AWS_ACCESS_KEY_ID`** / **`AWS_SECRET_ACCESS_KEY`**, SSM-backed assume-role flow. Do not duplicate credential or STS paths; extend helpers there if needed.
- **PostHog** server queries use **`lib/posthog.ts`** and env **`POSTHOG_API_KEY`**. Do not scatter API URLs or project ids.
- Never commit secrets; only reference env var **names** in docs and rules.

### Do not break existing patterns

- Keep the **sidebar + main** shell (`app/layout.tsx`, `components/sidebar.tsx`) unless the user asks for a layout change.
- Do not bypass **`@/lib`** for DynamoDB/PostHog in new server code.
- **New routes or major navigation changes:** confirm with the user if requirements are ambiguous.

### File and folder creation

Do **not** add new **top-level** directories (e.g. a separate `types/` or `services/` tree) without **explicit user approval**. Prefer `lib/` and existing `app/` / `components/` layout.

### When stuck

If something fails after **two** focused attempts, **stop**. Do not spam random fixes, bulk rewrites, or unapproved installs. Summarize what failed, what you tried, and ask the user.

### Post-generation validation

After meaningful code changes, run:

```bash
npm run lint && npm run build
```

Fix reported issues before claiming the work is done. Do not skip this when you have touched code.

---

## Code style

- **TypeScript** with **`strict`** enabled (`tsconfig.json`).
- **ESLint** via `eslint-config-next` — fix new lint issues you introduce.
- Match **existing** formatting in touched files (this repo tends to **double-quoted** strings in TS/TSX).
- Prefer **`interface`** for object shapes where it reads naturally; avoid **`enum`** unless there is a strong reason — consider string unions or `as const` objects.
- **Shared domain types** belong in **`lib/types.ts`** (and stay aligned with the Python/Pydantic source — see `.cursor/rules/lib-types-domain.mdc`). Avoid duplicating large type blocks inside components when they are shared.

---

## Frontend design guidelines

For substantial UI work, you may use the **UI/UX Pro Max** skill when available for palette, typography, and layout discipline.

### Before coding UI

- Clarify purpose, audience, and tone. Aim for a deliberate look, not generic “AI default” chrome.

### Rules

- **Typography:** respect fonts wired in `app/layout.tsx` and tokens in `app/globals.css` — do not silently fall back to unstyled system stacks for main UI.
- **Color:** use **CSS variables** and existing tokens; one dominant family with intentional accents.
- **Motion:** subtle and purposeful; prefer CSS transitions. Avoid noisy micro-interactions.
- **Spacing:** clear hierarchy and breathing room; avoid cramped, undifferentiated grids.
- **Backgrounds:** prefer depth (layers, subtle gradients or surfaces) over flat white slabs when it fits the rest of the app.

### Avoid

- Clichéd purple gradients on white, cookie-cutter card stacks, **Inter** as a thoughtless default, excessive shadows or radius “to look modern,” random neon accents, cluttered layouts without hierarchy.

---

## Git commits

Use **atomic** commits: one commit per logical change.

### Flow

1. `git status` and `git diff` to review.
2. Split into the smallest coherent units.
3. `git add` → `git diff --staged` → `git commit -m "type(scope): description"`.
4. Repeat until clean.

### Format

```
type(scope): description
```

Prefixes: `feat`, `fix`, `refactor`, `docs`, `test`, `perf`, `chore`, `ci`, `build`, `style`.

### Rules

- Keep the subject line short (aim **≤ 60** characters).
- Present tense (**add**, not _added_). Drop filler (**the**, **a**) where it stays readable.
- Do **not** add “Co-Authored-By” or mention AI tools in commit messages unless the user asks.

---

## Keep AGENTS.md up to date

After **structural** changes, update **this file**. Examples:

- New top-level area under `app/` or a new stable `lib/` module → **Architecture**.
- New required **environment variable** → **AWS and PostHog** (or a dedicated env subsection).
- New **approved** dependency or tooling → **Commands** / **No wild dependencies**.

Treat **`AGENTS.md`** plus **`.cursor/rules/`** as the canonical agent-facing project contract.
