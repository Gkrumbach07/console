// What a sandbox is going to run, as a choice on Create sandbox: a shell, or
// one of the agents the community `base` image holds. It is the form of
// `openshell sandbox create -- opencode`: the agent is what runs in the
// sandbox, not an object of its own (ADR 0003: there is no Agent).
//
// A preset is data. What it knows that a person does not is where its
// program lives in the image: the gateway admits a connection only from a
// program a provider's profile names, by the path the kernel resolved, so a
// provider that does not name the preset's programs lets the agent reach
// nothing. The form says so before the sandbox is created.
//
// Measured on gateway 0.1.6 with the community `base` image (2026-11-20):
// OpenCode 1.2.18 is /usr/bin/opencode, a Node launcher that runs
// /usr/lib/node_modules/opencode-ai/bin/.opencode, the program that makes the
// connections. It also tries models.dev, registry.npmjs.org and opencode.ai,
// and runs without them. Claude Code 2.1.156 is /usr/local/bin/claude; with
// upstream's claude-code profile its calls to api.anthropic.com are allowed,
// and it also tries Datadog's log intake. Codex is /usr/bin/codex, a Node
// launcher under /usr/lib/node_modules/@openai, the layout upstream's codex
// profile names; what it connects from was not measured.

import type {
  CreateProviderRequest,
  ImportProfileRequest,
  Provider,
  ProviderProfile,
} from '../types';

export type PresetId = 'shell' | 'opencode' | 'claude-code' | 'codex';

export type RunPreset = {
  id: PresetId;
  name: string;
  description: string;
  // What the terminal runs. Empty is the image's login shell.
  command: string[];
  // The programs that make its connections in the image, as the kernel
  // resolves them. A glob covers a per-architecture install folder.
  programs: string[];
  // Hosts it tries besides its model, which nothing here allows: said up
  // front so the first proposals are no surprise.
  alsoTries: string[];
};

export const RUN_PRESETS: RunPreset[] = [
  {
    id: 'shell',
    name: 'A shell',
    description: 'The login shell of the image, to run whatever you like.',
    command: [],
    programs: [],
    alsoTries: [],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description:
      'The open-source coding agent. Works with any OpenAI-compatible model endpoint, including one you host.',
    command: ['opencode'],
    programs: ['/usr/bin/opencode', '/usr/lib/node_modules/opencode-ai/**'],
    alsoTries: ['models.dev', 'registry.npmjs.org', 'opencode.ai'],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: "Anthropic's coding agent.",
    command: ['claude'],
    programs: ['/usr/bin/claude', '/usr/local/bin/claude'],
    alsoTries: ['http-intake.logs.us5.datadoghq.com'],
  },
  {
    id: 'codex',
    name: 'Codex',
    description: "OpenAI's coding agent.",
    command: ['codex'],
    programs: [
      '/usr/bin/codex',
      '/usr/local/bin/codex',
      '/usr/lib/node_modules/@openai/**',
    ],
    alsoTries: [],
  },
];

export const presetFor = (id: string | undefined): RunPreset =>
  RUN_PRESETS.find((preset) => preset.id === id) ?? RUN_PRESETS[0];

// The label a sandbox made with a preset carries, so that its page can offer
// the agent again and the list can be filtered by it. Labels categorize.
export const PRESET_LABEL = 'type';

