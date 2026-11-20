import {
  BASE_URL_CONFIG_KEY,
  RUN_PRESETS,
  keyEnvVar,
  modelProvidersOf,
  modelsCheckCommand,
  opencodeConfig,
  parseEndpoint,
  presetFor,
  profileAllows,
  profileForService,
  profileWithPrograms,
  providerForService,
  readModelsCheck,
  suggestedName,
  type ModelProvider,
  type OwnServiceInput,
} from '../presets';
import type { Provider, ProviderProfile } from '../../types';

const service: OwnServiceInput = {
  name: 'maas',
  baseUrl: 'https://maas.apps.example.com/v1/',
  apiKey: 'test-key',
  programs: ['/usr/bin/opencode', '/usr/bin/curl'],
  isModelApi: true,
};

const endpoint = parseEndpoint(service.baseUrl).endpoint!;

const maas: ModelProvider = {
  name: 'maas',
  baseUrl: 'https://maas.apps.example.com/v1',
  envVar: 'MAAS_API_KEY',
};

const profile = (binaries: string[]): ProviderProfile =>
  ({
    id: 'p',
    displayName: 'P',
    category: 'INFERENCE',
    credentials: [],
    inferenceCapable: true,
    resourceVersion: 3,
    scope: 'workspace',
    endpoints: ['maas.example.com:443'],
    networkEndpoints: [{ host: 'maas.example.com', port: 443 }],
    binaries: binaries.map((path) => ({ path })),
  }) as ProviderProfile;

describe('presets', () => {
  it('offers a shell first, which runs nothing and asks for nothing', () => {
    expect(RUN_PRESETS[0]).toMatchObject({
      id: 'shell',
      command: [],
      programs: [],
    });
    expect(presetFor(undefined).id).toBe('shell');
    expect(presetFor('no-such-thing').id).toBe('shell');
  });

  it('gives every agent a command and the programs that connect', () => {
    for (const preset of RUN_PRESETS.filter((p) => p.id !== 'shell')) {
      expect(preset.command.length).toBeGreaterThan(0);
      expect(preset.programs.length).toBeGreaterThan(0);
      expect(preset.programs.every((path) => path.startsWith('/'))).toBe(true);
    }
  });
});

// The gateway admits a connection only from a program a profile names, by
// the path the kernel resolved. In the base image OpenCode's connections
// come from /usr/lib/node_modules/opencode-ai/bin/.opencode (measured on
// 0.1.6), which the folder's glob covers on any architecture.
describe('profileAllows', () => {
  const opencode = presetFor('opencode');
  const claude = presetFor('claude-code');

  it('is satisfied by a program the profile names, or a glob that covers one', () => {
    expect(profileAllows(profile(['/usr/bin/opencode']), opencode)).toBe(true);
    expect(
      profileAllows(
        profile(['/usr/lib/node_modules/opencode-ai/**']),
        opencode,
      ),
    ).toBe(true);
    expect(profileAllows(profile(['/usr/lib/node_modules/**']), opencode)).toBe(
      true,
    );
    expect(profileAllows(profile(['/usr/local/bin/cl*']), claude)).toBe(true);
  });

  it('is not satisfied by other programs, or by none', () => {
    expect(profileAllows(profile(['/usr/bin/curl']), opencode)).toBe(false);
    expect(profileAllows(profile(['/usr/bin/claude']), opencode)).toBe(false);
    expect(profileAllows(profile([]), opencode)).toBe(false);
    expect(profileAllows(undefined, opencode)).toBe(false);
  });

  it('asks nothing of a provider for a shell', () => {
    expect(profileAllows(profile([]), presetFor('shell'))).toBe(true);
  });

  // An update replaces the stored profile (hard fact 24), so the whole
  // profile goes back, with the programs added and nothing else changed.
  it('adds the programs to the whole profile, once', () => {
    const before = profile(['/usr/bin/curl', '/usr/bin/opencode']);
    const after = profileWithPrograms(before, opencode);
    expect(after.binaries).toEqual([
      { path: '/usr/bin/curl' },
      { path: '/usr/bin/opencode' },
      { path: '/usr/lib/node_modules/opencode-ai/**' },
    ]);
    expect(after.networkEndpoints).toEqual(before.networkEndpoints);
    expect(after.resourceVersion).toBe(3);
    // The list's host:port summaries are not what a write sends.
    expect(after).not.toHaveProperty('endpoints');
  });
});

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

  it('suggests the first label of the host as a name', () => {
    expect(suggestedName('maas.apps.example.com')).toBe('maas');
    expect(suggestedName('_.example.com')).toBe('service');
    expect(keyEnvVar('my-models')).toBe('MY_MODELS_API_KEY');
  });
});

