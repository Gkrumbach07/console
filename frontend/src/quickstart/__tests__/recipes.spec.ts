import {
  AGENT_RECIPES,
  RECIPE_IMAGE,
  keyEnvVar,
  modelsCheckCommand,
  opencodeConfig,
  parseEndpoint,
  profileOf,
  providerOf,
  readModelsCheck,
  sandboxOf,
  suggestedName,
  type QuickStartInput,
} from '../recipes';

const own: QuickStartInput = {
  agent: 'opencode',
  source: 'own-endpoint',
  name: 'maas',
  baseUrl: 'https://maas.apps.example.com/v1/',
  apiKey: 'test-key',
  model: '',
};

const endpoint = parseEndpoint(own.baseUrl).endpoint!;

describe('parseEndpoint', () => {
  it('reads the host, the port of the scheme, and the URL without its last slash', () => {
    expect(endpoint).toEqual({
      baseUrl: 'https://maas.apps.example.com/v1',
      host: 'maas.apps.example.com',
      port: 443,
    });
    expect(parseEndpoint('http://models.internal:8080').endpoint).toEqual({
      baseUrl: 'http://models.internal:8080',
      host: 'models.internal',
      port: 8080,
    });
    expect(parseEndpoint('http://models.internal/v1').endpoint?.port).toBe(80);
  });

  it.each([
    ['', /Enter the URL/],
    ['maas.example.com/v1', /Not a URL/],
    ['ftp://maas.example.com', /https:\/\/ or http:\/\//],
    ['https://user:secret@maas.example.com/v1', /Leave the key out/],
    ['https://maas.example.com/v1?key=abc', /after the path/],
  ])('refuses %p', (text, reason) => {
    const parsed = parseEndpoint(text);
    expect(parsed.endpoint).toBeUndefined();
    expect(parsed.error).toMatch(reason);
  });
});

describe('names', () => {
  it('suggests the first label of the host, and a plain word when it is not a name', () => {
    expect(suggestedName('maas.apps.example.com')).toBe('maas');
    expect(suggestedName('10.0.0.5')).toBe('10');
    expect(suggestedName('_.example.com')).toBe('model');
  });

  it('names the key after the connection, as an env var', () => {
    expect(keyEnvVar('maas')).toBe('MAAS_API_KEY');
    expect(keyEnvVar('my-models')).toBe('MY_MODELS_API_KEY');
  });
});

describe('what a recipe sends', () => {
  // The gateway admits a connection only from a program a profile names, by
  // the path the kernel resolved. In the base image OpenCode's connections
  // come from /usr/lib/node_modules/opencode-ai/bin/.opencode (measured on
  // 0.1.6), which the folder's glob covers on any architecture.
  it("names OpenCode's programs and curl in the profile of an endpoint of one's own", () => {
    const profile = profileOf(own, endpoint);
    expect(profile.binaries).toEqual([
      { path: '/usr/bin/opencode' },
      { path: '/usr/lib/node_modules/opencode-ai/**' },
      { path: '/usr/bin/curl' },
    ]);
    expect(profile.networkEndpoints).toEqual([
      {
        host: 'maas.apps.example.com',
        port: 443,
        protocol: 'rest',
        access: 'NETWORK_ACCESS_PRESET_READ_WRITE',
        enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
      },
    ]);
    expect(profile.credentials).toEqual([
      expect.objectContaining({
        name: 'api_key',
        envVars: ['MAAS_API_KEY'],
        required: true,
        authStyle: 'bearer',
        headerName: 'authorization',
      }),
    ]);
    expect(profile).toMatchObject({
      id: 'maas',
      category: 'INFERENCE',
      inferenceCapable: true,
    });
  });

  it("uses upstream's Claude Code profile for an Anthropic key", () => {
    const profile = profileOf({
      ...own,
      agent: 'claude-code',
      source: 'anthropic',
      name: 'claude-code',
    });
    expect(profile.binaries).toEqual([
      { path: '/usr/bin/claude' },
      { path: '/usr/local/bin/claude' },
    ]);
    expect(profile.networkEndpoints?.map((e) => e.host)).toEqual([
      'api.anthropic.com',
      'statsig.anthropic.com',
      'sentry.io',
    ]);
    expect(profile.credentials?.[0]).toMatchObject({
      envVars: ['ANTHROPIC_API_KEY'],
      authStyle: 'header',
      headerName: 'x-api-key',
    });
  });

  // Hard fact 8: a credential is stored under its env var name, and the
  // profile is looked up in the workspace it was imported into.
  it('stores the key under its env var, against the profile of the workspace', () => {
    expect(providerOf(own, 'team-a')).toEqual({
      name: 'maas',
      type: 'maas',
      profileWorkspace: 'team-a',
      credentials: { MAAS_API_KEY: 'test-key' },
    });
  });

  it('creates the sandbox from the image the paths are for, with the provider and the default policy', () => {
    const sandbox = sandboxOf(own);
    expect(sandbox.image).toBe(RECIPE_IMAGE);
    expect(sandbox.providers).toEqual(['maas']);
    expect(sandbox.policy.networkPolicies).toEqual({});
    expect(sandbox.policy.filesystem?.readWrite).toContain('/sandbox');
  });

  it('gives every recipe a command and the programs that connect', () => {
    for (const recipe of AGENT_RECIPES) {
      expect(recipe.command.length).toBeGreaterThan(0);
      expect(recipe.programs.every((path) => path.startsWith('/'))).toBe(true);
      expect(recipe.sources.length).toBeGreaterThan(0);
    }
  });
});

describe('the check of the endpoint', () => {
  it('asks for the models with the key from its env var, never with the key itself', () => {
    const command = modelsCheckCommand(own, endpoint);
    expect(command.slice(0, 2)).toEqual(['sh', '-c']);
    expect(command[2]).toContain('Bearer $MAAS_API_KEY');
    expect(command[4]).toBe('https://maas.apps.example.com/v1/models');
    expect(command.join(' ')).not.toContain('test-key');
  });

  it('reads the models from what a terminal session printed', () => {
    const output =
      '{"object": "list", "data": [{"id": "granite"}, {"id": "llama"}]}\r\n200\r\n';
    expect(readModelsCheck(output)).toEqual({
      ok: true,
      models: ['granite', 'llama'],
    });
  });

  it.each([
    ['{"error": "no"}\r\n401\r\n', /refused the key \(HTTP 401\)/],
    ['Not Found\r\n404\r\n', /answered HTTP 404: Not Found/],
    ['curl: (52) Empty reply from server\r\n000\r\n', /could not connect/],
    ['curl: (6) Could not resolve host\r\n', /could not reach the endpoint/],
    ['', /curl said nothing/],
    ['<html>hello</html>\r\n200\r\n', /not with a list of models/],
    ['{"data": []}\r\n200\r\n', /lists no models/],
  ])('says why %p is not a list of models', (output, reason) => {
    const check = readModelsCheck(output);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toMatch(reason);
  });
});

describe("OpenCode's configuration", () => {
  it('points OpenCode at the endpoint and names the env var, not the key', () => {
    const text = opencodeConfig(own, endpoint, ['granite', 'llama'], 'llama');
    expect(text).not.toContain('test-key');
    expect(JSON.parse(text)).toEqual({
      $schema: 'https://opencode.ai/config.json',
      autoupdate: false,
      provider: {
        maas: {
          npm: '@ai-sdk/openai-compatible',
          name: 'maas',
          options: {
            baseURL: 'https://maas.apps.example.com/v1',
            apiKey: '{env:MAAS_API_KEY}',
          },
          models: { granite: { name: 'granite' }, llama: { name: 'llama' } },
        },
      },
      model: 'maas/llama',
    });
  });
});
