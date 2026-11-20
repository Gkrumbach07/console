// What Create sandbox does after the gateway has taken the sandbox, when the
// sandbox was made to run an agent: wait until it is ready, and, for an agent
// that can be pointed at a model API of the person's own, ask that API for
// its models from inside the sandbox and write the agent's configuration.
// Each step is a request the dashboard already knows how to send, and a step
// that fails can be tried again from where it stopped.

import { getConfigurationRejection } from '../utils/sandboxLifecycle';
import type { Sandbox } from '../types';
import {
  OPENCODE_CONFIG_DIR,
  OPENCODE_CONFIG_FILE,
  modelsCheckCommand,
  opencodeConfig,
  readModelsCheck,
  type ModelProvider,
  type RunPreset,
} from './presets';

export type SetupStep = 'ready' | 'models' | 'config';

export const SETUP_TITLES: Record<SetupStep, string> = {
  ready: 'Wait for the sandbox to be ready',
  models: 'Ask the model API for its models, from the sandbox',
  config: "Write the agent's configuration",
};

// The steps a preset takes. Only OpenCode is configured for a model API of
// one's own; the other agents know their service and read their key from
// the environment.
export const setupStepsFor = (
  preset: RunPreset,
  modelProviders: ModelProvider[],
): SetupStep[] =>
  preset.id === 'opencode' && modelProviders.length > 0
    ? ['ready', 'models', 'config']
    : ['ready'];

export type FoundModels = { provider: ModelProvider; models: string[] };

// What the steps have done so far.
export type SetupState = {
  done: SetupStep[];
  found?: FoundModels[];
};

export const EMPTY_SETUP: SetupState = { done: [] };

export class SetupError extends Error {
  step: SetupStep;
  constructor(step: SetupStep, message: string) {
    super(message);
    this.step = step;
  }
}

// The requests the steps send, given so that the steps can be run against
// stand-ins.
export type SetupApi = {
  getSandbox: (workspace: string, name: string) => Promise<Sandbox>;
  runInSandbox: (
    workspace: string,
    name: string,
    command: string[],
  ) => Promise<{ output: string; exitCode: number }>;
  uploadFile: (
    workspace: string,
    name: string,
    file: File,
    dest: string,
  ) => Promise<unknown>;
  // Waits between two reads of a sandbox that is starting.
  wait?: (ms: number) => Promise<void>;
};

const READY_POLL_MS = 2_000;
const READY_TIMEOUT_MS = 180_000;

const waitUntilReady = async (
  api: SetupApi,
  workspace: string,
  name: string,
): Promise<void> => {
  const wait =
    api.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let waited = 0; waited <= READY_TIMEOUT_MS; waited += READY_POLL_MS) {
    const sandbox = await api.getSandbox(workspace, name);
    const rejection = getConfigurationRejection(sandbox);
    if (rejection) {
      throw new Error(
        `The sandbox refused its configuration${rejection.message ? `: ${rejection.message}` : '.'}`,
      );
    }
    if (sandbox.status.phase === 'READY') return;
    if (sandbox.status.phase === 'ERROR') {
      const why = (sandbox.status.conditions ?? [])
        .filter((condition) => condition.status === 'False')
        .map((condition) => condition.message)
        .filter(Boolean)
        .join('; ');
      throw new Error(`The sandbox failed to start${why ? `: ${why}` : '.'}`);
    }
    await wait(READY_POLL_MS);
  }
  throw new Error(
    'The sandbox is still starting after three minutes. It may yet become ready: check its page, then try again.',
  );
};

// Runs the steps that are not done yet, reporting the state after each. It
// throws a SetupError naming the step that failed; calling it again with the
// state it last reported picks up there.
export const runSetup = async (
  workspace: string,
  sandboxName: string,
  preset: RunPreset,
  modelProviders: ModelProvider[],
  api: SetupApi,
  start: SetupState,
  onProgress: (state: SetupState, running?: SetupStep) => void,
): Promise<SetupState> => {
  let state = start;

  const step = async (
    id: SetupStep,
    work: () => Promise<Partial<SetupState>>,
  ): Promise<void> => {
    if (state.done.includes(id)) return;
    onProgress(state, id);
    try {
      const made = await work();
      state = { ...state, ...made, done: [...state.done, id] };
      onProgress(state);
    } catch (error) {
      onProgress(state);
      throw new SetupError(id, (error as Error).message);
    }
  };

  for (const id of setupStepsFor(preset, modelProviders)) {
    if (id === 'ready') {
      await step(id, async () => {
        await waitUntilReady(api, workspace, sandboxName);
        return {};
      });
    } else if (id === 'models') {
      await step(id, async () => {
        const found: FoundModels[] = [];
        for (const provider of modelProviders) {
          const { output } = await api.runInSandbox(
            workspace,
            sandboxName,
            modelsCheckCommand(provider),
          );
          const check = readModelsCheck(output);
          if (!check.ok) {
            throw new Error(`${provider.name}: ${check.reason}`);
          }
          found.push({ provider, models: check.models });
        }
        return { found };
      });
    } else if (id === 'config') {
      await step(id, async () => {
        if (!state.found?.length) {
          throw new Error('No model API has been checked yet.');
        }
        await api.uploadFile(
          workspace,
          sandboxName,
          new File([opencodeConfig(state.found)], OPENCODE_CONFIG_FILE, {
            type: 'application/json',
          }),
          OPENCODE_CONFIG_DIR,
        );
        return {};
      });
    }
  }
  return state;
};
