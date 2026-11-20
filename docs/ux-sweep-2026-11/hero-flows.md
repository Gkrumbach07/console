# Hero flows: quick, guided, document, guarded

This merges five read-only reviews (onboarding, providers, the day-2 loop,
templates and governance, upgrade robustness), run on 2026-11-15 against this
worktree, gateway 0.1.6. File references are to `frontend/src/` unless they say
otherwise.

## The pattern

Every flow that creates or configures something gets four layers:

1. **Quick.** The fewest fields that give a working result. Defaults that are
   OpenShell's own, and done in one or two clicks. The result says what the
   defaults mean.
2. **Guided.** The advanced options in plain language, through wizard steps
   and dialogs, never through raw JSON.
3. **Document.** Where the gateway or CLI has a document (a policy file, a
   profile YAML), you can view, edit, paste and load it, and come back to the
   GUI when the document fits it. Where there is no document (providers,
   workspaces, templates), show the equivalent `openshell …` command instead.
   Never invent a format.
4. **Guarded.** Each piece of gateway knowledge the GUI needs is used in one of
   three ways, in this order:
   - read from the gateway at runtime;
   - mirrored from upstream at the pinned tag, with a drift check;
   - proven by a compat probe that runs exactly what the GUI builds against
     the pinned gateway.

Create sandbox already follows the pattern (`CreateSandboxModal.tsx`, a wizard
with "Review and create" on step 1).

## Fix now: live bugs on the pinned gateway

All verified against upstream v0.1.6.

| Bug | Where | Fix |
|---|---|---|
| The YAML editor refuses MCP version `2026-07-28`, which 0.1.6 accepts | `utils/policyFile.ts:108` | Add it. Drift check (below). |
| `SUSPENDING` and `SUSPENDED` (proto 11 and 12) show as a grey raw label. Hard fact 1 is out of date | `types/index.ts`, `utils/sandboxLifecycle.ts`, `PhaseLabel.tsx` | Add the phases, tones and labels. Phase-mapping test over every SDK constant. |
| "Any binary" / "leave empty to allow any process". At 0.1.6 a rule with no binaries admits **nothing** (`sandbox-policy.rego:23`) | `PolicyRuleEditor/NetworkRulesTable.tsx:154`, `AddEndpointModal.tsx:242` | Fix the copy, and add `TestBinaryIdentity`. |
| Global policy is seeded with the locked-down preset. Applying it as offered cuts every sandbox off from its providers (a global policy drops provider layers) | `pages/GlobalPolicyPage.tsx:126` | Seed with the current global policy, or with the baseline plus the rules of the profiles in use. Show the impact before applying. |
| Approval mode copy says it covers "proposals an agent makes". Auto-approval covers every proposal, and a global value wins over the sandbox's | `sandbox/ApprovalModeField.tsx:57` | Fix the copy. |
| "The gateway refuses delete while a provider uses it" is untrue for providers the CLI or TUI made (hard fact 8) | `provider/ProfilesPanel.tsx:509` | Fix the copy. |
| The Providers tab says it passes a resource version on attach and detach; it doesn't | `sandbox/SandboxProvidersTab.tsx:36,105` | Pass it (hard fact 11). |
| The create wizard looked up a provider's profile by id only (shadowed profiles) | prototype | **Fixed** with `profileForProvider`. |

## Hero flow 1: set up a team (platform admin, new gateway)

**Today:**
- Sign-in lands on `/workspaces`, so the admin never sees Get started.
- Get started ticks "Create a workspace" because `default` exists, and links
  to `default`. It has no Members step, and it disappears after the first
  provider, just when "Create a sandbox" is next.
- Importing a profile means GitHub → download → edit the binaries → drop the
  file.
- Members need each user's OIDC subject, one at a time.

**Quick:**
- A live five-step checklist on Gateway: profiles, workspace, members,
  provider, sandbox.
  - Each step is worked out from the live lists for a workspace picked in the
    checklist.
  - It stays until a sandbox exists, and can be dismissed.
  - Platform admins land on `/gateway` while a step is open.
- A "Set up a team" wizard modal: Workspace → Profiles → Members → Provider →
  Review and create. Calls run in order, and each one's result shows on Review.

**Guided:**
- "Add from OpenShell examples": a gallery of upstream's `providers/*.yaml` at
  the pinned tag, bundled in the build, with the binaries editable on the card.
  It runs the existing lint, then imports.
- Create profile as a wizard (Basics / Credentials / Endpoints / Programs /
  Review), linted on Review through `/provider-profiles/lint`.

