# The PM journey, replayed on the prototype (2026-11-20)

A group of product managers tried to run OpenCode against a model they host
(OpenShift AI models as a service, OpenAI-compatible) on the dashboard from
`main`. It took a maintainer beside them, a YAML file sent over chat, a
hand-written `opencode.json` and many rounds of policy approvals. This is that
journey run again on the prototype in this branch, from an empty gateway
0.1.6, with a stand-in for their endpoint (an OpenAI-compatible server that
answers only to the right key).

## What happened, step by step

| Step | On `main` (what the PMs hit) | On the prototype (measured) | Still wrong |
|---|---|---|---|
| Land in the app | Workspaces list | The same | Nothing says how to get an agent running. Get started is on the Gateway page, for platform admins only, and goes away after the first provider or sandbox. |
| "I need a provider" | Providers tab had no word about profiles | The empty Providers tab says a profile comes first, and where | It is a sentence, not a button. The idea "a provider is made from a profile" still has to be learned. |
| "Where are the default profiles?" | None | None | The gateway has shipped none since 0.1.2, by design. Upstream publishes 18 example files (`providers/` at the release tag) and says to copy and edit them. The UI links to GitHub. There is no example for a generic OpenAI-compatible endpoint. |
| Create a profile | The form failed: fields the schema needs were missing | The form saved a working profile: credential, bearer injection, endpoint, programs | Jargon ("Inference capable", "Enforce", "HTTP, inspected"). It asks for "Programs allowed to connect", the resolved path of a binary in an image the person has not seen yet. It has no field for allowed IPs, which an endpoint on a private address needs. It is a long dialog. Changing a profile afterwards is file-only. |
| Create the provider | Worked once a profile existed | Worked | "Type" means profile. There is no URL field (the URL is in the profile), which is not where someone with "a URL and a key" looks. Nothing tests the key or the endpoint. |
| Create the sandbox | Old dialog | New page, quick path in two clicks | Review says the provider adds its host; it does not say only for the programs the profile names. |
| "What is in this image?" | Unknown | Unknown | The default image holds `opencode`, `claude`, `codex`, `gh`, `git`, `curl`, Python and Node. No screen says so. The details page is IDs and hashes, with no next step. |
| First call to the model | Policy denials | Failed with "Empty reply from server" | Not a denial, so no proposal was raised, and Gateway says "Nothing needs attention". The cause was only in the raw log (the host name resolved to the wrong machine in this local setup). |
| Configure OpenCode | A maintainer wrote `opencode.json` by hand | The same: outside the product | Nothing helps discover the model IDs, write the agent's config, or put the file in place. |
| Run OpenCode | Rounds of approve and retry | Not completed: OpenCode hung with no network attempt and nothing in Proposals; stopped there | Unverified. `curl` reached the model with the injected key; OpenCode would then be blocked, because the profile names only `curl`. |

The prototype fixes the middle of the journey (the forms). It does not touch
the two ends: how a person finds the path, and what happens after the sandbox
exists.

## Why it is hard: the product asks in the wrong order

The person arrives with "an agent, a model URL, a key". The product asks for a
provider profile (endpoints, injection style, binary paths), then a provider
(a key for that profile), then a sandbox (an image and a policy), then leaves
the agent's own configuration to the terminal. Each object is on a different
page, and the first one needs knowledge from the last (the binary path inside
the image).

## By persona

**Evaluator (the PMs): "show me an agent talking to my model in ten minutes."**
Blocked at every joint above. Needs one flow that asks agent, model endpoint
and key, and builds the rest.

**Platform admin: sets the gateway up for teams.**
Has no profiles to offer and no gallery to pick from; must know to copy
upstream's examples and fix their binary paths for the image. Global policy
and gateway settings are not explained in terms of when to use them.

**Workspace admin: owns providers, keys and approvals.**
Can add a provider only after a profile exists. Approves proposals one program
at a time, and cannot turn what was approved on one sandbox into something the
next sandbox starts with.

**Agent user: creates sandboxes, works in the terminal.**
Cannot approve, so each blocked request waits on someone else. Does not know
what the image holds, whether an approval needs a restart (it does not: rules
reload in about ten seconds), or that the web terminal's shell ends when the
tab is left.

## Questions from the session, answered

- **Where did the default profiles go?** Upstream removed built-ins: "no
  gateway loads them on its own". Bundling the examples of the pinned release
  in the UI is now the only way a new gateway has anything to pick.
- **When do I use a template?** For the workload only: image, command,
  environment, resources. It carries no policy.
- **When do I use a global policy?** Almost never while evaluating. It
  replaces every sandbox's policy, including providers' hosts and approved
  proposals.
- **Can what I approved go into the provider?** By hand today: add the hosts
  and programs to the profile, and every sandbox with a provider of it gets
  them. There is no "save these rules to the profile" action.
