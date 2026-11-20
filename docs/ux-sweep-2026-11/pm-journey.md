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

## Prototyped (2026-11-20): Run an agent

`/workspaces/{ws}/run-agent` (`RunAgentPage`, `frontend/src/quickstart/`),
offered first on an empty workspace and beside Create sandbox otherwise.

- **OpenCode with an endpoint of one's own.** The form asks for the URL, the
  key and a name. It then imports a profile for that host (naming OpenCode's
  programs and curl), creates the provider, creates a sandbox from the `base`
  image, asks the endpoint for its models from inside the sandbox (which
  tests the key and the route), writes `~/.config/opencode/opencode.json`
  with those models, and offers the terminal with OpenCode running.
- **Claude Code with an Anthropic key.** Upstream's `claude-code` profile, a
  provider, a sandbox; three steps.
- A step that fails says why, keeps what was made, and is tried again from
  there. The key is held in the page only until the provider has it.
- The agent's command reaches the terminal as navigation state, not a URL
  parameter, so a link can never make a terminal run something.

Run live on gateway 0.1.6 against the stand-in endpoint: about 20 seconds from
"Run OpenCode" to ready, both models found, and `opencode run "Say hello"` in
that sandbox answered through the endpoint. Claude Code with a dummy key: the
profile was accepted, its calls to api.anthropic.com were allowed for
`/usr/local/bin/claude`, and Anthropic answered "Invalid API key".

Measured for the recipes: OpenCode 1.2.18's connections come from
`/usr/lib/node_modules/opencode-ai/bin/.opencode`; it also tries models.dev,
registry.npmjs.org and opencode.ai and works without them. Claude Code
2.1.156 also tries Datadog's log intake.

Not done:
- The compat probe per recipe (create it on the pinned gateway, check the
  agent's binary still resolves to a path the profile names). Without it a
  new `base` image can break a recipe silently.
- Codex (its profile takes OAuth tokens, not a key), OpenRouter and the other
  known services, and Claude Code against an endpoint of one's own.
- Allowed IPs for an endpoint on a private address, and choosing the image.
- Run an agent on the landing page and on Get started.
- Typing into the web terminal was not exercised: the browser automation's
  keys did not reach it.