// Whether a profile path lets a program through: the same path, or a glob
// that covers it. Only the globs upstream's profiles use are read: a
// trailing /** (anything below) and a * within one segment.
const pathCovers = (pattern: string, path: string): boolean => {
  if (pattern === path) return true;
  if (pattern.endsWith('/**')) {
    const folder = pattern.slice(0, -2);
    return path.startsWith(folder) || path === pattern;
  }
  if (!pattern.includes('*')) return false;
  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${expression}$`).test(path);
};

// Whether a provider's profile lets a preset's program reach its endpoints.
// One of the preset's programs named, or covered by a glob, is enough: they
// are the layouts of one agent. A preset without programs (a shell) asks for
// nothing.
export const profileAllows = (
  profile: Pick<ProviderProfile, 'binaries'> | undefined,
  preset: RunPreset,
): boolean => {
  if (preset.programs.length === 0) return true;
  const named = (profile?.binaries ?? []).map((binary) => binary.path);
  return preset.programs.some((program) =>
    named.some(
      (path) => pathCovers(path, program) || pathCovers(program, path),
    ),
  );
};

// A profile with a preset's programs added, whole, as an update has to send
// it (the gateway replaces a stored profile with the one it is sent).
export const profileWithPrograms = (
  profile: ProviderProfile,
  preset: RunPreset,
): ImportProfileRequest => {
  const named = new Set((profile.binaries ?? []).map((binary) => binary.path));
  // The list's host:port summaries are not part of what is written.
  const written: ImportProfileRequest & { endpoints?: unknown } = {
    ...profile,
    endpoints: undefined,
    binaries: [
      ...(profile.binaries ?? []),
      ...preset.programs
        .filter((path) => !named.has(path))
        .map((path) => ({ path })),
    ],
  };
  delete written.endpoints;
  return written;
};

// --- A provider for a service of one's own, from its URL and key ---

export type ParsedEndpoint = {
  // The base URL without a trailing slash, as a program's config takes it.
  baseUrl: string;
  host: string;
  port: number;
};

// The endpoint of a base URL, or why it is not one. The profile needs the
// host and the port; a program's config needs the URL.
export const parseEndpoint = (
  raw: string,
): { endpoint?: ParsedEndpoint; error?: string } => {
  const text = raw.trim();
  if (!text) return { error: 'Enter the URL the service is served at.' };
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

// The name offered for a service at a host: its first label.
export const suggestedName = (host: string): string => {
  const label = host
    .split('.')[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  return NAME_PATTERN.test(label) ? label : 'service';
};

// The env var the sandbox sees the key's placeholder in: MAAS_API_KEY for a
// provider named maas.
export const keyEnvVar = (name: string): string =>
  `${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;

// Where a provider keeps the URL of its service. A profile holds a host and
// a port, not the path a model API is served under, and a program's config
// needs the whole URL. It is not a secret, so it is one of the provider's
// config entries.
export const BASE_URL_CONFIG_KEY = 'base_url';

export type OwnServiceInput = {
  name: string;
  baseUrl: string;
  apiKey: string;
  // The programs that may use it, by the path the kernel resolves.
  programs: string[];
  // An OpenAI-compatible model API: /models and /chat/completions under the
  // URL. It is what lets a preset list its models and configure itself.
  isModelApi: boolean;
};

// The provider profile for a service of one's own. Upstream has no example
// for a service on a host of the person's own, and says to import a separate
// profile naming that host (providers/openai.yaml at v0.1.6), which is what
// this writes.
export const profileForService = (
  input: OwnServiceInput,
  endpoint: ParsedEndpoint,
): ImportProfileRequest => ({
  id: input.name,
  displayName: input.name,
  description: `${input.isModelApi ? 'OpenAI-compatible model API' : 'Service'} at ${endpoint.host}`,
  category: input.isModelApi ? 'INFERENCE' : 'OTHER',
  inferenceCapable: input.isModelApi,
  credentials: [
    {
      name: 'api_key',
      description: 'API key of the service',
      envVars: [keyEnvVar(input.name)],
      required: true,
      authStyle: 'bearer',
      headerName: 'authorization',
    },
  ],
  networkEndpoints: [
    {
      host: endpoint.host,
      port: endpoint.port,
      protocol: 'rest',
      access: 'NETWORK_ACCESS_PRESET_READ_WRITE',
      enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
    },
  ],
  binaries: input.programs.map((path) => ({ path })),
});

export const providerForService = (
  input: OwnServiceInput,
  endpoint: ParsedEndpoint,
  workspace: string,
): CreateProviderRequest => ({
  name: input.name,
  type: input.name,
  // The profile is imported into the workspace, so that is where it resolves.
  profileWorkspace: workspace,
  // Stored under the env var the profile declares (hard fact 8).
  credentials: { [keyEnvVar(input.name)]: input.apiKey },
  config: { [BASE_URL_CONFIG_KEY]: endpoint.baseUrl },
});

// --- A model API a preset can configure itself for ---

export type ModelProvider = {
  name: string;
  baseUrl: string;
  // The env var that holds the key's placeholder in the sandbox.
  envVar: string;
};

// The providers among those attached that serve models at a known URL: an
// inference-capable profile, and the URL the provider keeps.
export const modelProvidersOf = (
  providers: Provider[],
  profileOf: (provider: Provider) => ProviderProfile | undefined,
): ModelProvider[] =>
  providers.flatMap((provider) => {
    const baseUrl = provider.config?.[BASE_URL_CONFIG_KEY];
    const profile = profileOf(provider);
    if (!baseUrl || !profile?.inferenceCapable) return [];
    const envVar =
      profile.credentials?.[0]?.envVars?.[0] ??
      keyEnvVar(provider.metadata.name);
    return [{ name: provider.metadata.name, baseUrl, envVar }];
  });

// The command that asks a model API for its models from inside the sandbox,
// which is also what shows that the key, the route and the policy work. It
// prints the body, then the HTTP status on a line of its own. It runs curl,
// so the provider's profile has to name curl.
export const modelsCheckCommand = (provider: ModelProvider): string[] => [
  'sh',
  '-c',
  `curl -sS -m 20 -w '\\n%{http_code}\\n' -H "Authorization: Bearer $${provider.envVar}" "$1"`,
  'sh',
  `${provider.baseUrl}/models`,
];

export type ModelsCheck =
  { ok: true; models: string[] } | { ok: false; reason: string };

// What the check printed, read. A terminal session is where it ran, so lines
// end in CR LF.
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
        ? `The sandbox could not reach it: ${said}`
        : 'The sandbox could not reach it, and curl said nothing.',
    };
  }
  const status = Number(lines[statusIndex]);
  const body = lines.slice(0, statusIndex).join('\n');
  if (status === 401 || status === 403) {
    return { ok: false, reason: `It refused the key (HTTP ${status}).` };
  }
  if (status === 0) {
    return {
      ok: false,
      reason: `The sandbox could not connect to it${body ? `: ${body.slice(0, 300)}` : '.'}`,
    };
  }
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      reason: `It answered HTTP ${status}${body ? `: ${body.slice(0, 300)}` : ''}`,
    };
  }
  try {
    const parsed = JSON.parse(body) as { data?: { id?: unknown }[] };
    const models = (parsed.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id !== '');
    return models.length > 0
      ? { ok: true, models }
      : { ok: false, reason: 'It lists no models.' };
  } catch {
    return {
      ok: false,
      reason: `It answered, but not with a list of models: ${body.slice(0, 200)}`,
    };
  }
};

// Where OpenCode reads its configuration, for the sandbox user.
export const OPENCODE_CONFIG_DIR = '/sandbox/.config/opencode';
export const OPENCODE_CONFIG_FILE = 'opencode.json';

// OpenCode's configuration for model APIs of the person's own, one entry to
// a provider. They cannot be added from OpenCode's own /connect, which offers
// the services it knows. No key is written: the config names the env var,
// which holds the placeholder the gateway's proxy swaps on the way out.
export const opencodeConfig = (
  found: { provider: ModelProvider; models: string[] }[],
): string => {
  const first = found[0];
  return `${JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      autoupdate: false,
      provider: Object.fromEntries(
        found.map(({ provider, models }) => [
          provider.name,
          {
            npm: '@ai-sdk/openai-compatible',
            name: provider.name,
            options: {
              baseURL: provider.baseUrl,
              apiKey: `{env:${provider.envVar}}`,
            },
            models: Object.fromEntries(models.map((id) => [id, { name: id }])),
          },
        ]),
      ),
      ...(first ? { model: `${first.provider.name}/${first.models[0]}` } : {}),
    },
    null,
    2,
  )}\n`;
};
