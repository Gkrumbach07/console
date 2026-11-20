// "Run an agent": what the dashboard sets up to take someone from nothing to
// an agent talking to a model. It follows upstream's own guide (Run Your
// First Agent, docs/about/run-your-first-agent.mdx): a provider profile, a
// provider that holds the key, a sandbox from an image that has the agent,
// and the agent as the command.
//
// A recipe is data plus the builders of the requests the dashboard already
// sends; it is not an object of the gateway's, and nothing here is sent that
// the forms could not send. What a recipe knows that a person does not is
// where the agent lives in the image: the gateway admits a connection only
// from a program a profile names, by the path the kernel resolved, so a
// recipe is for one image layout and names it.
//
// Measured on gateway 0.1.6 with the community `base` image (2026-11-20):
// OpenCode 1.2.18 is /usr/bin/opencode, a Node launcher that runs
// /usr/lib/node_modules/opencode-ai/bin/.opencode, the program that makes the
// connections. It also tries models.dev, registry.npmjs.org and opencode.ai,
// and runs without them. Claude Code 2.1.156 is /usr/local/bin/claude; with
// upstream's claude-code profile its calls to api.anthropic.com are allowed,
// and it also tries Datadog's log intake.

import { COMMUNITY_REGISTRY } from '../constants';
import { initialPolicy } from '../components/policy/policyBuilder';
import type {
  CreateProviderRequest,
  CreateSandboxRequest,
  ImportProfileRequest,
} from '../types';

export type AgentId = 'opencode' | 'claude-code';
export type ModelSourceId = 'own-endpoint' | 'anthropic';

export type AgentRecipe = {
  id: AgentId;
  name: string;
  description: string;
  // What the terminal runs to start the agent.
  command: string[];
  // The programs that make the agent's connections in the image, as the
  // kernel resolves them. A glob covers a per-architecture install folder.
  programs: string[];
  sources: ModelSourceId[];
  // Hosts the agent tries besides its model, which the recipe leaves blocked:
  // said up front so the first proposals are no surprise.
  alsoTries: string[];
};

// The image every recipe is for. Its default tag moves, which is why each
// recipe has a compat probe that checks the paths above still resolve.
export const RECIPE_IMAGE = `${COMMUNITY_REGISTRY}/base:latest`;

export const AGENT_RECIPES: AgentRecipe[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    description:
      'The open-source coding agent. Works with any OpenAI-compatible model endpoint, including one you host.',
    command: ['opencode'],
    programs: ['/usr/bin/opencode', '/usr/lib/node_modules/opencode-ai/**'],
    sources: ['own-endpoint'],
    alsoTries: ['models.dev', 'registry.npmjs.org', 'opencode.ai'],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: "Anthropic's coding agent, with an Anthropic API key.",
    command: ['claude'],
    programs: ['/usr/bin/claude', '/usr/local/bin/claude'],
    sources: ['anthropic'],
    alsoTries: ['http-intake.logs.us5.datadoghq.com'],
  },
];

export const MODEL_SOURCE_LABELS: Record<ModelSourceId, string> = {
  'own-endpoint': 'My own endpoint (OpenAI-compatible)',
  anthropic: 'Anthropic API',
};

export const recipeFor = (id: AgentId): AgentRecipe =>
  AGENT_RECIPES.find((recipe) => recipe.id === id) ?? AGENT_RECIPES[0];

// What the person types.
export type QuickStartInput = {
  agent: AgentId;
  source: ModelSourceId;
  // The name of the connection: the provider's name and its profile's id.
  name: string;
  // own-endpoint: the base URL the model API is served at, with its path
  // (https://maas.example.com/v1).
  baseUrl: string;
  apiKey: string;
  // own-endpoint: the model to start with. Empty takes the first the
  // endpoint lists.
  model: string;
};

export type ParsedEndpoint = {
  // The base URL without a trailing slash, as the agent's config takes it.
  baseUrl: string;
  host: string;
  port: number;
};

// The endpoint of a base URL, or why it is not one. The profile needs the
// host and the port; the agent's config needs the URL.
export const parseEndpoint = (
  raw: string,
): { endpoint?: ParsedEndpoint; error?: string } => {
  const text = raw.trim();
  if (!text) return { error: 'Enter the URL your model API is served at.' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return {
      error: 'Not a URL. It looks like https://models.example.com/v1.',
    };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: 'The URL starts with https:// or http://.' };
  }
  if (url.username || url.password) {
    return {
      error: 'Leave the key out of the URL: it goes in the field below.',
    };
  }
  if (url.search || url.hash) {
    return { error: 'Leave out everything after the path (? and #).' };
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80;
  return {
    endpoint: {
      baseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, ''),
      host: url.hostname,
      port,
    },
  };
};

