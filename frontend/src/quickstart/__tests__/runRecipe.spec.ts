import {
  EMPTY_RUN,
  QuickStartError,
  runQuickStart,
  stepsFor,
  type QuickStartApi,
  type RunState,
} from '../runRecipe';
import type { QuickStartInput } from '../recipes';
import type { Sandbox } from '../../types';

const input: QuickStartInput = {
  agent: 'opencode',
  source: 'own-endpoint',
  name: 'maas',
  baseUrl: 'https://maas.example.com/v1',
  apiKey: 'test-key',
  model: '',
};

const sandbox = (phase: string, extra: Partial<Sandbox['status']> = {}) =>
  ({
    metadata: { name: 'brave-otter' },
    status: { phase, currentPolicyVersion: 1, ...extra },
  }) as unknown as Sandbox;

const MODELS =
  '{"object":"list","data":[{"id":"granite"},{"id":"llama"}]}\r\n200\r\n';

const makeApi = (over: Partial<QuickStartApi> = {}) => {
  const calls: string[] = [];
  const api: QuickStartApi = {
    importProfiles: jest.fn(async () => {
      calls.push('profile');
      return { imported: true, profiles: [] };
    }),
    createProvider: jest.fn(async () => {
      calls.push('provider');
    }),
    createSandbox: jest.fn(async () => {
      calls.push('sandbox');
      return sandbox('PROVISIONING');
    }),
    getSandbox: jest.fn(async () => sandbox('READY')),
    runInSandbox: jest.fn(async () => {
      calls.push('check');
      return { output: MODELS, exitCode: 0 };
    }),
    uploadFile: jest.fn(async () => {
      calls.push('config');
    }),
    wait: async () => undefined,
    ...over,
  };
  return { api, calls };
};

const run = (api: QuickStartApi, start: RunState = EMPTY_RUN, over = {}) => {
  const seen: RunState[] = [];
  const result = runQuickStart(
    'team-a',
    { ...input, ...over },
    api,
    start,
    (state) => seen.push(state),
  );
  return { result, seen };
};

describe('runQuickStart', () => {
  it('makes the profile, the provider and the sandbox, checks the endpoint and writes the config, in that order', async () => {
    const { api, calls } = makeApi();
    const state = await run(api).result;

    expect(calls).toEqual([
      'profile',
      'provider',
      'sandbox',
      'check',
      'config',
    ]);
    expect(state).toEqual({
      done: ['profile', 'provider', 'sandbox', 'check', 'config'],
      sandboxName: 'brave-otter',
      models: ['granite', 'llama'],
      model: 'granite',
    });
    // The config goes where OpenCode reads it, and holds no key.
    const [workspace, name, file, dest] = (api.uploadFile as jest.Mock).mock
      .calls[0] as [string, string, File, string];
    expect([workspace, name, file.name, dest]).toEqual([
      'team-a',
      'brave-otter',
      'opencode.json',
      '/sandbox/.config/opencode',
    ]);
  });

  it('waits for the sandbox to be ready before it checks the endpoint', async () => {
    const phases = ['PROVISIONING', 'PROVISIONING', 'READY'];
    const { api, calls } = makeApi({
      getSandbox: jest.fn(async () => sandbox(phases.shift() ?? 'READY')),
    });
    await run(api).result;
    expect(api.getSandbox).toHaveBeenCalledTimes(3);
    expect(calls.indexOf('check')).toBeGreaterThan(calls.indexOf('sandbox'));
  });

  it('starts on the model that was asked for, when the endpoint lists it', async () => {
    const { api } = makeApi();
    expect((await run(api, EMPTY_RUN, { model: 'llama' }).result).model).toBe(
      'llama',
    );
  });

  it('names the models the endpoint lists when the one asked for is not among them', async () => {
    const { api } = makeApi();
    await expect(
      run(api, EMPTY_RUN, { model: 'gpt-9' }).result,
    ).rejects.toMatchObject({
      step: 'check',
      message: expect.stringContaining('It lists: granite, llama.'),
    });
  });

  it('says what the gateway refused in a profile', async () => {
    const { api, calls } = makeApi({
      importProfiles: jest.fn(async () => ({
        imported: false,
        profiles: [],
        diagnostics: [
          { field: 'endpoints[0].host', message: 'host is not allowed' },
        ],
      })),
    });
    const failed = await run(api).result.catch((error) => error);
    expect(failed).toBeInstanceOf(QuickStartError);
    expect(failed).toMatchObject({
      step: 'profile',
      message: 'endpoints[0].host: host is not allowed',
    });
    expect(calls).toEqual([]);
  });

  it('stops at a sandbox that fails to start, with the reason it gives', async () => {
    const { api } = makeApi({
      getSandbox: jest.fn(async () =>
        sandbox('ERROR', {
          conditions: [
            { type: 'Ready', status: 'False', message: 'image pull failed' },
          ],
        }),
      ),
    });
    await expect(run(api).result).rejects.toMatchObject({
      step: 'sandbox',
      message: 'The sandbox failed to start: image pull failed',
    });
  });

  // What an earlier try made stays: trying again does not make a second
  // provider or a second sandbox.
  it('picks up at the step that failed, without making anything twice', async () => {
    const refused = makeApi({
      runInSandbox: jest.fn(async () => ({
        output: '{"error":"bad key"}\r\n401\r\n',
        exitCode: 0,
      })),
    });
    const first = run(refused.api);
    await expect(first.result).rejects.toMatchObject({
      step: 'check',
      message: 'The endpoint refused the key (HTTP 401).',
    });
    const reached = first.seen[first.seen.length - 1];
    expect(reached.done).toEqual(['profile', 'provider', 'sandbox']);
    expect(reached.sandboxName).toBe('brave-otter');

    const again = makeApi();
    const state = await run(again.api, reached).result;
    expect(again.calls).toEqual(['check', 'config']);
    expect(again.api.createSandbox).not.toHaveBeenCalled();
    expect(state.done).toEqual([
      'profile',
      'provider',
      'sandbox',
      'check',
      'config',
    ]);
  });

  it('takes three steps for an agent that knows its own service', async () => {
    const claude = { agent: 'claude-code', source: 'anthropic' } as const;
    expect(stepsFor({ ...input, ...claude })).toEqual([
      'profile',
      'provider',
      'sandbox',
    ]);
    const { api, calls } = makeApi();
    await run(api, EMPTY_RUN, { ...claude, name: 'claude-code' }).result;
    expect(calls).toEqual(['profile', 'provider', 'sandbox']);
    expect(api.runInSandbox).not.toHaveBeenCalled();
    expect(api.uploadFile).not.toHaveBeenCalled();
  });
});
