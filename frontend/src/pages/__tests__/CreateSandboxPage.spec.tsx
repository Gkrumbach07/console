import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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

jest.mock('../../api/sandboxes', () => ({
  useCreateSandbox: jest.fn(() => ({
    mutate: mockMutate,
    reset: jest.fn(),
    isPending: mockPending,
    isError: false,
    error: null,
  })),
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
    credentialKeys: [],
    configKeys: [],
  },
];

jest.mock('../../api/providers', () => ({
  useProviders: jest.fn(() => ({ data: mockProviders })),
  useProviderProfiles: jest.fn(() => ({
    data: [
      {
        id: 'claude-code',
        scope: 'platform',
        endpoints: ['api.anthropic.com:443'],
      },
    ],
  })),
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

const page = () => (
  <MemoryRouter>
    <CreateSandboxPage
      workspace="team-a"
      onCreated={onCreated}
      onCancel={onCancel}
    />
  </MemoryRouter>
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

beforeEach(() => {
  jest.clearAllMocks();
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