// A name a provider and a profile can both have: a DNS label.
export const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// The name offered for a connection to a host: its first label.
export const suggestedName = (host: string): string => {
  const label = host
    .split('.')[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  return NAME_PATTERN.test(label) ? label : 'model';
};

// The env var the sandbox sees the key's placeholder in: MAAS_API_KEY for a
// connection named maas.
export const keyEnvVar = (name: string): string =>
  `${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;

const REST_ENDPOINT = {
  protocol: 'rest',
  access: 'NETWORK_ACCESS_PRESET_READ_WRITE',
  enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
};

// The provider profile a recipe imports into the workspace. For a model the
// person hosts, it is written for their endpoint: upstream has no example
// for an OpenAI-compatible service on another host, and says to import a
// separate profile naming that host (providers/openai.yaml at v0.1.6).
export const profileOf = (
  input: QuickStartInput,
  endpoint?: ParsedEndpoint,
): ImportProfileRequest => {
  const recipe = recipeFor(input.agent);
  if (input.source === 'anthropic') {
    // providers/claude-code.yaml at v0.1.6, with one env var.
    return {
      id: input.name,
      displayName: 'Claude Code',
      description: 'Claude Code with an Anthropic API key',
      category: 'AGENT',
      inferenceCapable: true,
      credentials: [
        {
          name: 'api_key',
          description: 'Anthropic API key',
          envVars: ['ANTHROPIC_API_KEY'],
          required: true,
          authStyle: 'header',
          headerName: 'x-api-key',
        },
      ],
      networkEndpoints: [
        'api.anthropic.com',
        'statsig.anthropic.com',
        'sentry.io',
      ].map((host) => ({ host, port: 443, ...REST_ENDPOINT })),
      binaries: recipe.programs.map((path) => ({ path })),
    };
  }
  return {
    id: input.name,
    displayName: input.name,
    description: `OpenAI-compatible model endpoint at ${endpoint?.host ?? ''}, for ${recipe.name}`,
    category: 'INFERENCE',
    inferenceCapable: true,
    credentials: [
      {
        name: 'api_key',
        description: 'API key of the model endpoint',
        envVars: [keyEnvVar(input.name)],
        required: true,
        authStyle: 'bearer',
        headerName: 'authorization',
      },
    ],
    networkEndpoints: endpoint
      ? [{ host: endpoint.host, port: endpoint.port, ...REST_ENDPOINT }]
      : [],
    // curl is what the check of the endpoint runs.
    binaries: [...recipe.programs, '/usr/bin/curl'].map((path) => ({ path })),
  };
};

// The env var the key is stored under: the first the profile declares
// (hard fact 8).
export const credentialKey = (input: QuickStartInput): string =>
  input.source === 'anthropic' ? 'ANTHROPIC_API_KEY' : keyEnvVar(input.name);

export const providerOf = (
  input: QuickStartInput,
  workspace: string,
): CreateProviderRequest => ({
  name: input.name,
  type: input.name,
  // The profile is imported into the workspace, so that is where it resolves.
  profileWorkspace: workspace,
  credentials: { [credentialKey(input)]: input.apiKey },
});

export const sandboxOf = (input: QuickStartInput): CreateSandboxRequest => ({
  image: RECIPE_IMAGE,
  providers: [input.name],
  policy: initialPolicy(),
});

// The command that asks the endpoint for its models from inside the sandbox,
// which is also what shows that the key and the route work. It prints the
// body, then the HTTP status on a line of its own.
export const modelsCheckCommand = (
  input: QuickStartInput,
  endpoint: ParsedEndpoint,
): string[] => [
  'sh',
  '-c',
  `curl -sS -m 20 -w '\\n%{http_code}\\n' -H "Authorization: Bearer $${keyEnvVar(input.name)}" "$1"`,
  'sh',
  `${endpoint.baseUrl}/models`,
];

export type ModelsCheck =
  { ok: true; models: string[] } | { ok: false; reason: string };

// What the check printed, read. A terminal session is where it ran, so lines
// end in CR LF and the body may be followed by a prompt's control codes.
export const readModelsCheck = (output: string): ModelsCheck => {
  const lines = output
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let statusIndex = -1;
  lines.forEach((line, index) => {
    if (/^\d{3}$/.test(line)) statusIndex = index;
  });
  if (statusIndex === -1) {
    const said = lines.join(' ').slice(0, 300);
    return {
      ok: false,
      reason: said
        ? `The sandbox could not reach the endpoint: ${said}`
        : 'The sandbox could not reach the endpoint, and curl said nothing.',
    };
  }
  const status = Number(lines[statusIndex]);
  const body = lines.slice(0, statusIndex).join('\n');
  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: `The endpoint refused the key (HTTP ${status}).`,
    };
  }
  if (status === 0) {
    return {
      ok: false,
      reason: `The sandbox could not connect to the endpoint${body ? `: ${body.slice(0, 300)}` : '.'}`,
    };
  }
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      reason: `The endpoint answered HTTP ${status}${body ? `: ${body.slice(0, 300)}` : ''}`,
    };
  }
  try {
    const parsed = JSON.parse(body) as { data?: { id?: unknown }[] };
    const models = (parsed.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id !== '');
    return models.length > 0
      ? { ok: true, models }
      : { ok: false, reason: 'The endpoint lists no models.' };
  } catch {
    return {
      ok: false,
      reason: `The endpoint answered, but not with a list of models: ${body.slice(0, 200)}`,
    };
  }
};

// Where OpenCode reads its configuration, for the sandbox user.
export const OPENCODE_CONFIG_DIR = '/sandbox/.config/opencode';
export const OPENCODE_CONFIG_FILE = 'opencode.json';

// OpenCode's configuration for a model endpoint of the person's own. It
// cannot be added from OpenCode's own /connect, which offers the services it
// knows. The key is not written here: the config names the env var, which
// holds the placeholder the gateway's proxy swaps on the way out.
export const opencodeConfig = (
  input: QuickStartInput,
  endpoint: ParsedEndpoint,
  models: string[],
  model: string,
): string =>
  `${JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      autoupdate: false,
      provider: {
        [input.name]: {
          npm: '@ai-sdk/openai-compatible',
          name: input.name,
          options: {
            baseURL: endpoint.baseUrl,
            apiKey: `{env:${keyEnvVar(input.name)}}`,
          },
          models: Object.fromEntries(models.map((id) => [id, { name: id }])),
        },
      },
      model: `${input.name}/${model}`,
    },
    null,
    2,
  )}\n`;