**Document:**
- A YAML tab in Create and Update profile, round-tripping through
  `profileFile.ts`.
- Paste and From URL tabs beside the file drop, following the CLI's rules for
  URLs.
- "Edit as YAML" on each profile row.
- Workspaces have no document, so show `openshell workspace create …`.

**Members:**
- Bulk add, one subject per line.
- Change role, done as remove + add (hard fact 5).
- The viewer's own subject in a `ClipboardCopy` on the not-member page and the
  empty workspace list.
- Go to Members right after creating a workspace.

## Hero flow 2: connect a service ("give my agent a key")

**Today:**
- The Type list shows only a name and a category.
- The credential is labelled with its internal name, and the env var never
  shows (every upstream profile has a description).
- After create, the modal just closes.
- Attach is a bare select. **Silent failure:** upstream's `anthropic.yaml`
  admits only curl, so Claude Code (node) is denied and nothing says so.

**Quick:** a two-step "Connect a service" wizard.
- Step 1 is a gallery of services: imported profiles, plus examples not yet
  imported for admins.
- Step 2 is the key. Its helper text reads like: "the sandbox sees
  `ANTHROPIC_API_KEY` as a placeholder; the gateway sends the real key as
  `x-api-key` to api.anthropic.com only".
- On success, offer "Attach to a sandbox" or "Create a sandbox with it" (the
  create wizard with the provider ticked).

**Guided:**
- "Programs that may use this key", with a warning that the image must have
  one of them.
- The env var choice as plain radios.
- Expiry on create too: one BFF field, `credentialExpiresAtMs` on
  `CreateProviderRequest`, which the gateway field already carries.
- An attach dialog listing hosts and programs. It notes that only new
  processes see the key, and warns while a global policy is set.
- A confirmation before detach.
- "Used by" and "Expired" on the provider.

**Document:** providers have none, so show the `openshell provider create …`
command without the value. Their profile is the document: offer "Edit this
example as YAML".

**Later:** attach readiness (Applying / Ready / Withheld). The gateway has
`GetSandboxProviderStatus` and returns a receipt, but the SDK drops both. That
is a named SDK gap: file it upstream, or add a fourth direct call (ADR 0003).

## Hero flow 3: create a sandbox (prototyped)

A page, not a modal (`/workspaces/{ws}/create-sandbox`, `CreateSandboxPage`):
the wizard opened dialogs of its own, and the policy file needs room beside
the form.

- **Quick:** Basics (name, image, providers in a typeahead select) →
  "Review and create", offered on every step.
- **Guided:** Network access (providers' hosts folded away, other hosts in a
  table, a host added or changed in place) → Files (paths as editable
  labels) → Run (command, environment, services, approval mode) → Resources
  (CPU, memory, GPUs; labels, annotations and platform options folded).
- **Document:** the policy file in a resizable panel beside any step.

