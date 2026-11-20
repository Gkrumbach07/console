import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import OwnServiceProviderModal from '../provider/OwnServiceProviderModal';

const mockImport = jest.fn();
const mockCreate = jest.fn();
const mockInvalidate = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

jest.mock('../../api/providers', () => ({
  importProviderProfiles: (...args: unknown[]) => mockImport(...args),
  createProvider: (...args: unknown[]) => mockCreate(...args),
  useProviders: jest.fn(() => ({
    data: [{ metadata: { name: 'taken' }, type: 'x' }],
  })),
  useProviderProfiles: jest.fn(() => ({ data: [] })),
}));

const onClose = jest.fn();
const onCreated = jest.fn();

const renderModal = (defaultPrograms?: string[]) =>
  render(
    <OwnServiceProviderModal
      workspace="team-a"
      isOpen
      onClose={onClose}
      onCreated={onCreated}
      defaultPrograms={defaultPrograms}
    />,
  );

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const programs = () =>
  Array.from(
    document.querySelectorAll('[data-testid^="own-service-programs-item-"]'),
  ).map((item) => item.textContent);

beforeEach(() => {
  jest.clearAllMocks();
  mockImport.mockResolvedValue({ imported: true, profiles: [] });
  mockCreate.mockResolvedValue({});
});

describe('OwnServiceProviderModal', () => {
  it('asks for a URL, a key and a name, and suggests the name from the host', () => {
    renderModal();
    expect(screen.getByTestId('own-service-submit')).toBeDisabled();
    type('own-service-url', 'https://maas.apps.example.com/v1');
    expect(screen.getByTestId('own-service-name')).toHaveValue('maas');
    type('own-service-key', 'test-key');
    expect(screen.getByTestId('own-service-submit')).toBeEnabled();
  });

  it('refuses a name the workspace already uses', () => {
    renderModal();
    type('own-service-url', 'https://maas.example.com/v1');
    type('own-service-key', 'test-key');
    type('own-service-name', 'taken');
    expect(screen.getByTestId('own-service-name-help')).toHaveTextContent(
      'already has a provider or a profile called taken',
    );
    expect(screen.getByTestId('own-service-submit')).toBeDisabled();
  });

  // The gateway admits a connection only from a program the profile names.
  it('starts with curl, offers each agent’s programs, and warns when none is left', () => {
    renderModal();
    expect(programs()).toEqual(['/usr/bin/curl']);
    fireEvent.click(screen.getByTestId('own-service-add-claude-code'));
    expect(programs()).toEqual([
      '/usr/bin/curl',
      '/usr/bin/claude',
      '/usr/local/bin/claude',
    ]);
    // Offered once.
    expect(
      screen.queryByTestId('own-service-add-claude-code'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('own-service-programs-clear'));
    expect(screen.getByTestId('own-service-programs-help')).toHaveTextContent(
      'nothing in a sandbox can use this provider',
    );
  });

  it('imports the profile, then creates the provider that holds the key', async () => {
    renderModal(['/usr/bin/opencode']);
    type('own-service-url', 'https://maas.example.com/v1');
    type('own-service-key', 'test-key');
    fireEvent.click(screen.getByTestId('own-service-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('maas'));
    expect(mockImport.mock.calls[0][1][0]).toMatchObject({
      id: 'maas',
      inferenceCapable: true,
      binaries: [{ path: '/usr/bin/opencode' }, { path: '/usr/bin/curl' }],
    });
    expect(mockCreate).toHaveBeenCalledWith('team-a', {
      name: 'maas',
      type: 'maas',
      profileWorkspace: 'team-a',
      credentials: { MAAS_API_KEY: 'test-key' },
      config: { base_url: 'https://maas.example.com/v1' },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('says what the gateway refused in the profile, and creates no provider', async () => {
    mockImport.mockResolvedValue({
      imported: false,
      profiles: [],
      diagnostics: [{ field: 'endpoints[0].host', message: 'not allowed' }],
    });
    renderModal();
    type('own-service-url', 'https://maas.example.com/v1');
    type('own-service-key', 'test-key');
    fireEvent.click(screen.getByTestId('own-service-submit'));

    expect(await screen.findByTestId('own-service-error')).toHaveTextContent(
      'endpoints[0].host: not allowed',
    );
    expect(mockCreate).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  // The profile of a first try stays: a second try must not import it again,
  // which the gateway would refuse as a duplicate.
  it('does not import the profile twice when only the provider failed', async () => {
    mockCreate.mockRejectedValueOnce(new Error('credential store is down'));
    renderModal();
    type('own-service-url', 'https://maas.example.com/v1');
    type('own-service-key', 'test-key');
    fireEvent.click(screen.getByTestId('own-service-submit'));
    expect(await screen.findByTestId('own-service-error')).toHaveTextContent(
      'credential store is down',
    );

    fireEvent.click(screen.getByTestId('own-service-submit'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('maas'));
    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
