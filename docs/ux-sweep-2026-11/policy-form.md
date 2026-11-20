# The policy step of Create sandbox

Prototype in this worktree: `frontend/src/components/CreateSandboxModal.tsx`
(a PatternFly wizard in a modal), `frontend/src/components/policy/SandboxPolicyFields.tsx`,
`AddHostModal.tsx` and `policyBuilder.ts`, and the policy parts of
`useCreateSandboxForm.ts`.

## Layout: a wizard, with a quick path

PatternFly reserves modals for short input and points longer tasks to a modal
wizard. The form is now five steps:

1. **Basics:** image, providers, name.
2. **Network access:** what else the sandbox may reach.
3. **Files:** the paths it may read and write.
4. **Command and runtime:** optional, and it says so.
5. **Review:** a summary, or the policy as YAML or JSON.

**Quick path.** Basics has **Review and create** beside **Next**. This is
PatternFly's optional-steps pattern: every step after the first has a default,
so a sandbox is two clicks from the first screen. The review says what those
defaults mean ("Nothing yet. Every connection the sandbox tries becomes a
proposal to approve").

## What upstream's quick path is, and what we keep hard-coded

The TUI's create form (`spawn_create_sandbox`, v0.1.6) asks for a name, an
image, providers and ports, and nothing else:

- With the default image it sends **no policy**, so the sandbox uses the policy
  its image ships (`/etc/openshell/policy.yaml`).
- With any other image it sends `restrictive_default_policy()`: files and the
  sandbox user only, with no network rules.

Network access comes from providers and from proposals. There are no presets
upstream.

The dashboard's quick path is the same, except that it always sends the
restrictive default. The community base image's policy is refused by gateway
0.1.6: it still uses `tls: terminate`, and 0.1.6 accepts only `""` or `skip`.
That is upstream's own quick path broken on this gateway (openshell-community
`sandboxes/base/policy.yaml`, unchanged since 2026-04).

**Hard-coded:** one baseline, mirroring upstream's `restrictive_default_policy`.
It is checked by the compat suite. **Not hard-coded:** services. Those come from
providers (keys and access) and from the gateway's profiles ("Add from a
profile"), which admins import from upstream's `providers/` for their release.

## Who creates a sandbox, and what they want from the policy step

| Persona | Role | What they want | What the old form gave them |
|---|---|---|---|
| **First-timer / evaluator** | user | Click Create and get a shell that works. They don't know what Landlock or an access preset is. | A preset dropdown whose names mean nothing yet ("Locked down"), and an "advanced" JSON box. |
| **Agent developer** | user | Run Claude Code (or their own agent) on a repo: reach the model API, clone from GitHub, `pip install`. They think in services and hosts, not in rules. | Three hard-coded presets. Anything else meant hand-writing JSON. |
| **Workspace admin** | workspace admin | Say once what the team may reach, and keep users off the JSON. They curate providers and profiles. | Nothing reusable: each sandbox carries its own policy, and presets live in dashboard code. |
| **Power user / platform admin** | either | Bring the policy file they already keep in git, the one `openshell sandbox create --policy` reads. | The JSON box: fine for them, but all or nothing. |

What they share: network access is what changes, and filesystem and user
almost never do. Upstream's own model is the same. Providers bring their hosts
and keys, and a blocked request becomes a proposal to approve. So the step asks
**"What can this sandbox reach?"**:

1. **Providers.** Checkboxes, each saying what it adds ("Adds api.anthropic.com
   and its key").
2. **Other access.** A list of what is allowed besides, in plain words
   ("github.com:443: GET, HEAD, OPTIONS on any path; POST /**/git-upload-pack",
   "from /usr/bin/git, /usr/bin/gh"). It is filled two ways:
   - **Add from a profile.** The gateway's own provider profiles, used for
     their hosts and programs without a key: a public repo or a package index.
   - **Add a host.** Host, port, then *Read* / *Read and write* / *Any traffic,
     not inspected*, then the programs allowed to use it. The dialog warns when
     no program is named, since gateway 0.1.6 then admits nothing.
3. **Files and user.** Folded, with a one-line summary. Two path lists, and a
   note that they cannot change after create.
4. **Edit as YAML or JSON, or load a policy file.** The same policy as a
   document. "Back to the form" works when the document only changes what the
   form shows, and otherwise says why not.

Blocked requests becoming proposals is said up front, so "start small" is the
obvious choice rather than a scary one.

## Do the presets have to be maintained?

**Before:** yes. They were hard-coded in `policyTemplates.ts`, and they encode
gateway behaviour that changes between releases. 0.1.6 needs a binary on every
rule, and a git clone needs a POST to `git-upload-pack`. The compat suite proves
the gateway *accepts* them, not that they *work*.

**Now:** the create form keeps one hard-coded thing, the baseline: upstream's
`restrictive_default_policy` (filesystem, Landlock, user). The services come
from the gateway's provider profiles. An admin imports upstream's
`providers/*.yaml` for the gateway's release, upstream maintains those, and
nothing in the dashboard changes when they do.

Why there is still a baseline at all: a sandbox created without a policy falls
back to the policy its image ships at `/etc/openshell/policy.yaml`, and gateway
0.1.6 refuses the community base image's one ("Image policy is invalid"). The
sandbox never becomes ready. This was measured on 2026-11-15 with
`openshell sandbox create` and no `--policy`.

## Verified (local stack, gateway 0.1.6, 2026-11-15)

- A sandbox created from the form (GitHub from its profile, plus pypi.org
  read-only from curl, python3 and pip) became Ready, with its configuration
  accepted.
- Inside it:
  - `git clone` of a public repo worked.
  - `GET pypi.org` returned 200.
  - `POST pypi.org` returned 403.
  - example.com was refused.
- Form → document → form keeps the rules.

## Open questions

- With no profiles imported, which is every new 0.1.x gateway, "Add from a
  profile" is empty. Should the form fall back to a few built-in suggestions,
  or link to importing profiles?
- `pip install` also needs `files.pythonhosted.org`. Upstream's `pypi.yaml`
  profile has both; a single host added by hand does not.
- Approval mode (manual or auto) still sits under Advanced options. It belongs
  next to "blocked requests become proposals".
- Create from template and the Global policy page still use the old presets.
