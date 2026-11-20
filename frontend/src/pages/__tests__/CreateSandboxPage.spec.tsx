import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import CreateSandboxPage from '../CreateSandboxPage';
import type { CreateSandboxRequest } from '../../types';

// These drive the real form state (useCreateSandboxForm) through the page, so
// what they assert is the request the gateway is sent, and the policy file
// the person sees beside the form.

const mockMutate = jest.fn();
const mockAddSuccess = jest.fn();
let mockPending = false;
let mockFlags = { settings: true };
let mockRole = { isWorkspaceAdmin: true };

const mockGetSandbox = jest.fn();
const mockUpload = jest.fn();
const mockRunInSandbox = jest.fn();
const mockImportProfiles = jest.fn();
const mockCreateProvider = jest.fn();
const mockUpdateProfile = jest.fn();

jest.mock('../../api/sandboxes', () => ({
  useCreateSandbox: jest.fn(() => ({
    mutate: mockMutate,
    reset: jest.fn(),
    isPending: mockPending,
    isError: false,
    error: null,
  })),
  getSandbox: (...args: unknown[]) => mockGetSandbox(...args),
  uploadFile: (...args: unknown[]) => mockUpload(...args),
}));

jest.mock('../../api/sandboxRun', () => ({
  runInSandbox: (...args: unknown[]) => mockRunInSandbox(...args),
}));

const mockProviders = [
  {
    metadata: { name: 'claude', id: 'p1', createdAtMs: 0, resourceVersion: 1 },
    type: 'claude-code',
    credentialKeys: [],
    configKeys: [],
  },
  {
    metadata: { name: 'gh', id: 'p2', createdAtMs: 0, resourceVersion: 1 },
    type: 'github',
    // Its profile is the workspace's own, which is where it is looked up.
    profileWorkspace: 'team-a',
    credentialKeys: [],
    configKeys: [],
  },
  // A model API of the team's own, added by URL and key: its profile names
  // OpenCode and curl, and the provider keeps the URL.
  {
    metadata: { name: 'maas', id: 'p3', createdAtMs: 0, resourceVersion: 1 },
    type: 'maas',
    profileWorkspace: 'team-a',
    config: { base_url: 'https://maas.example.com/v1' },
  },
];

const mockProfiles = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    scope: 'platform',
    endpoints: ['api.anthropic.com:443'],
    binaries: [{ path: '/usr/local/bin/claude' }],
    inferenceCapable: true,
    resourceVersion: 1,
  },
  {
    id: 'maas',
    displayName: 'maas',
    scope: 'workspace',
    endpoints: ['maas.example.com:443'],
    networkEndpoints: [{ host: 'maas.example.com', port: 443 }],
    binaries: [{ path: '/usr/bin/opencode' }, { path: '/usr/bin/curl' }],
    credentials: [{ name: 'api_key', envVars: ['MAAS_API_KEY'] }],
    inferenceCapable: true,
    resourceVersion: 2,
  },
  {
    id: 'github',
    displayName: 'GitHub',
    scope: 'workspace',
    endpoints: ['api.github.com:443'],
    binaries: [{ path: '/usr/bin/gh' }],
    inferenceCapable: false,
    resourceVersion: 5,
  },
];

jest.mock('../../api/providers', () => ({
  useProviders: jest.fn(() => ({ data: mockProviders })),
  useProviderProfiles: jest.fn(() => ({ data: mockProfiles })),
  useUpdateProviderProfile: jest.fn(() => ({
    mutate: mockUpdateProfile,
    isPending: false,
    isError: false,
    error: null,
  })),
  importProviderProfiles: (...args: unknown[]) => mockImportProfiles(...args),
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
}));

jest.mock('../../api/auth', () => ({
  useFeatureFlags: jest.fn(() => mockFlags),
}));

jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => mockRole),
}));

// The approval mode is written through the real settings client, down to the
// HTTP helper.
jest.mock('../../api/client', () => ({
  get: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({
    addAlert: jest.fn(),
    addSuccess: mockAddSuccess,
    addDanger: jest.fn(),
  })),
}));

