# UX sweep of the creation flows, November 2026

A hands-on pass through the dashboard as a new user would take it: bring up the stack with sign-in, create a workspace, a provider profile, a provider and a sandbox, run a coding agent against a local model, hit a network block, approve the proposal, read the logs, move files. Then each creation flow in depth.

- **Date:** 2026-11-15. **Branch:** `main` at `227035a`. **Gateway:** OpenShell 0.1.6 (the pinned release), Docker driver on colima, sign-in through Keycloak and oauth2-proxy.
- **Users:** `admin1` (platform admin) and `user1` (standard user, added to `team-a` as User), from the dev realm.
- **Model:** Ollama 0.40.16 in a container on the colima VM, `qwen2.5:3b` and `qwen3:4b`, reached by the sandbox at `host.openshell.internal:11435` through an imported provider profile. Agent: Claude Code 2.1.156 from the community `base` image.
- **Browser:** the built-in browser pane. The pane was hidden for most of the run, so screenshots after the first few are stale. Findings come from page text, the requests the page made and the BFF, gateway and sandbox logs. Two screenshots are in `docs/ux-sweep-2026-11/`.

Severity: **blocker** (a basic task cannot be done), **error** (something fails, or fails silently), **confusing** (works, but a new user is likely to go wrong), **polish**. Items marked **→ issue** have a drafted GitHub issue at the end; none has been filed.

## Top 5