**One policy, not two modes (2026-11-16).** The first version kept its own
copy of the rules and paths and rebuilt the policy from the baseline when
going back to the form, which dropped any edit the form had no field for
without a word. Now the file's text is the only state: each field reads its
part of the policy and writes the policy back with that part changed, so an
edit in the file stays through any form edit after it. What the file sets
that the form cannot show (Landlock, the process user, a working directory
that is not writable, middlewares) is named above the fields ("The policy
file also sets: …"). While the file is not a policy, the fields show the last
policy it read as and are locked, and Create is disabled. Two things learned
on the way: a policy file takes only `version: 1`, and a false
`include_workdir` reads back as absent (the proto default).

"Add from a profile" was removed from Network access: it copied a profile's
hosts without its key and read as a second copy of the providers.

**Next:**
- "Start from: Image | Template" on Basics, then delete
  `CreateSandboxFromTemplateModal` and, after it, the three presets. Keep
  `basePolicy`.
- "Copy policy from a sandbox" in Network access. This is the reuse that
  templates can't carry, because a template is workload only.
- Approval mode next to "blocked requests become proposals". Disable it when a
  global value is set.

## Hero flow 4: unblock my agent (the day-2 loop)

**Today:**
- A block is signalled only by the "N rules proposed" banner.
- Logs have no "Denied" filter. At 0.1.6 a denial is a line of text with no
  structured fields (see "Found on the way" below).
- Approve has no loading state, no success message and no "revision N
  loading".
- A user who is not an admin sees proposals with no actions and no hint.
- The rule is shown as raw JSON, and widening its programs means editing a
  JSON textarea.
- The Policy tab speaks CLI ("rest read-only enforce").

**Quick:**
- Each proposal row reads "**curl** was blocked from **pypi.org:443** · 12×",
  with **Allow** as the primary action.
- After Allow, an inline alert follows the revision until it loads.
- Non-admins see "A workspace admin approves these".
- A banner item for denials links to the logs (`onViewLogs` is already passed
  in and unused).

**Guided:**
- "What changes": the current-vs-candidate diff in plain words. The BFF
  already sends both policies.
- "Allow for more programs…" opens AddHostModal prefilled from the proposal
  and saves through EditDraftChunk.
- Logs link a denial to its proposal rather than parsing the line (see
  below).
- **One add-host dialog.** AddHostModal becomes the default everywhere, and
  AddEndpointModal's extras move into its Advanced section.
- A "What this sandbox can reach" card on the Policy tab.

**Document:** `PolicyDocumentEditor` already has it. Add "View as YAML" on a
proposal, and use the code editor in EditDraftModal.

### Prototyped (2026-11-16)

In this worktree: `SandboxDraftsTab/DraftChunkRow.tsx`, `index.tsx`,
`AllowTracker.tsx`, `proposalWords.ts`, and an edit mode in
`policy/AddHostModal.tsx`. Specs: `SandboxDraftsTab.spec.tsx` (the day-2 loop
block) and `proposalWords.spec.ts`.

- **Quick.** A row reads "**curl** was blocked from **pypi.org:443** · 2
  times", then "Allows /usr/bin/curl to reach pypi.org:443, any traffic (not
  inspected). Other programs stay blocked." **Allow** is the primary button.
  After it, an alert follows the revision: "Allowing curl → pypi.org:443" →
  "Allowed … run the command again: nothing needs a restart", or the load
  error, or "not loaded in a minute" (a stopped sandbox). Non-admins get "A
  workspace admin decides these".
- **Guided.** **Change…** opens the add-host dialog pre-filled from the
  proposal: host, port, Read / Read and write / Any traffic, programs. It keeps
  every endpoint field it has no input for (`advisorProposed` and so on) and
  saves through EditDraftChunk, which issues a new review token. A proposal the
  dialog can't show whole (L7 rules, several endpoints, the `full` preset)
  opens the JSON editor instead. The expanded row says "What allowing
  changes", rule by rule, from the current and candidate policies the chunk
  carries.
- **Document.** "The rule as JSON" is folded in the expanded row, with "Edit
  as JSON".

**Verified live on gateway 0.1.6** (sandbox `causal-vicuna`, team-a):
1. `curl https://pypi.org/` was refused. Within seconds the gateway proposed
   `allow_pypi_org_443`: L4, from `/usr/bin/curl`.
2. **Change…** set it to Read and added `/usr/bin/python3`. The gateway took
   the edit.
3. **Allow** wrote revision 2. The tracker showed it pending, then loaded, in
   about 10 s.
4. Inside the sandbox, curl GET returned 200 and POST 403.

**Found on the way:**
- **A guessed program path admits nothing.** `python3` in the community base
  image is `/sandbox/.venv/bin/python3`, which runs
  `/sandbox/.uv/python/cpython-3.14.3-…/bin/python3.14`. The gateway matches
  the binary the kernel ran, so `/usr/bin/python3` in a rule did nothing. The
  denial became a second proposal naming the exact path, already as read-only
  REST like the rule before it; allowing it made python's GET return 200. So
  the reliable way to get a program path is the proposal, not a list. The
  dialog's "common programs" hint (python3, node) is gone. It now says to use
  the real file, or to let the request be blocked and allow the proposal.
- **Each program gets its own rule** (`allow_pypi_org_443`,
  `allow_pypi_org_443_2`). Allowing three tools means three rules for one
  host; **Change…** is how to make it one.
- **Denials in the logs are text only.** At 0.1.6 the line is
  `NET:OPEN [MED] DENIED /usr/bin/curl(0) -> pypi.org:443
  [reason:transparent_tcp_policy_denied]`, with no structured fields: the
  `action` / `dst_host` / `binary` fields the logs tab reads (taken from the
  TUI at 0.1.2) are not there. A "Denied only" filter or "Allow this host" on
  a log line would parse that text, which upstream can reword at any release.
  The loop is built on proposals, which are structured. The logs can link to
  them rather than parse.

**Not done:** "View as YAML" on a proposal, the code editor in
EditDraftModal, a confirm on Approve all, the reach card on the Policy tab,
and AddEndpointModal's extras moving into the add-host dialog.

## Hero flow 5: set guardrails (platform admin)

**Global policy:** a wizard.
1. Start from the current policy, or the baseline plus the rules of the
   profiles in use.
2. Network access (the shared `AccessField`).
3. Review, with "Applies to N sandboxes; these provider hosts stop applying"
   and **Apply to N sandboxes**.

Show Files read-only until a probe shows what a global filesystem does.

**Settings:**
- Cards grouped by purpose: Proposals (a switch, and manual/auto), and
  Observability (a switch, and the schema version as a select).
- "Reset to default" on each.
- Keys the dashboard doesn't know go in an "Other" table, so a newer gateway
  still works.
- Drop "Add setting" (the gateway refuses unregistered keys) and the revision
  fingerprint.
- Reuse the same cards on the sandbox Settings tab, with "Managed globally"
  where a global value is set.

**Templates:**
- Create and authoring share `WorkloadFields` with the wizard.
- Review shows the template's protojson and the CLI command.
- Duplicate instead of Edit, because there is no update RPC.
- "Save as template" from a sandbox.
- "Create sandbox" as a visible row action.

## Keeping it working across upgrades

Most of the GUI's gateway knowledge is unguarded today. Use three layers.

**1. Read from the gateway at runtime** (preferred):
- services and their rules from `ListProviderProfiles`, through
  `ruleFromProfile`;
- setting keys from `GetGatewayConfig`;
- profile validation from `/provider-profiles/lint`.

There is no dry-run RPC for policies at 0.1.6, so client checks stay in one
shared `utils/policyRules.ts`.

**2. Mirror and check for drift.** Add `deploy/ci/upstream/drift.py`, which
writes `mirrored.json`, checked in. It runs in the Follow upstream bump and in
Check A. It extracts, at the pinned tag:
- the settings registry: keys, kinds and allowed values;
- the paths of `restrictive_default_policy`;
- the methods of each access preset;
- the MCP versions;
- the auth styles;
- the profile categories;
- the sandbox phases;
- the L7 protocols;
- the hashes of the example profiles.

Frontend specs assert the TS constants equal `mirrored.json`, minus a named
list of intentional differences (`basePolicy`: `/app`, `/sandbox`, the
`sandbox` user). An upgrade that moves any of these turns the bump PR red and
names the constant.

**3. Compat probes of what the GUI builds.** These follow the pattern of
`policy_presets.json` ↔ `TestPolicyPresets`: a frontend spec writes what the
form sends, and the compat suite runs it against the pinned gateway.

| Probe | Proves |
|---|---|
| `policy_builder.json` → `TestPolicyBuilderOutputs` | the wizard's baseline and each Add host option become Ready, with and without an image; nothing is dropped on read-back |
| `TestBinaryIdentity` | no binaries means denied; naming curl means allowed; a symlinked or PATH-shadowed name (`/usr/bin/python3` in the base image) is denied while the resolved path is allowed |
| `profile_form.json` → `TestProfileAuthStyles` | each auth style and an L4 endpoint lint, import and read back |
| `known_settings.json` → `TestKnownSettings` | the key set equals the gateway's; each key takes its kind; a bad value lists the allowed ones |
| phase mapping over every SDK constant, plus a TS tone/label spec | a new phase can't show up raw |
| `TestSandboxProviderAttachDetach` + `_provider_` rule | a provider's layer appears and disappears |
| hero loop: curl denied → proposal (L4, names `/usr/bin/curl`) → edit to read-only → approve with the new token → revision LOADED → GET allowed, POST denied | the day-2 loop end to end, as run by hand on 0.1.6 on 2026-11-16 (needs a reachable host in the stack) |
| log denial shape: a denied curl's log line, asserted field by field | that the logs carry what a denial filter would read; fails today (text only at 0.1.6), so the UI does not depend on it |
| example profiles at the pinned tag: lint + import each | the gallery in flows 1 and 2 |

## Suggested order (each a PR)

1. **Live bugs** (the table above). Under a day.
2. **The create wizard**, with its specs and `policy_builder.json` +
   `TestPolicyBuilderOutputs`. This is the prototype here, made solid.
3. **`drift.py` + `mirrored.json`**, plus `TestKnownSettings` and the phase
   tests.
4. **Day-2 loop:** proposal rows with Allow and feedback, the plain diff, one
   add-host dialog, `TestBinaryIdentity`.
5. **Connect a service** wizard and the attach dialog.
6. **Examples gallery** (bundled at the pin), used by flows 1 and 2.
7. **Set up a team:** checklist and wizard, members.
8. **Guardrails:** global policy wizard, settings cards, templates in the
   create wizard.
