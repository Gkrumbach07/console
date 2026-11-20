import { presetFor, type ModelProvider } from '../presets';
import {
  EMPTY_SETUP,
  SetupError,
  runSetup,
  setupStepsFor,
  type SetupApi,
  type SetupState,
} from '../setup';
import type { Sandbox } from '../../types';

const maas: ModelProvider = {
  name: 'maas',
  baseUrl: 'https://maas.example.com/v1',
  envVar: 'MAAS_API_KEY',
};

const sandbox = (phase: string, extra: Partial<Sandbox['status']> = {}) =>
  ({
    metadata: { name: 'brave-otter' },
    status: { phase, currentPolicyVersion: 1, ...extra },
  }) as unknown as Sandbox;

const MODELS = '{"data":[{"id":"granite"},{"id":"llama"}]}\r\n200\r\n';

const makeApi = (over: Partial<SetupApi> = {}) => {
  const calls: string[] = [];
  const api: SetupApi = {
    getSandbox: jest.fn(async () => sandbox('READY')),
    runInSandbox: jest.fn(async () => {
      calls.push('models');
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

const run = (
  api: SetupApi,
  start: SetupState = EMPTY_SETUP,
  preset = presetFor('opencode'),
  providers: ModelProvider[] = [maas],
) => {
  const seen: SetupState[] = [];
  const result = runSetup(
    'team-a',
    'brave-otter',
    preset,
    providers,
    api,
    start,
    (state) => seen.push(state),
  );
  return { result, seen };
};

describe('setupStepsFor', () => {
  it('configures OpenCode only when a model API of one’s own is attached', () => {
    expect(setupStepsFor(presetFor('opencode'), [maas])).toEqual([
      'ready',
      'models',
      'config',
    ]);
    expect(setupStepsFor(presetFor('opencode'), [])).toEqual(['ready']);
    // The other agents know their service and read their key themselves.
    expect(setupStepsFor(presetFor('claude-code'), [maas])).toEqual(['ready']);
  });
});

describe('runSetup', () => {
  it('waits for the sandbox, asks for the models, then writes the config', async () => {
    const phases = ['PROVISIONING', 'PROVISIONING', 'READY'];
    const { api, calls } = makeApi({
      getSandbox: jest.fn(async () => sandbox(phases.shift() ?? 'READY')),
    });
    const state = await run(api).result;

    expect(api.getSandbox).toHaveBeenCalledTimes(3);
    expect(calls).toEqual(['models', 'config']);
    expect(state).toEqual({
      done: ['ready', 'models', 'config'],
      found: [{ provider: maas, models: ['granite', 'llama'] }],
    });
    const [workspace, name, file, dest] = (api.uploadFile as jest.Mock).mock
      .calls[0] as [string, string, File, string];
    expect([workspace, name, file.name, dest]).toEqual([
      'team-a',
      'brave-otter',
      'opencode.json',
      '/sandbox/.config/opencode',
    ]);
  });

  it('only waits for the sandbox when there is nothing to configure', async () => {
    const { api, calls } = makeApi();
    const state = await run(api, EMPTY_SETUP, presetFor('claude-code')).result;
    expect(state.done).toEqual(['ready']);
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
    const failed = await run(api).result.catch((error) => error);
    expect(failed).toBeInstanceOf(SetupError);
    expect(failed).toMatchObject({
      step: 'ready',
      message: 'The sandbox failed to start: image pull failed',
    });
  });

  // Trying again does not wait for the sandbox a second time, and goes on
  // from the step that failed.
  it('names the provider that failed, and picks up there', async () => {
    const refused = makeApi({
      runInSandbox: jest.fn(async () => ({
        output: '{"error":"bad key"}\r\n401\r\n',
        exitCode: 0,
      })),
    });
    const first = run(refused.api);
    await expect(first.result).rejects.toMatchObject({
      step: 'models',
      message: 'maas: It refused the key (HTTP 401).',
    });
    const reached = first.seen[first.seen.length - 1];
    expect(reached.done).toEqual(['ready']);

    const again = makeApi();
    const state = await run(again.api, reached).result;
    expect(again.api.getSandbox).not.toHaveBeenCalled();
    expect(again.calls).toEqual(['models', 'config']);
    expect(state.done).toEqual(['ready', 'models', 'config']);
  });
});