1. **Blocker: "Create profile" cannot make a profile that works.** The form has no fields for protocol, access, enforcement, binaries or how a credential is sent. The gateway refuses any credentialed profile it produces ("credentialed endpoint … uses L4-only"). A credential-less one would be imported, but with no `binaries` its endpoints admit no process. The refusal comes back as HTTP 201 and a yellow "Validation diagnostics" warning, and the modal stays open. [P1](#p1) → issue A.
2. **Error: two of the three policy presets block the traffic they are named for.** "Anthropic API agent" has no `binaries`, so on 0.1.6 (`require_binary_identity` defaults to true) nothing can reach api.anthropic.com: curl and node both get `transparent_tcp_policy_denied`. "GitHub read-only" uses the read-only access preset for github.com, which denies `POST …/git-upload-pack`, so `git clone` fails with `fatal: expected flush after ref listing`. It also allows only `/usr/bin/git`, so curl and gh can't reach api.github.com. [S2](#s2) → issue B.
3. **Error: "Locked down (no network)" sandboxes cannot write `/dev/null`.** The gateway adds `/dev/null`, `/dev/urandom` and `/var/log` to a policy only when it has network rules. The locked-down preset has none, and the dashboard's base policy leaves those paths out, so `git` and any shell redirect to `/dev/null` fail with `Permission denied`. Attaching any provider adds network rules and hides the problem. [S3](#s3) → issue B.
4. **Blocker for a new gateway: no path to "you need a provider profile first".** Gateway 0.1.x ships no profiles. The Get started card says Workspace → Add a provider → Create a sandbox, and its "Add a provider" link opens the workspace on the Sandboxes tab. The Add provider modal then offers a Type list with nothing in it and no hint to import a profile. The profile page's empty state mentions "the examples OpenShell publishes" without a link. [G1](#g1), [P4](#p4) → issue C.
5. **Error (dev setup): `make dev-full` cannot start when anything holds port 3000,** and the port can't be changed. The UI port is hard-coded in both `frontend/vite.config.ts` (`port: 3000, strictPort: true`) and `scripts/dev-env.sh` (`UI_PORT=3000`). On this Mac a Vite from another worktree and colima's k3d forward both held :3000, so the documented path stopped at its first check. [D1](#d1) → issue D.

What works well, so it isn't lost among the findings: the workspace, provider and sandbox create flows (once a usable profile exists); the role-aware UI for `user1`; the terminal; uploads and downloads with clear errors; logs, whose denial lines name the binary, the policy and a symlink hint; proposals (review token, approve, undo); multi-file profile import that the gateway validates before anything is written; the env-var choice for multi-key credentials; templates.

## End-to-end task: what happened

| Step | Result |
|---|---|
| Stack up (`make setup`, `make gateway`, `make dev-full`) | Did not start as documented: see [D1](#d1)–[D3](#d3). Ran the same pieces by hand: gateway and Keycloak through `scripts/dev-env.sh up --sign-in`, BFF on :8090, Vite on :3010, oauth2-proxy on :4180 with the flags from `dev-env.sh proxy`. |
| Sign in as admin1 | Works. Lands on Workspaces, not on the Gateway page where Get started is ([G2](#g2)). |
| Create workspace `team-a` | Works. |
| Provider profile | Create profile form: refused by the gateway ([P1](#p1)). **Import from files** with a hand-written YAML: works. |
| Provider `ollama-anthropic` with a credential | Works. The credential field is labelled `api_key` and stored as `ANTHROPIC_API_KEY`. |
| Sandbox `agent1`: base image, Locked down, provider attached | Works, READY in about 30 s once the 4 GB image was pulled. |
| Shell | The Terminal tab's WebSocket works (`?start=message` with command and environment). |
| Model call | `curl` to Ollama through the provider's endpoint returned an Anthropic Messages response. The credential was injected; the provider adds `_provider_ollama_anthropic` to the effective policy. |
| Run the agent | `claude -p … --model qwen3:4b` reached Ollama and ran real turns (200s on `/v1/messages`), but no small CPU model finished a tool call: `qwen2.5:3b` wrote to `/path`, and `qwen3:4b` took 3m50s per turn and timed out. This is model capacity, not the dashboard; see [E1](#e1). |
| Network block | `curl https://pypi.org` was refused, and a proposal `allow_pypi_org_443` (binary `/usr/bin/curl`) appeared within seconds. |
| Review and approve | Proposals page → sandbox → Approve: policy v3. curl then got 200 from pypi, but `pip` was still denied because the rule names curl only ([S5](#s5)). |
| Logs | Clear: each denial names the binary, ancestors and policy. |
| Upload and download | Upload of `note.txt` to `/sandbox/uploads` works. Download of a file, of a directory (tar) and of a missing path (404, `file_not_found`) work. |
| As user1 | Sees `team-a` only, no Add provider or Add member. Created a sandbox fine. Admin URLs redirect to Workspaces. A workspace user1 isn't in shows the gateway's CLI hint ([U1](#u1)). |
| Template | Create template, then create a sandbox from it, both work ([S7](#s7)). |

## Findings by flow

### Local stack (docs and scripts)

<a id="d1"></a>**D1. error: the UI port is fixed at 3000, so `make dev` and `make dev-full` stop when anything holds it.** `scripts/dev-env.sh ports` refuses ("port 3000 on this machine is in use … If 'make dev' or 'make dev-full' holds it, stop that one with Ctrl-C"), and there is no override: `UI_PORT=3000` in `scripts/dev-env.sh` and `port: 3000, strictPort: true` in `frontend/vite.config.ts`. The hint assumes the holder is another make target; here it was a Vite in another worktree plus colima's port forward for an unrelated k3d cluster. The agent-ops brief already lists "something else on the Mac often holds :3000". *Fix:* read `UI_PORT` from the environment in both places (Vite `server.port = Number(process.env.UI_PORT ?? 3000)`), pass it to the proxy's `--upstream`, and say so in the error and in `docs/development.md`. **→ issue D.**

<a id="d2"></a>**D2. confusing: the realistic workaround is undocumented.** With :3000 taken, getting sign-in means running four things by hand: `dev-env.sh up --sign-in`, the BFF with `PORT`, Vite with `--port` and `BFF_URL`, and oauth2-proxy with 28 flags copied out of `dev-env.sh`. D1's fix removes the need. Until then, a "port 3000 is taken" note in `docs/development.md` would help.

<a id="d3"></a>**D3. polish (machine, not repo):** colima was stopped, and the docker CLI's compose plugin was a dangling symlink into a removed OrbStack. `dev-env.sh` reported both well ("docker cannot reach a daemon…", "docker compose is not installed"). Worth one line in the docs: `brew install docker-compose` and `cliPluginsExtraDirs`.

<a id="d4"></a>**D4. polish: sign-out with two tabs open can end in a 500.** After `/oauth2/sign_out`, both tabs went back through Keycloak at once. One redeemed the code, the other got `invalid_grant "Code not valid"` from oauth2-proxy and showed its bare 500 page. This is oauth2-proxy behaviour, low priority.

### Gateway overview and Get started

<a id="g1"></a>**G1. blocker (new gateway): Get started leaves out the provider-profile step, and its link opens the wrong tab.** Screenshot: `docs/ux-sweep-2026-11/gateway-get-started.jpg`. Step 2 "Add a provider" links to `/workspaces/default`, which opens on the Sandboxes tab (`frontend/src/pages/GatewayOverviewPage.tsx` ~l.870; the workspace page's tab is local state, not in the URL: `WorkspaceDetailPage.tsx` l.76). On 0.1.x no provider can be created until a profile is imported (hard fact 24). *Fix:* add a step "Import a provider profile" (→ `/provider-profiles`) before "Add a provider", and make the workspace tabs URL-addressable (`?tab=providers`, like the sandbox page already is). **→ issue C.**

<a id="g2"></a>**G2. confusing: a platform admin lands on Workspaces, not the Gateway page** that holds Get started and Needs attention. A new admin never sees the walkthrough unless they click Gateway. Related to open issue #100 (landing page). *Fix:* land a platform admin on `/gateway` while the gateway is empty.

<a id="g3"></a>**G3. polish:** the workspace page's Sandboxes tab has no count while every other tab has one (`Templates 0`, `Providers 1`…).

### Provider profiles

<a id="p1"></a>**P1. blocker: the Create profile form cannot produce a usable profile.** (`frontend/src/components/CreateProfileModal.tsx`)
- Fields offered: ID, display name, description, category, inference capable, credentials (name, env vars, required), endpoints (host, port).
- Missing: protocol, access, enforcement, TLS, L7 rules, **binaries**, a credential's `auth_style` / `header_name`, `allow_uninspected_credentials`.
- Reproduce: credential `api_key` / `ANTHROPIC_API_KEY`, endpoint `host.openshell.internal:11435`, Create profile. The body sent was `{"profiles":[{"id":"ollama", …,"endpoints":[{"host":"host.openshell.internal","port":11435}]}]}`. The response was **201** `{"diagnostics":[{"field":"endpoints[0].allow_uninspected_credentials","message":"credentialed endpoint 'host.openshell.internal:11435' uses L4-only; configure L7 inspection or explicitly set allow_uninspected_credentials: true","severity":"error"}],"profiles":[],"imported":false}`.
- The modal shows it as a yellow **Warning** "Validation diagnostics" and stays open. A user can't act on it, because none of the named fields are in the form.
- A profile without credentials is imported, but with no `binaries` the gateway requires a binary match (`require_binary_identity` defaults to true in 0.1.6 `sandbox-policy.rego`), so its endpoints admit nothing.
- Upstream's own README for these files calls `binaries` "the control that decides which processes may reach its endpoints".
- *Fix, in order of size:*
  1. When `imported` is false, render the diagnostics as a danger alert titled "The gateway did not create the profile" (`CreateProfileModal.tsx` ~l.377–390). The BFF mirroring the gateway's success status is fine (ADR 0003).
  2. Add endpoint protocol (default `rest`), access and enforcement, a binaries list, and auth style and header per credential, with defaults that the gateway accepts.
  3. Until then, label the form as covering simple, credential-less cases only, and point to Import from files.

  **→ issue A.**

<a id="p2"></a>**P2. confusing: "Required" is unchecked by default for a new credential,** while every upstream example profile sets `required: true`.

<a id="p3"></a>**P3. polish: "Import from files" mentions "the examples OpenShell publishes" without a link.** Link to `https://github.com/NVIDIA/OpenShell/tree/v<release>/providers` for the pinned release. Also say what upstream's header comments say: copy the file and edit `binaries` to match your image.

<a id="p4"></a>**P4. blocker (new gateway): the Add provider modal has no empty state.** With no profiles the Type select holds only the disabled "Select a provider type", with no hint why (`frontend/src/components/provider/ProviderFormModal.tsx` ~l.411). Screenshot of the providers empty state: `docs/ux-sweep-2026-11/workspace-no-providers.jpg`; its copy ("Providers register inference endpoints … (Anthropic, NVIDIA NIM, GitLab, …)") suggests those exist. *Fix:* when `profiles.data` is empty, show an inline alert, "No provider profiles yet. A platform admin imports them under Provider profiles, or a workspace admin under this workspace's Profiles tab", with a link for admins. **→ issue C.**

<a id="p5"></a>**P5. polish: the provider list's credential cell reads "1/1 req, 1 key"** and its policy cell "1 endpoint, 2 bins, inference". Both are compact but cryptic; spell them out or add a tooltip.

<a id="p6"></a>**P6. polish: a new provider shows Age "-".** The create response carries `createdAtMs: 0` (the gateway's answer), and the list shows "-" until a refetch.

<a id="p7"></a>**P7. polish: the provider form doesn't say what the sandbox will see.** The credential field is labelled with the credential's name (`api_key`); the env var it becomes (`ANTHROPIC_API_KEY`) shows only when a profile offers several. One helper line, "Available in the sandbox as `ANTHROPIC_API_KEY` (a placeholder the proxy replaces)", would explain the model. Multi-key credentials (`claude-code`: `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`) already offer the choice clearly.

### Create sandbox and the policy presets

All three presets were created through the BFF with exactly the body the form sends (`frontend/src/components/policy/policyTemplates.ts`), on the base image, and probed with curl, node and git:

| Probe | Locked down | Anthropic API agent | GitHub read-only |
|---|---|---|---|
| `curl https://api.anthropic.com` | denied (expected) | **denied** | denied |
| `node fetch(api.anthropic.com)` | denied (expected) | **denied, EACCES** | denied |
| `curl https://api.github.com` | denied (expected) | denied | **denied** (only `/usr/bin/git` allowed) |
| `git ls-remote` / `git clone` github.com | **`/dev/null: Permission denied`** | denied | **`expected flush after ref listing`** (`POST …/git-upload-pack` denied by L7 read-only) |
| pypi.org, registry.npmjs.org | denied (expected) | denied | denied |

<a id="s1"></a>**S1. confusing: no preset fits the most common case, an agent that needs its model plus package registries,** and nothing says that attaching a provider is how model access is normally granted. "Locked down (no network)" plus a provider *does* reach the provider's endpoints (that is how `agent1` worked), but the preset's name says "no network". *Fix:* say under the Providers field, "Attached providers add their own endpoints to the policy". Consider renaming the preset to "No network beyond attached providers".

<a id="s2"></a>**S2. error: the "Anthropic API agent" and "GitHub read-only" presets fail silently.**
- *Evidence:* the sandbox logs show `NET:OPEN DENIED /usr/bin/node -> api.anthropic.com:443 [reason:transparent_tcp_policy_denied]` and `HTTP:POST DENIED … git-upload-pack [policy:github engine:l7]`.
- Inside the sandbox the agent sees only `EACCES` or "Couldn't connect to server"; nothing tells the user the preset is wrong. The proposals that follow (add `/usr/bin/node` to `anthropic`, add `git-remote-http` to github.com) are the only way out.
- *Cause:* the Anthropic rule has no `binaries`, and 0.1.6 requires a binary match. The GitHub rule uses `access: read-only`, which upstream's `providers/github.yaml` explicitly replaces with GET/HEAD/OPTIONS plus `POST /**/git-upload-pack`.
- *Fix:*
  - Anthropic: add binaries (`/usr/local/bin/claude`, `/usr/bin/claude`, `/usr/bin/node`, `/usr/bin/curl`) or drop the preset in favour of attaching a provider.
  - GitHub: copy upstream's rules and binaries (`/usr/bin/git`, `/usr/local/bin/git`, `/usr/bin/gh`, `/usr/local/bin/gh`).
  - The compat suite (`backend/test/compat/testdata/policy_presets.json`) proves only that the gateway *accepts* each preset. Add a probe that it *admits* the intended traffic, for example `git ls-remote` for GitHub.

  **→ issue B.**

<a id="s3"></a>**S3. error: the base policy of every preset lacks `/dev/null`, `/dev/urandom` and `/var/log`.**
- The effective policy of a locked-down sandbox is exactly the preset; of a sandbox with network rules it is the preset plus those paths (compare `/policy/effective` for `p-locked` and `p-anthropic`).
- Upstream's own default, `restrictive_default_policy()` in `openshell-policy` 0.1.6, has `read_only: /bin /usr /lib /proc /dev/urandom /etc /var/log` and `read_write: /tmp /dev/null`.
- *Fix:* align `basePolicy` in `policyTemplates.ts` with it, keeping `/sandbox` and `/app`. **→ issue B.**

<a id="s4"></a>**S4. polish: preset descriptions don't say what they leave out.** "Good default for untrusted code" doesn't warn that `pip`, `npm` and `git` will all be blocked until proposals are approved. Add one line per preset on what an agent will hit.

<a id="s5"></a>**S5. confusing: approving a proposal admits only the binary that asked.** After approving `allow_pypi_org_443`, curl reached pypi but `pip` (python 3.14 under `/sandbox/.uv/...`) was still denied, and a new proposal appeared. This is upstream's binary scoping, and correct, but the Approve button and the row don't say "for `/usr/bin/curl` only". Show the binary in the proposal row, not only in the rationale text. The Edit flow is where a user could widen it.

<a id="s6"></a>**S6. polish: Proposals page.** The sandbox name is not a link; only the count is (`proposals-link-team-a/agent1`). Several hidden tab panels render expand toggles with the same id (`expand-toggle0` ×3), so the ids are duplicated.

<a id="s7"></a>**S7. polish: templates take environment as comma-separated `KEY=value` text,** while Create sandbox uses key/value rows (`CreateTemplateModal.tsx` vs `CreateSandboxModal.tsx`). A value containing a comma can't be entered. Use the same `KeyValueEditor`.

<a id="s8"></a>**S8. confirm: Create sandbox does have an environment-variable editor.** It sits under Advanced options, which is folded. The inference docs' Ollama example needs `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL`, so that is a fair place for it; no change needed.

### Sandbox: terminal, files, logs, policy

<a id="t1"></a>**T1. check: closing the terminal's WebSocket may not end the command.** A `claude -p` started over `/terminal?start=message`, whose client socket was abandoned when my script timed out, kept running for its full 7 minutes alongside a second run. I could not tell whether the socket really closed (the page stayed open), so this is unverified. Worth a test in `terminal_handler.go`: close the client socket and check that the relay ends the exec.

<a id="t2"></a>**T2. polish: policy revision v1 shows SUPERSEDED with no "Loaded" right after create.** The gateway immediately writes v2, the enriched policy. A user reading Revision history will wonder what changed. One helper line: "The gateway adds its baseline paths on create".

Logs, Files (upload, file and directory download, missing path) and the Policy tab's static/editable split were clear and worked.

### Global policy and settings

<a id="gp1"></a>**GP1. confusing: "This is the platform ceiling mechanism"** contradicts the sentence before it ("applies to all sandboxes in full (no merge with per-sandbox policies)"). A ceiling suggests an upper bound intersected with each sandbox's policy; per hard fact 23 it replaces it. The set-policy modal says it plainly ("replacing their effective policy"); align the page header. Also warn that providers' endpoints and approved proposals stop applying while it is set. Applying one was not tested here; open issue #99 covers the create-sandbox side.

<a id="st1"></a>**ST1. confusing: Settings lists four raw keys with "—" and no explanation.** `agent_policy_proposals_enabled` shows "—" while proposals were clearly being generated. A user can't tell the effective default, what each key does, or the allowed values of `proposal_approval_mode` and `ocsf_schema_version`. *Fix:* a one-line description per known key and its allowed values. The types are known (hard fact 21).

### Members and the standard user

<a id="u1"></a>**U1. polish: a non-member opening a workspace sees the gateway's CLI instruction** ("ask a platform admin to run: openshell workspace member add …") and a Retry button that can't help. Add the dashboard's own wording: "You're not a member of `default`. A platform admin adds you under Workspaces → default → Members with your subject ID (user menu → Copy my subject ID)". Drop Retry for this code.

<a id="u2"></a>**U2. polish: Members shows only the subject UUID.** This is what the gateway returns; a "you" marker for the current user would help.

<a id="u3"></a>**U3. polish: admin-only URLs (`/settings`, `/global-policy`, `/provider-profiles`, `/gateway`) silently redirect a standard user to Workspaces.** A short "needs a platform admin" notice would be clearer.

### Running an agent against a local model

<a id="e1"></a>**E1. What a user needs to know (docs, not a bug):**
- **Host Ollama is usually unreachable.** Ollama on macOS listens on 127.0.0.1 by default. A sandbox reaches `host.openshell.internal`, which is the Docker host (the colima VM), not the Mac. Either run Ollama where the Docker daemon runs (a container publishing 11434), or start the Mac's Ollama with `OLLAMA_HOST=0.0.0.0` and point the profile at an address the VM can route to.
- **Ollama in colima is CPU-only** (no Metal in the VM). A 4B model took about 4 minutes per Claude Code turn at Ollama's default 4096-token context, which truncates Claude Code's system prompt; no small model completed a tool call. Use a remote model, or Ollama on the host with GPU and a larger `OLLAMA_CONTEXT_LENGTH`.
- **The working recipe:** a profile with `protocol: rest`, `enforcement: enforce`, `binaries: [/usr/local/bin/claude, /usr/bin/curl]` and a header credential `ANTHROPIC_API_KEY` / `x-api-key` (Ollama ignores the value). Attach it to the sandbox and set `ANTHROPIC_BASE_URL=http://host.openshell.internal:<port>` in the sandbox or template environment. Ollama 0.40 serves the Anthropic Messages API at `/v1/messages`.
- A docs page "Run Claude Code against a local model" in this repo, built from this recipe, would save the next person most of this sweep.

### Conventions noticed in passing

- `frontend/src/components/CursorPageTransition.css` is a project CSS file, which ADR 0004 and `react.md` rule out. polish

## Small fixes worth doing first

None of these were made in this session.

1. `policyTemplates.ts`: add `/dev/urandom` and `/var/log` (read-only) and `/dev/null` (read-write) to `basePolicy`; give the Anthropic preset binaries; replace the GitHub preset's github.com endpoint with upstream's four rules and four binaries. Update `backend/test/compat/testdata/policy_presets.json` to match (the spec test enforces this).
2. `GatewayOverviewPage.tsx`: add the profile step and link providers to `?tab=providers`, with `WorkspaceDetailPage.tsx` reading and writing `tab` from the URL.
3. `ProviderFormModal.tsx`: empty-state alert when there are no profiles.
4. `CreateProfileModal.tsx`: a danger alert when `imported` is false.
5. `vite.config.ts` and `scripts/dev-env.sh`: honour `UI_PORT`.
6. Global policy page header: drop "ceiling".

## Drafted issues for ai-openshell/console (not filed)

### A. Provider profiles: "Create profile" cannot make a profile the gateway accepts or that admits any traffic

> The Create provider profile form (`CreateProfileModal.tsx`) offers host and port for an endpoint and name/env vars/required for a credential. On gateway 0.1.6:
>
> - A profile with a credential is refused: the import answers 201 with `imported: false` and the diagnostic `endpoints[0].allow_uninspected_credentials: credentialed endpoint '<host>:<port>' uses L4-only; configure L7 inspection or explicitly set allow_uninspected_credentials: true` (severity `error`). The modal shows it as a yellow warning and none of the fields it names are in the form.
> - A profile without credentials imports, but has no `binaries`; with `require_binary_identity` on by default, its endpoints admit no process, so a provider of that type never lets traffic through.
>
> Steps: Provider profiles → Create profile → ID `demo`, a credential `api_key` / `DEMO_API_KEY`, endpoint `api.example.com:443` → Create profile.
>
> Expected: either a profile that works, or a form that says it can't make one and points to Import from files.
>
> Proposal: (1) render `imported: false` as a danger alert, "The gateway did not create the profile"; (2) add endpoint protocol (default `rest`), access, enforcement, a binaries list, and per credential `auth_style` and `header_name`; (3) link the upstream examples for the pinned release.

### B. Create sandbox: the policy presets block what they are named for

> Created on gateway 0.1.6 with the body the form sends, on `sandboxes/base`:
>
> - **Anthropic API agent**: the rule has no `binaries`, so with binary identity required nothing reaches api.anthropic.com (`NET:OPEN DENIED /usr/bin/node -> api.anthropic.com:443 [reason:transparent_tcp_policy_denied]`).
> - **GitHub read-only**: `access: read-only` on github.com denies `POST /<repo>.git/git-upload-pack`, so `git clone` fails (`fatal: expected flush after ref listing`). Upstream's `providers/github.yaml` spells out GET/HEAD/OPTIONS + `POST /**/git-upload-pack` for exactly this reason. Only `/usr/bin/git` may connect, so `gh` and curl can't reach api.github.com.
> - **Locked down (no network)**: the base policy has no `/dev/null`, `/dev/urandom` or `/var/log`; the gateway adds them only when the policy has network rules, so `git` and any `>/dev/null` fail with `Permission denied`. Upstream's `restrictive_default_policy()` includes all three.
>
> The compat suite proves the gateway accepts each preset, not that it admits the intended traffic.
>
> Proposal: align `basePolicy` with upstream's restrictive default; add binaries to the Anthropic preset (or drop it in favour of attaching a provider); copy upstream's GitHub rules and binaries; add a compat probe per preset (e.g. `git ls-remote https://github.com/octocat/Hello-World.git`).

### C. A new gateway has no provider profiles, and nothing in the UI says so

> Gateway 0.1.x ships no profiles, so no provider can be created until one is imported. But:
>
> - The Gateway page's Get started lists Workspace → Add a provider → Create a sandbox; "Add a provider" opens `/workspaces/default` on the Sandboxes tab.
> - The Add provider modal's Type select is empty, with no explanation.
> - The providers empty state lists "Anthropic, NVIDIA NIM, GitLab, …" as if they existed.
>
> Proposal: add "Import a provider profile" to Get started; make the workspace tabs URL-addressable and link `?tab=providers`; show an inline alert in Add provider when there are no profiles, linking to Provider profiles for admins; link the upstream example profiles from the import modal.

### D. make dev-full: the UI port is fixed at 3000

> `scripts/dev-env.sh` (`UI_PORT=3000`) and `frontend/vite.config.ts` (`port: 3000, strictPort: true`) fix the UI dev server's port, so `make dev` and `make dev-full` refuse to start whenever anything else holds :3000, often an unrelated local cluster's port forward. The error suggests stopping another make target, which isn't the cause.
>
> Proposal: read `UI_PORT` from the environment in both (the proxy's `--upstream` follows), mention it in the error and in `docs/development.md`.

## Leftovers from this sweep

In workspace `team-a`:
- Sandboxes: `agent1`, `p-locked`, `p-anthropic`, `p-github`, `u1-box`, `tpl-box`.
- Providers: `ollama-anthropic`.
- Profiles: `claude-code` and `github` at workspace scope, `ollama-anthropic` at platform scope.
- Template: `claude-ollama`.
- Member: `user1`.

Outside the dashboard: an Ollama container `ux-sweep-ollama` (volume `ux-sweep-ollama`, port 11435) on colima. `make dev-reset` removes the gateway's data and sandboxes; it does not remove the Ollama container.
