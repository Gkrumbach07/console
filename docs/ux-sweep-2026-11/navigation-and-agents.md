# "Run an agent" and the global navigation, reconsidered (2026-11-20)

Two doubts after the quick-start prototype: a separate "Run an agent" flow
reads as something other than a sandbox, when it is just a sandbox; and the
left navigation (Workspaces, Sandboxes, Proposals) lists things without
letting anyone act on them. This is what the record says about both, and what
to do.

## What people have said

Searched: Slack (#team-openshell, #forum-openshell and direct messages since
September) and the notes of the OpenShell architecture call from 23 July to
19 November (the Gemini notes of the last eight calls and the running
hand-written notes).

**Nobody has discussed how the console should present itself.** The notes
have no passage on who the console is for, whether it should say "agent" or
"sandbox", a first-run experience in it, a cross-workspace view, or the pain
of approving policies. The console comes up as releases, packaging, demos
and where it lives.

What is on record points one way, though:

- **The console is the sandbox surface; "agents" are another product's
  word.** The Tech Preview plan (Adel Zaalouk's document, quoted by Ann Marie
  Fred in #team-openshell, 29 September) splits the UI in two: the standalone
  OpenShell UI is "sandbox, gateway, workspace management", and Agent
  Deployments in the RHOAI console "shows 'agents' not 'sandboxes'".
- **Agent creation belongs to OpenClaw Enterprise.** On the 29 October call
  the agent creation flow, presets and versioned agents were all shown in
  OCE, with OpenShell as "the sandboxing plug-in point" (Russell Bryant,
  Derek Carr). OCE 1.0 ships five presets and custom templates.
- **This repository's own rule says the same.** ADR 0003: "Sandbox is the
  object the gateway has, labels categorize, and there is no Agent."
- **The CLI's idiom is a sandbox with a command.** `openshell sandbox create
  --provider X -- opencode`: the agent is what the sandbox runs, not a thing
  of its own. Derek Carr's own example in #forum-openshell (18 November) is
  `sandbox create --policy … -- sh -c 'git clone … && exec bash'`.
- **Onboarding has been asked for, once, and as a sandbox thing:** "better
  onboarding into a sandbox (custom flow pluggable …)" (running notes, 27
  August, unattributed). On 6 August the console's own section floated
  extension points: "what if nemoclaw could contribute a create flow".
- **A field SA wants it as a landing page for people who build agents**
  (Raghuram Banda, October, from the hat brief), which is the one voice for
  the developer persona.

So the instinct is right: a top-level "Run an agent" makes the console sound
like the agent product, which it has been decided not to be.

## What "embedding it in the flow" means

The quick start did four useful things. None of them needs the word agent as
a page; each belongs to something the console already has.

| What the quick start did | Where it belongs |
|---|---|
| Wrote a provider profile from a URL and a key | **Add provider.** "A service of my own: URL and key" beside "from a profile". The profile is made for you. Useful for any service, not only models. |
| Knew which programs the agent connects from | **Create sandbox, "What runs in it":** a shell (default), OpenCode, Claude Code, Codex, or a command of your own. A preset fills the command and knows its programs, and says when an attached provider does not let that program through, with one click to add it. |
| Asked the endpoint for its models from inside the sandbox | **"Test" on a provider attached to a sandbox.** It runs from the sandbox, so it tests the key, the route and the policy together. |
| Wrote `opencode.json` and opened the terminal on the agent | **After create:** the sandbox opens on its terminal running the command, and a preset can write the files its program needs. |

The preset list is the only place the names of agents appear, as choices for
what a sandbox runs: `sandbox create -- opencode`, in a form. The landing
button is "Create sandbox".

**Built the same day**, and "Run an agent" removed: see "Prototyped" in
[pm-journey.md](pm-journey.md). Two things came out differently from the
table. The choice does not set the sandbox's main command (a sandbox whose
main process is an agent nobody is attached to ends when the agent does);
it sets what the terminal starts, and labels the sandbox. And "Test" exists
only as the model check after Create, not yet as a button on any provider.

## The navigation

Measured on the prototype (unchanged from `main` here):

| Entry | Who sees it | What it is | Can you act there |
|---|---|---|---|
| Gateway | platform admin | status, compute drivers, extensions | no |
| Workspaces | everyone | list of workspaces | create a workspace (admin) |
| Sandboxes | platform admin | every workspace's sandboxes | no: no create, rows lead away |
| Proposals | everyone | sandboxes with pending counts | no: "select a sandbox to review" |
| Resources | platform admin | every workspace's providers, templates, services | no |
| Provider profiles, Global policy, Settings | platform admin | platform configuration | yes |

- The top half of the navigation is rollups. Everything a person does (create
  a sandbox, add a provider, approve a proposal) is two levels down, in the
  six tabs of a workspace's page or the nine of a sandbox's.
- Someone who is not a platform admin has two entries, Workspaces and
  Proposals. Their sandboxes, the thing they came for, are not in the
  navigation at all.
- "Sandboxes" in the navigation and "Sandboxes" in a workspace are different
  pages with the same name, and only one can create.
- The navigation has no idea which workspace you are in.

**Proposal: put the workspace in the frame.** A workspace switcher at the top
of the navigation (PatternFly's context selector, the OpenShift console's
project selector), and under it the things of that workspace as navigation
entries, each a page that lists and creates:

```
[ Workspace: team-a ▾ ]        (admins also get "All workspaces")
  Sandboxes        list + Create sandbox
  Providers        list + Add provider  (profiles behind it)
  Proposals        the queue, approvable in place
  Templates · Services · Members

Platform                       (platform admin)
  Gateway · Workspaces · Provider profiles · Global policy · Settings
```

- "All workspaces" in the switcher turns the same Sandboxes, Providers and
  Services pages into the cross-workspace lists the gateway serves to
  platform admins; Create then asks which workspace. One page per noun,
  instead of a global one that cannot create and a tab that can.
- A person with one workspace lands in it, on Sandboxes.
- Proposals becomes a queue you approve from, not a list of links.
- "Resources" goes away as a name: its three tables are the All-workspaces
  view of three pages.

It is backed by the API as it is: exactly four lists take the all-workspaces
scope, for platform admins only (hard fact 12), which is what the switcher's
"All workspaces" offers.