describe('a provider for a service of one’s own', () => {
  it('writes a profile for that host, with the programs that may use it', () => {
    expect(profileForService(service, endpoint)).toMatchObject({
      id: 'maas',
      category: 'INFERENCE',
      inferenceCapable: true,
      credentials: [
        {
          name: 'api_key',
          envVars: ['MAAS_API_KEY'],
          required: true,
          authStyle: 'bearer',
          headerName: 'authorization',
        },
      ],
      networkEndpoints: [
        {
          host: 'maas.apps.example.com',
          port: 443,
          protocol: 'rest',
          access: 'NETWORK_ACCESS_PRESET_READ_WRITE',
          enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
        },
      ],
      binaries: [{ path: '/usr/bin/opencode' }, { path: '/usr/bin/curl' }],
    });
    expect(
      profileForService({ ...service, isModelApi: false }, endpoint),
    ).toMatchObject({ category: 'OTHER', inferenceCapable: false });
  });

  // Hard fact 8: a credential is stored under its env var name, and the
  // profile is looked up in the workspace it was imported into. The URL is
  // not a secret, and a profile has no place for its path.
  it('stores the key under its env var and keeps the URL as config', () => {
    expect(providerForService(service, endpoint, 'team-a')).toEqual({
      name: 'maas',
      type: 'maas',
      profileWorkspace: 'team-a',
      credentials: { MAAS_API_KEY: 'test-key' },
      config: { [BASE_URL_CONFIG_KEY]: 'https://maas.apps.example.com/v1' },
    });
  });
});

describe('modelProvidersOf', () => {
  const provider = (name: string, config?: Record<string, string>): Provider =>
    ({ metadata: { name }, type: name, config }) as Provider;
  const inference = {
    ...profile([]),
    credentials: [{ name: 'api_key', envVars: ['THE_KEY'], required: true }],
  } as ProviderProfile;

  it('takes the providers that serve models at a URL they keep', () => {
    expect(
      modelProvidersOf(
        [
          provider('maas', { base_url: 'https://maas.example.com/v1' }),
          provider('no-url'),
          provider('not-models', { base_url: 'https://x.example.com' }),
        ],
        (p) =>
          p.metadata.name === 'not-models'
            ? ({ ...inference, inferenceCapable: false } as ProviderProfile)
            : inference,
      ),
    ).toEqual([
      {
        name: 'maas',
        baseUrl: 'https://maas.example.com/v1',
        envVar: 'THE_KEY',
      },
    ]);
  });
});

describe('the check of a model API', () => {
  it('asks for the models with the key from its env var', () => {
    const command = modelsCheckCommand(maas);
    expect(command.slice(0, 2)).toEqual(['sh', '-c']);
    expect(command[2]).toContain('Bearer $MAAS_API_KEY');
    expect(command[4]).toBe('https://maas.apps.example.com/v1/models');
  });

  it('reads the models from what a terminal session printed', () => {
    expect(
      readModelsCheck(
        '{"data": [{"id": "granite"}, {"id": "llama"}]}\r\n200\r\n',
      ),
    ).toEqual({ ok: true, models: ['granite', 'llama'] });
  });

  it.each([
    ['{"error": "no"}\r\n401\r\n', /refused the key \(HTTP 401\)/],
    ['Not Found\r\n404\r\n', /answered HTTP 404: Not Found/],
    ['curl: (52) Empty reply from server\r\n000\r\n', /could not connect/],
    ['curl: (6) Could not resolve host\r\n', /could not reach it/],
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
  it('has an entry to a model API, names the env var and not the key, and starts on the first model', () => {
    const other: ModelProvider = {
      name: 'lab',
      baseUrl: 'http://lab.internal:8080/v1',
      envVar: 'LAB_API_KEY',
    };
    const text = opencodeConfig([
      { provider: maas, models: ['granite', 'llama'] },
      { provider: other, models: ['phi'] },
    ]);
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
        lab: {
          npm: '@ai-sdk/openai-compatible',
          name: 'lab',
          options: {
            baseURL: 'http://lab.internal:8080/v1',
            apiKey: '{env:LAB_API_KEY}',
          },
          models: { phi: { name: 'phi' } },
        },
      },
      model: 'maas/granite',
    });
  });
});