- **Why was `curl` blocked from GitHub when I gave it GitHub?** Access is per
  program. The GitHub profile names `git` and `gh`; the agent used `curl`.
  Each program that is blocked raises its own proposal.
- **How do I not do this again?** Today: put it in the profile, or set the
  approval mode to auto so the prover approves what it finds safe. Missing:
  starting a sandbox from another one's policy.

## Proposal: "Run an agent", owned by the UI

Upstream's own guide ("Run Your First Agent") is the recipe: import a profile,
create a provider, pick an image that holds the agent, pass the agent as the
command, approve what it asks for. The dashboard should run that recipe.

One entry point ("Run an agent"), on the landing page and on every empty
state:

1. **Pick the agent:** Claude Code, Codex, OpenCode (the three the default
   image holds).
2. **Connect a model:** a known service (key only), or "My own endpoint":
   URL and key. The model list is read from inside the sandbox once it
   exists, which also tests the key.
3. **Create.** The flow creates the profile (upstream's example at the pinned
   release, with the binary paths of the chosen image), the provider, and the
   sandbox with the agent's hosts, and writes the agent's config file
   (`opencode.json` for a custom endpoint).
4. **Land on "Your agent is ready":** open the terminal with the agent
   running, see what was allowed, and approve the rest in place.

A recipe is data bundled per pinned release, not a gateway object. To keep it
from rotting, each recipe is a compat test: create it against the pinned
gateway, check that the agent's binary resolves to the path the profile names,
and that the model call is allowed.

Around it, in order of pain removed:

- A gallery of upstream's example profiles at the pinned release, in place of
  the GitHub link.
- "Test connection" on a provider, run from a sandbox.
- "What's in this image" and a next step on the sandbox page.
- Proposals grouped by host, with "allow for these programs too".
- "Save to the profile" on approved rules, and "start from this sandbox's
  policy" in Create.
- Failed connections (not only denials) surfaced on the sandbox.

## Prototyped (2026-11-20): what runs in a sandbox

The first version was a page of its own, "Run an agent". It was folded into
Create sandbox the same day: a top-level agent flow made the console read as
the agent product, which it is not (see
[navigation-and-agents.md](navigation-and-agents.md)). What it did now
belongs to things the console already has (`frontend/src/sandboxPresets/`).

- **Create sandbox, "What runs in it":** a shell (the default), OpenCode,
  Claude Code or Codex. The choice does not change the sandbox's main
  process, which stays the image's login shell so the sandbox outlives a
  session. It is what the terminal starts, and the sandbox is labelled
  `type=<choice>`, so its Terminal tab offers "Start OpenCode" later.
- **Provider checks, before the sandbox exists:** an agent with no provider
  is told it needs one. A chosen provider whose profile does not name the
  agent's programs is flagged ("gh does not let OpenCode through"), with one
  click to add them to a workspace profile.
- **Add a provider by URL and key** (Providers tab, and in place on Create
  sandbox): writes the profile for that host and the provider that holds the
  key. The URL is kept as the provider's `base_url` config entry, since a
  profile has no place for a path.
- **After Create**, for an agent: the page waits for the sandbox to be ready.
  For OpenCode with a model API added that way, it asks the API for its
  models from inside the sandbox (which tests the key, the route and the
  policy) and writes `~/.config/opencode/opencode.json`. A step that fails
  says why and can be tried again, or skipped.
- The terminal then opens on the agent. The command travels as navigation
  state, not a URL parameter, so a link can never make a terminal run
  something; the label only ever offers a button.

Run live on gateway 0.1.6 against the stand-in endpoint, with the code
rebased onto the 0.1.9 pin: choose OpenCode, add the provider from the page,
Create; four seconds later the terminal was on OpenCode with the endpoint's
model. Earlier the same day, `opencode run "Say hello"` answered through the
endpoint, and Claude Code's calls to api.anthropic.com were allowed for
`/usr/local/bin/claude` with upstream's profile (a dummy key, so Anthropic
answered "Invalid API key").

Measured for the presets: OpenCode 1.2.18's connections come from
`/usr/lib/node_modules/opencode-ai/bin/.opencode`; it also tries models.dev,
registry.npmjs.org and opencode.ai and works without them. Claude Code
2.1.156 also tries Datadog's log intake. Codex's programs are upstream's
profile's and were not measured.

Not done:
- A compat probe per preset (create a sandbox on the pinned gateway and
  check the agent's binary still resolves to a path the preset names).
  Without it a new `base` image can break a preset silently.
- Not run against a 0.1.9 gateway.
- A gallery of upstream's example profiles; "Test" on any attached provider.
- Allowed IPs for an endpoint on a private address, and presets for an image
  other than `base`.
- Typing into the web terminal was not exercised: the browser automation's
  keys did not reach it.
