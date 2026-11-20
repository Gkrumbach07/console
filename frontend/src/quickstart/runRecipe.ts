// The steps "Run an agent" takes, in order, each one a request the dashboard
// already knows how to send. They are run one after another and can be
// picked up again at the step that failed: what an earlier step made (the
// profile, the provider, the sandbox) stays.

import { getConfigurationRejection } from '../utils/sandboxLifecycle';
import type {
  CreateProviderRequest,
  CreateSandboxRequest,
  ImportProfileRequest,
  ImportProfilesResponse,
  Sandbox,
} from '../types';
import {
  OPENCODE_CONFIG_DIR,
  OPENCODE_CONFIG_FILE,
  modelsCheckCommand,
  opencodeConfig,
  parseEndpoint,
  profileOf,
  providerOf,
  readModelsCheck,
  recipeFor,
  sandboxOf,
  type QuickStartInput,
} from './recipes';

export type StepId = 'profile' | 'provider' | 'sandbox' | 'check' | 'config';

export const STEP_TITLES: Record<StepId, string> = {
  profile: 'Describe the service (provider profile)',
  provider: 'Store the key (provider)',
  sandbox: 'Create the sandbox',
  check: 'Check the model endpoint from the sandbox',
  config: "Write the agent's configuration",
};

// The steps a quick start takes. An agent that reads its key from the
// environment and knows its own service needs no check and no config file.
export const stepsFor = (input: QuickStartInput): StepId[] =>
  input.source === 'own-endpoint'
    ? ['profile', 'provider', 'sandbox', 'check', 'config']
    : ['profile', 'provider', 'sandbox'];

// What the steps have made so far.
export type RunState = {
  done: StepId[];
  sandboxName?: string;
  models?: string[];
  model?: string;
};

export const EMPTY_RUN: RunState = { done: [] };

export class QuickStartError extends Error {
  step: StepId;
  constructor(step: StepId, message: string) {
    super(message);
    this.step = step;
  }
}

// The requests the steps send, given so that the steps can be run against
// stand-ins.
export type QuickStartApi = {
  importProfiles: (
    workspace: string,
    profiles: ImportProfileRequest[],
  ) => Promise<ImportProfilesResponse>;
  createProvider: (
    workspace: string,
    request: CreateProviderRequest,
  ) => Promise<unknown>;
  createSandbox: (
    workspace: string,
    request: CreateSandboxRequest,
  ) => Promise<Sandbox>;
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
  api: QuickStartApi,
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
// throws a QuickStartError naming the step that failed; calling it again with
// the state it last reported picks up there.
export const runQuickStart = async (
  workspace: string,
  input: QuickStartInput,
  api: QuickStartApi,
  start: RunState,
  onProgress: (state: RunState, running?: StepId) => void,
): Promise<RunState> => {
  let state = start;
  const parsed = parseEndpoint(input.baseUrl);
  const endpoint = parsed.endpoint;

  const step = async (
    id: StepId,
    work: () => Promise<Partial<RunState>>,
  ): Promise<void> => {
    if (state.done.includes(id)) return;
    onProgress(state, id);
    try {
      const made = await work();
      state = { ...state, ...made, done: [...state.done, id] };
      onProgress(state);
    } catch (error) {
      onProgress(state);
      throw new QuickStartError(id, (error as Error).message);
    }
  };

  for (const id of stepsFor(input)) {
    if (id === 'profile') {
      await step(id, async () => {
        const answer = await api.importProfiles(workspace, [
          profileOf(input, endpoint),
        ]);
        if (!answer.imported) {
          const why = (answer.diagnostics ?? [])
            .map((diagnostic) =>
              diagnostic.field
                ? `${diagnostic.field}: ${diagnostic.message}`
                : diagnostic.message,
            )
            .join('; ');
          throw new Error(why || 'The gateway did not import the profile.');
        }
        return {};
      });
    } else if (id === 'provider') {
      await step(id, async () => {
        await api.createProvider(workspace, providerOf(input, workspace));
        return {};
      });
    } else if (id === 'sandbox') {
      await step(id, async () => {
        // A sandbox made by an earlier try is waited for, not made again.
        let name = state.sandboxName;
        if (!name) {
          const sandbox = await api.createSandbox(workspace, sandboxOf(input));
          name = sandbox.metadata.name;
          state = { ...state, sandboxName: name };
          onProgress(state, id);
        }
        await waitUntilReady(api, workspace, name);
        return { sandboxName: name };
      });
    } else if (id === 'check') {
      await step(id, async () => {
        if (!endpoint || !state.sandboxName) {
          throw new Error(parsed.error ?? 'There is no sandbox to check from.');
        }
        const { output } = await api.runInSandbox(
          workspace,
          state.sandboxName,
          modelsCheckCommand(input, endpoint),
        );
        const check = readModelsCheck(output);
        if (!check.ok) throw new Error(check.reason);
        const wanted = input.model.trim();
        if (wanted && !check.models.includes(wanted)) {
          throw new Error(
            `The endpoint does not list a model called ${wanted}. It lists: ${check.models.join(', ')}.`,
          );
        }
        return { models: check.models, model: wanted || check.models[0] };
      });
    } else if (id === 'config') {
      await step(id, async () => {
        if (!endpoint || !state.sandboxName || !state.models || !state.model) {
          throw new Error('The model endpoint has not been checked yet.');
        }
        if (recipeFor(input.agent).id === 'opencode') {
          await api.uploadFile(
            workspace,
            state.sandboxName,
            new File(
              [opencodeConfig(input, endpoint, state.models, state.model)],
              OPENCODE_CONFIG_FILE,
              { type: 'application/json' },
            ),
            OPENCODE_CONFIG_DIR,
          );
        }
        return {};
      });
    }
  }
  return state;
};
