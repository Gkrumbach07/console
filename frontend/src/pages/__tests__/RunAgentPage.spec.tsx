import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import RunAgentPage from '../RunAgentPage';

// The page drives the real recipe and its steps; only the requests under
// them are stand-ins.

const mockImport = jest.fn();
const mockCreateProvider = jest.fn();
const mockCreateSandbox = jest.fn();
const mockGetSandbox = jest.fn();
const mockRun = jest.fn();
const mockUpload = jest.fn();
const mockInvalidate = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

jest.mock('../../api/providers', () => ({
  importProviderProfiles: (...args: unknown[]) => mockImport(...args),
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
  useProviders: jest.fn(() => ({
    data: [{ metadata: { name: 'taken' }, type: 'x' }],
  })),
  useProviderProfiles: jest.fn(() => ({ data: [] })),
}));

jest.mock('../../api/sandboxes', () => ({
  createSandbox: (...args: unknown[]) => mockCreateSandbox(...args),
  getSandbox: (...args: unknown[]) => mockGetSandbox(...args),
  uploadFile: (...args: unknown[]) => mockUpload(...args),
}));

jest.mock('../../api/sandboxRun', () => ({
  runInSandbox: (...args: unknown[]) => mockRun(...args),
}));

const onOpenSandbox = jest.fn();
const onCancel = jest.fn();

const renderPage = () =>
  render(
    <MemoryRouter>
      <RunAgentPage
        workspace="team-a"
        onOpenSandbox={onOpenSandbox}
        onCancel={onCancel}
      />
    </MemoryRouter>,
  );

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const ready = {
  metadata: { name: 'brave-otter' },
  status: { phase: 'READY', currentPolicyVersion: 1 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockImport.mockResolvedValue({ imported: true, profiles: [] });
  mockCreateProvider.mockResolvedValue({});
  mockCreateSandbox.mockResolvedValue(ready);
  mockGetSandbox.mockResolvedValue(ready);
  mockRun.mockResolvedValue({
    output: '{"data":[{"id":"granite"},{"id":"llama"}]}\r\n200\r\n',
    exitCode: 0,
  });
  mockUpload.mockResolvedValue({});
});

describe('RunAgentPage', () => {
  it('asks only for the agent, the URL, the key and a name', () => {
    renderPage();
    expect(screen.getByTestId('run-agent-agent-opencode')).toBeChecked();
    expect(screen.getByTestId('run-agent-submit')).toBeDisabled();

    type('run-agent-url', 'https://maas.apps.example.com/v1');
    // The name is suggested from the host, and can be changed.
    expect(screen.getByTestId('run-agent-name')).toHaveValue('maas');
    expect(screen.getByTestId('run-agent-summary')).toHaveTextContent(
      'let OpenCode reach maas.apps.example.com:443 with your key',
    );
    expect(screen.getByTestId('run-agent-submit')).toBeDisabled();
    type('run-agent-key', 'test-key');
    expect(screen.getByTestId('run-agent-submit')).toBeEnabled();
  });

  it('refuses a name the workspace already uses, and a URL that is not one', () => {
    renderPage();
    type('run-agent-url', 'maas.example.com');
    type('run-agent-key', 'test-key');
    expect(screen.getByText(/Not a URL/)).toBeInTheDocument();
    expect(screen.getByTestId('run-agent-submit')).toBeDisabled();

    type('run-agent-url', 'https://maas.example.com/v1');
    type('run-agent-name', 'taken');
    expect(screen.getByTestId('run-agent-name-help')).toHaveTextContent(
      'already has a provider or a profile called taken',
    );
    expect(screen.getByTestId('run-agent-submit')).toBeDisabled();
  });

  it('sets everything up and offers the terminal with the agent running', async () => {
    renderPage();
    type('run-agent-url', 'https://maas.example.com/v1');
    type('run-agent-key', 'test-key');
    fireEvent.click(screen.getByTestId('run-agent-submit'));

    const done = await screen.findByTestId('run-agent-ready');
    expect(done).toHaveTextContent('OpenCode is ready in brave-otter');
    expect(done).toHaveTextContent('It starts on granite');
    expect(mockCreateProvider).toHaveBeenCalledWith('team-a', {
      name: 'maas',
      type: 'maas',
      profileWorkspace: 'team-a',
      credentials: { MAAS_API_KEY: 'test-key' },
    });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    // What was made shows up in the lists the app holds.
    expect(mockInvalidate).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('run-agent-open-terminal'));
    expect(onOpenSandbox).toHaveBeenCalledWith('brave-otter', ['opencode']);
  });

  it('says which step failed and why, and tries again from there', async () => {
    mockRun.mockResolvedValueOnce({
      output: '{"error":"no"}\r\n401\r\n',
      exitCode: 0,
    });
    renderPage();
    type('run-agent-url', 'https://maas.example.com/v1');
    type('run-agent-key', 'test-key');
    fireEvent.click(screen.getByTestId('run-agent-submit'));

    const failure = await screen.findByTestId('run-agent-failure');
    expect(failure).toHaveTextContent(
      'Check the model endpoint from the sandbox failed',
    );
    expect(failure).toHaveTextContent(
      'The endpoint refused the key (HTTP 401).',
    );
    // What was made is kept, so there is no way back to the empty form.
    expect(screen.queryByTestId('run-agent-back')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('run-agent-retry'));
    await screen.findByTestId('run-agent-ready');
    expect(mockCreateSandbox).toHaveBeenCalledTimes(1);
    expect(mockCreateProvider).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it('goes back to the form when nothing was made yet', async () => {
    mockImport.mockResolvedValue({
      imported: false,
      profiles: [],
      diagnostics: [{ message: 'profile id is reserved' }],
    });
    renderPage();
    type('run-agent-url', 'https://maas.example.com/v1');
    type('run-agent-key', 'test-key');
    fireEvent.click(screen.getByTestId('run-agent-submit'));

    expect(await screen.findByTestId('run-agent-failure')).toHaveTextContent(
      'profile id is reserved',
    );
    fireEvent.click(screen.getByTestId('run-agent-back'));
    expect(screen.getByTestId('run-agent-url')).toHaveValue(
      'https://maas.example.com/v1',
    );
  });

  it('asks Claude Code for a key alone', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('run-agent-agent-claude-code'));
    expect(screen.queryByTestId('run-agent-url')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-agent-name')).toHaveValue('claude-code');
    type('run-agent-key', 'test-key');
    fireEvent.click(screen.getByTestId('run-agent-submit'));

    await screen.findByTestId('run-agent-ready');
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockCreateProvider).toHaveBeenCalledWith(
        'team-a',
        expect.objectContaining({
          credentials: { ANTHROPIC_API_KEY: 'test-key' },
        }),
      ),
    );
  });
});