// The code editor is a textarea here: what it is given and what it reports.
jest.mock('@patternfly/react-code-editor', () => ({
  Language: { json: 'json', yaml: 'yaml' },
  CodeEditor: ({
    code,
    onCodeChange,
    'data-testid': testId,
  }: {
    code: string;
    onCodeChange?: (value: string) => void;
    'data-testid'?: string;
  }) => (
    <textarea
      data-testid={testId}
      value={code}
      onChange={(event) => onCodeChange?.(event.target.value)}
    />
  ),
}));

import { put } from '../../api/client';
const mockPut = put as jest.Mock;

const onCreated = jest.fn();
const onCancel = jest.fn();

const queryClient = new QueryClient();

const page = () => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <CreateSandboxPage
        workspace="team-a"
        onCreated={onCreated}
        onCancel={onCancel}
      />
    </MemoryRouter>
  </QueryClientProvider>
);

const renderPage = () => render(page());

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const goTo = (step: string) => {
  const nav = document.querySelector('.pf-v6-c-wizard__nav');
  if (!nav) throw new Error('the wizard has no navigation');
  fireEvent.click(
    within(nav as HTMLElement).getByRole('button', { name: step }),
  );
};

// Adds one value to a list input: typed, then Enter.
const addToList = (testId: string, value: string) => {
  const input = screen.getByTestId(`${testId}-input`);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

const listValues = (testId: string) =>
  Array.from(document.querySelectorAll(`[data-testid^="${testId}-item-"]`)).map(
    (item) => item.textContent,
  );

const openFile = () => {
  if (!screen.queryByTestId('sandbox-policy-panel')) {
    fireEvent.click(screen.getByTestId('sandbox-policy-toggle'));
  }
  return screen.getByTestId('sandbox-policy-input') as HTMLTextAreaElement;
};

// The request the form sent on its one and only submit.
const sentRequest = (): CreateSandboxRequest => {
  expect(mockMutate).toHaveBeenCalledTimes(1);
  return mockMutate.mock.calls[0][0] as CreateSandboxRequest;
};

const reviewAndCreate = () => {
  goTo('Review');
  fireEvent.click(screen.getByTestId('create-sandbox-submit'));
};

const readySandbox = {
  metadata: { name: 'brave-otter' },
  status: { phase: 'READY', currentPolicyVersion: 1 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSandbox.mockResolvedValue(readySandbox);
  mockRunInSandbox.mockResolvedValue({
    output: '{"data":[{"id":"granite"},{"id":"llama"}]}\r\n200\r\n',
    exitCode: 0,
  });
  mockUpload.mockResolvedValue({});
  mockImportProfiles.mockResolvedValue({ imported: true, profiles: [] });
  mockCreateProvider.mockResolvedValue({});
  mockPending = false;
  mockFlags = { settings: true };
  mockRole = { isWorkspaceAdmin: true };
});

describe('CreateSandboxPage basics', () => {
  it('asks for the name first, then the image and the providers', () => {
    renderPage();
    const fields = Array.from(
      document.querySelectorAll(
        '[data-testid="sandbox-name-input"], [data-testid="sandbox-image-input"], [data-testid="sandbox-providers-input"]',
      ),
    ).map((field) => field.getAttribute('data-testid'));
    expect(fields).toEqual([
      'sandbox-name-input',
      'sandbox-image-input',
      'sandbox-providers-input',
    ]);
  });

  it('creates from the first step with the defaults: the quick path', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('create-sandbox-review'));
    fireEvent.click(screen.getByTestId('create-sandbox-submit'));

    const request = sentRequest();
    expect(request.name).toBeUndefined();
    expect(request.image).toBeUndefined();
    expect(request.policy.version).toBe(1);
    expect(request.policy.filesystem?.readWrite).toEqual([
      '/sandbox',
      '/tmp',
      '/dev/null',
    ]);
  });

  it('resolves a community sandbox name, and sends no image for spaces', () => {
    renderPage();
    type('sandbox-image-input', 'base');
    expect(screen.getByTestId('sandbox-image-help')).toHaveTextContent(
      'ghcr.io/nvidia/openshell-community/sandboxes/base:latest',
    );
    type('sandbox-image-input', '   ');
    reviewAndCreate();
    expect(sentRequest().image).toBeUndefined();
  });

  it('attaches the providers chosen in the select', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('sandbox-providers-input'));
    fireEvent.click(screen.getByText('claude (claude-code)'));
    expect(
      screen.getByTestId('sandbox-provider-chip-claude'),
    ).toBeInTheDocument();
    reviewAndCreate();
    expect(sentRequest().providers).toEqual(['claude']);
  });
});

describe('CreateSandboxPage policy: the form and the file are one policy', () => {
  it('writes a host added in the form into the file and the request', () => {
    renderPage();
    goTo('Network access');
    fireEvent.click(screen.getByTestId('sandbox-add-host'));
    type('add-host-host', 'pypi.org');
    addToList('add-host-programs', '/usr/bin/pip');
    fireEvent.click(screen.getByTestId('add-host-submit'));

    expect(screen.getByTestId('sandbox-rules-table')).toHaveTextContent(
      'pypi.org:443, read-only',
    );
    expect(openFile().value).toContain('host: pypi.org');
    reviewAndCreate();
    const [rule] = Object.values(sentRequest().policy.networkPolicies ?? {});
    expect(rule?.binaries).toEqual([
      { path: '/usr/bin/curl' },
      { path: '/usr/bin/pip' },
    ]);
    expect(rule?.endpoints?.[0]).toMatchObject({
      host: 'pypi.org',
      port: 443,
      access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
    });
  });

  it('keeps an edit the form has no field for, names it, and sends it', () => {
    renderPage();
    const file = openFile();
    fireEvent.change(file, {
      target: {
        value: file.value.replace(
          'include_workdir: true',
          'include_workdir: false',
        ),
      },
    });
    goTo('Files');
    expect(screen.getByTestId('sandbox-policy-extras')).toHaveTextContent(
      'the working directory is not writable',
    );

    // A change made in the form afterwards leaves the edit in place.
    addToList('sandbox-fs-rw', '/data');
    expect(listValues('sandbox-fs-rw')).toContain('/data');
    expect(openFile().value).toContain('include_workdir: false');
    expect(openFile().value).toContain('- /data');

    reviewAndCreate();
    const { filesystem } = sentRequest().policy;
    expect(filesystem?.includeWorkdir).toBeFalsy();
    expect(filesystem?.readWrite).toContain('/data');
  });

  it('shows a host written in the file in the form', () => {
    renderPage();
    const file = openFile();
    fireEvent.change(file, {
      target: {
        value: `${file.value.replace(/network_policies: \{\}\n?/, '')}network_policies:
  docs:
    name: docs
    endpoints:
      - host: docs.example.com
        port: 443
    binaries:
      - path: /usr/bin/curl
`,
      },
    });
    goTo('Network access');
    expect(screen.getByTestId('sandbox-rule-docs')).toHaveTextContent(
      'docs.example.com:443',
    );
  });

  it('locks the form and refuses to create while the file is not a policy', () => {
    renderPage();
    fireEvent.change(openFile(), { target: { value: 'version: 2\n' } });
    expect(screen.getByTestId('sandbox-policy-error')).toHaveTextContent(
      'unsupported policy version 2',
    );
    goTo('Network access');
    expect(
      screen.getByTestId('sandbox-policy-file-broken'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('sandbox-add-host')).toBeDisabled();
    goTo('Review');
    expect(screen.getByTestId('create-sandbox-submit')).toBeDisabled();
  });

  it('removes a path with its label, and the file follows', () => {
    renderPage();
    goTo('Files');
    fireEvent.click(screen.getByRole('button', { name: 'Remove /tmp' }));
    expect(listValues('sandbox-fs-rw')).toEqual(['/sandbox', '/dev/null']);
    expect(openFile().value).not.toContain('- /tmp');
  });

  it('marks a path that is not absolute', () => {
    renderPage();
    goTo('Files');
    addToList('sandbox-fs-ro', 'opt');
    expect(screen.getByTestId('sandbox-fs-help')).toHaveTextContent(
      'Each path starts with /.',
    );
  });
});

describe('CreateSandboxPage run and resources', () => {
  it('sends none of the options when they are left alone', () => {
    renderPage();
    reviewAndCreate();
    const request = sentRequest();
    for (const option of [
      'environment',
      'annotations',
      'labels',
      'logLevel',
      'command',
      'tty',
      'runtimeClassName',
      'driverConfig',
      'serviceExposures',
      'cpu',
      'memory',
      'gpuCount',
    ] as const) {
      expect(request[option]).toBeUndefined();
    }
  });

  it('sends the command as an argv with its terminal, and the environment', () => {
    renderPage();
    goTo('Run');
    type('sandbox-command-input', 'sh\n-c\nexec sleep infinity');
    fireEvent.click(screen.getByTestId('sandbox-tty'));
    fireEvent.click(screen.getByTestId('sandbox-env-add'));
    type('sandbox-env-key-0', 'MODE');
    type('sandbox-env-value-0', 'test');
    reviewAndCreate();

    const request = sentRequest();
    expect(request.command).toEqual(['sh', '-c', 'exec sleep infinity']);
    expect(request.tty).toBe(true);
    expect(request.environment).toEqual({ MODE: 'test' });
  });

  it('marks Run and blocks the create for a value without a name', () => {
    renderPage();
    goTo('Run');
    fireEvent.click(screen.getByTestId('sandbox-env-add'));
    type('sandbox-env-value-0', 'orphan');
    expect(screen.getByTestId('sandbox-env-help')).toHaveTextContent(
      'Every value needs a name',
    );
    goTo('Review');
    expect(screen.getByText('Run has a field to correct')).toBeInTheDocument();
    expect(screen.getByTestId('create-sandbox-submit')).toBeDisabled();
  });

  it('sends resources, labels and the platform options', () => {
    renderPage();
    goTo('Resources');
    type('sandbox-cpu-input', '2');
    type('sandbox-memory-input', '4Gi');
    type('sandbox-gpu-input', '1');
    fireEvent.click(
      screen.getByText('Labels, annotations and platform options'),
    );
    fireEvent.click(screen.getByTestId('sandbox-label-add'));
    type('sandbox-label-key-0', 'team');
    type('sandbox-label-value-0', 'ml');
    type('sandbox-log-level-select', 'debug');
    type('sandbox-runtime-class-input', ' kata ');
    type(
      'sandbox-driver-config-input',
      '{"kubernetes": {"pod": {"node_selector": {"pool": "gpu"}}}}',
    );
    reviewAndCreate();

    const request = sentRequest();
    expect(request).toMatchObject({
      cpu: '2',
      memory: '4Gi',
      gpuCount: 1,
      labels: { team: 'ml' },
      logLevel: 'debug',
      runtimeClassName: 'kata',
      driverConfig: { kubernetes: { pod: { node_selector: { pool: 'gpu' } } } },
    });
  });

  it('opens the advanced options by itself around a value to correct', () => {
    renderPage();
    goTo('Resources');
    fireEvent.click(
      screen.getByText('Labels, annotations and platform options'),
    );
    type('sandbox-driver-config-input', '{not json');
    // Folding the section does not hide the field that needs correcting.
    fireEvent.click(
      screen.getByText('Labels, annotations and platform options'),
    );
    expect(screen.getByTestId('sandbox-driver-config-help')).toHaveTextContent(
      /^Invalid JSON: /,
    );
  });
});

describe('CreateSandboxPage approval mode and the create itself', () => {
  const created = { metadata: { name: 'brave-otter' } };
  const settingsPath =
    '/api/v1/workspaces/team-a/sandboxes/brave-otter/settings';

  beforeEach(() => {
    // The gateway accepts the create and answers with the sandbox, whose name
    // it generated.
    mockMutate.mockImplementation((_request, options) =>
      options.onSuccess(created),
    );
  });

  it('writes nothing for manual, the default, and goes to the sandbox', async () => {
    renderPage();
    reviewAndCreate();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('brave-otter'));
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockAddSuccess).toHaveBeenCalledWith('Sandbox created');
  });

  it('sets auto on the created sandbox once it exists', async () => {
    mockPut.mockResolvedValue({ updated: true, settingsRevision: 1 });
    renderPage();
    goTo('Run');
    type('sandbox-approval-mode', 'auto');
    reviewAndCreate();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('brave-otter'));
    expect(mockPut).toHaveBeenCalledWith(settingsPath, {
      key: 'proposal_approval_mode',
      value: 'auto',
    });
    expect(sentRequest()).not.toHaveProperty('approvalMode');
  });

  it('keeps the sandbox and says so when the setting is refused', async () => {
    mockPut.mockRejectedValue(new Error('managed globally'));
    renderPage();
    goTo('Run');
    type('sandbox-approval-mode', 'auto');
    reviewAndCreate();

    const notice = await screen.findByTestId('approval-mode-failure');
    expect(notice).toHaveTextContent(
      'Sandbox "brave-otter" was created, but its approval mode was not set',
    );
    expect(onCreated).not.toHaveBeenCalled();
    // The form is gone: submitting again would create a second sandbox.
    expect(
      screen.queryByTestId('create-sandbox-submit'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('create-sandbox-done'));
    expect(onCreated).toHaveBeenCalledWith('brave-otter');
  });

  it('cannot be left while the create is in flight', async () => {
    mockMutate.mockImplementation(() => undefined);
    const { rerender } = renderPage();
    reviewAndCreate();
    mockPending = true;
    await act(async () => rerender(page()));

    expect(screen.getByTestId('create-sandbox-submit')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('is left with Cancel when nothing is in flight', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// What the sandbox is for is a choice on Create sandbox, not a flow of its
// own: `openshell sandbox create -- opencode`, in a form.
describe('CreateSandboxPage: what runs in it', () => {
  const created = { metadata: { name: 'brave-otter' } };
  const choose = (preset: string) => type('sandbox-preset', preset);
  const pickProvider = (label: string) => {
    fireEvent.click(screen.getByTestId('sandbox-providers-input'));
    fireEvent.click(screen.getByText(label));
  };

  beforeEach(() => {
    mockMutate.mockImplementation((_request, options) =>
      options.onSuccess(created),
    );
  });

  it('is a shell unless something else is chosen, and labels nothing', async () => {
    renderPage();
    expect(screen.getByTestId('sandbox-preset')).toHaveValue('shell');
    expect(
      screen.queryByTestId('sandbox-preset-needs-provider'),
    ).not.toBeInTheDocument();
    reviewAndCreate();
    expect(sentRequest().labels).toBeUndefined();
    // No command: the main process stays the image's login shell.
    expect(sentRequest().command).toBeUndefined();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('brave-otter'));
  });

  it('labels the sandbox with what it runs, and leaves its main process alone', async () => {
    renderPage();
    choose('opencode');
    goTo('Review');
    expect(screen.getByTestId('review-runs')).toHaveTextContent('OpenCode');
    fireEvent.click(screen.getByTestId('create-sandbox-submit'));

    expect(sentRequest().labels).toEqual({ type: 'opencode' });
    expect(sentRequest().command).toBeUndefined();
    // The terminal is handed the agent once the sandbox is ready.
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith('brave-otter', ['opencode']),
    );
  });

  it('says an agent needs a provider when none is chosen', () => {
    renderPage();
    choose('opencode');
    expect(
      screen.getByTestId('sandbox-preset-needs-provider'),
    ).toHaveTextContent('OpenCode needs a model to talk to');
  });

  // The cause of "my agent is blocked from the provider I gave it": the
  // provider is reached only from the programs its profile names.
  it("warns when a chosen provider's profile does not name the agent, and offers to add it", () => {
    renderPage();
    choose('opencode');
    pickProvider('gh (github)');

    const warning = screen.getByTestId('sandbox-provider-blocks-gh');
    expect(warning).toHaveTextContent('gh does not let OpenCode through');
    expect(warning).toHaveTextContent('GitHub names /usr/bin/gh');

    fireEvent.click(screen.getByTestId('sandbox-provider-allow-gh'));
    expect(mockUpdateProfile).toHaveBeenCalledWith({
      profileId: 'github',
      expectedResourceVersion: 5,
      profile: expect.objectContaining({
        binaries: [
          { path: '/usr/bin/gh' },
          { path: '/usr/bin/opencode' },
          { path: '/usr/lib/node_modules/opencode-ai/**' },
        ],
      }),
    });
  });

  it('does not offer to change a platform profile, and says who can', () => {
    renderPage();
    choose('opencode');
    pickProvider('claude (claude-code)');
    expect(
      screen.getByTestId('sandbox-provider-blocks-claude'),
    ).toHaveTextContent(
      "A platform admin adds OpenCode's programs to the profile",
    );
    expect(
      screen.queryByTestId('sandbox-provider-allow-claude'),
    ).not.toBeInTheDocument();
  });

  it('is quiet about a provider that already lets the agent through', () => {
    renderPage();
    choose('opencode');
    pickProvider('maas (maas)');
    expect(
      screen.queryByTestId('sandbox-provider-blocks-maas'),
    ).not.toBeInTheDocument();
    choose('claude-code');
    expect(screen.getByTestId('sandbox-provider-blocks-maas')).toBeVisible();
  });

  it('points OpenCode at a model API of the team’s own once the sandbox is ready', async () => {
    renderPage();
    choose('opencode');
    pickProvider('maas (maas)');
    reviewAndCreate();

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith('brave-otter', ['opencode']),
    );
    // Asked from inside the sandbox, with the key's env var.
    const [workspace, sandbox, command] = mockRunInSandbox.mock.calls[0];
    expect([workspace, sandbox]).toEqual(['team-a', 'brave-otter']);
    expect(command[2]).toContain('Bearer $MAAS_API_KEY');
    expect(command[4]).toBe('https://maas.example.com/v1/models');
    const file = mockUpload.mock.calls[0][2] as File;
    expect(file.name).toBe('opencode.json');
    expect(mockUpload.mock.calls[0][3]).toBe('/sandbox/.config/opencode');
    expect(mockAddSuccess).toHaveBeenCalledWith('Sandbox created');
  });

  it('says which step of the setup failed, tries it again, or goes on without it', async () => {
    mockRunInSandbox.mockResolvedValueOnce({
      output: '{"error":"no"}\r\n401\r\n',
      exitCode: 0,
    });
    renderPage();
    choose('opencode');
    pickProvider('maas (maas)');
    reviewAndCreate();

    const failure = await screen.findByTestId('sandbox-setup-failure');
    expect(failure).toHaveTextContent('maas: It refused the key (HTTP 401).');
    expect(onCreated).not.toHaveBeenCalled();
    // The sandbox exists: it is not created a second time.
    fireEvent.click(screen.getByTestId('sandbox-setup-retry'));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith('brave-otter', ['opencode']),
    );
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockRunInSandbox).toHaveBeenCalledTimes(2);
  });

  it('can go to the sandbox as it is when the setup fails', async () => {
    mockRunInSandbox.mockResolvedValue({ output: '', exitCode: 7 });
    renderPage();
    choose('opencode');
    pickProvider('maas (maas)');
    reviewAndCreate();
    await screen.findByTestId('sandbox-setup-failure');
    fireEvent.click(screen.getByTestId('sandbox-setup-skip'));
    expect(onCreated).toHaveBeenCalledWith('brave-otter');
  });

  it('adds a provider by URL and key without leaving the page, and attaches it', async () => {
    renderPage();
    choose('opencode');
    fireEvent.click(screen.getByTestId('sandbox-add-own-service'));
    // It starts with the programs of what the sandbox runs, and curl.
    expect(listValues('own-service-programs')).toEqual([
      '/usr/bin/opencode',
      '/usr/lib/node_modules/opencode-ai/**',
      '/usr/bin/curl',
    ]);
    type('own-service-url', 'https://models.example.com/v1');
    expect(screen.getByTestId('own-service-name')).toHaveValue('models');
    type('own-service-key', 'test-key');
    fireEvent.click(screen.getByTestId('own-service-submit'));

    await waitFor(() =>
      expect(
        screen.getByTestId('sandbox-provider-chip-models'),
      ).toBeInTheDocument(),
    );
    expect(mockImportProfiles.mock.calls[0][1][0]).toMatchObject({
      id: 'models',
      networkEndpoints: [
        expect.objectContaining({ host: 'models.example.com', port: 443 }),
      ],
    });
    expect(mockCreateProvider).toHaveBeenCalledWith('team-a', {
      name: 'models',
      type: 'models',
      profileWorkspace: 'team-a',
      credentials: { MODELS_API_KEY: 'test-key' },
      config: { base_url: 'https://models.example.com/v1' },
    });
  });

  it('offers adding a provider to a workspace admin only', () => {
    mockRole = { isWorkspaceAdmin: false };
    renderPage();
    expect(
      screen.queryByTestId('sandbox-add-own-service'),
    ).not.toBeInTheDocument();
  });
});
