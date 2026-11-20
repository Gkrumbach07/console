import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { CurrentUser } from '../../types';

let mockIsPlatformAdmin = false;
let mockIsUser = true;
let mockIsUnentitled = false;
let mockUser: CurrentUser | undefined;
let mockPendingProposals = 0;
// The same summary by sandbox, and what a standard user's own read answers.
let mockPendingItems: { workspace: string; pendingCount: number }[] = [];
let mockPendingHere = 0;

jest.mock('../../api/gateway', () => ({
  useGatewayInfo: () => ({ isLoading: false, isError: false, data: undefined }),
  useGatewayCompatibility: () => ({
    isLoading: false,
    isError: false,
    data: undefined,
  }),
}));
jest.mock('../../api/auth', () => ({
  useCurrentUser: () => ({ data: mockUser }),
  useFeatureFlags: () => ({
    globalPolicy: true,
    settings: true,
    draftPolicy: true,
    services: true,
  }),
}));
jest.mock('../../api/rbac', () => ({
  useUserRole: () => ({
    isPlatformAdmin: mockIsPlatformAdmin,
    isUser: mockIsUser,
    isUnentitled: mockIsUnentitled,
  }),
}));
jest.mock('../../api/draftSummary', () => ({
  useAllWorkspacesDraftSummary: jest.fn(() => ({
    totalPending: mockPendingProposals,
    items: mockPendingItems,
  })),
  useWorkspaceDraftSummary: jest.fn(() => ({
    totalPending: mockPendingHere,
    items: [],
  })),
}));
jest.mock('../../api/allWorkspaces', () => ({
  useAllSandboxes: jest.fn(() => ({ data: [] })),
}));
jest.mock('../../api/workspaces', () => ({
  useWorkspaces: jest.fn(() => ({ data: [] })),
}));
jest.mock('../theme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: jest.fn() }),
}));
// Jest resolves the "~/" alias before it reaches the "*.svg" stub, so the two
// logos would otherwise be parsed as JavaScript.
jest.mock('~/assets/openshell-logo.svg', () => ({
  __esModule: true,
  default: 'openshell-logo.svg',
}));
jest.mock('~/assets/openshell-logo-dark.svg', () => ({
  __esModule: true,
  default: 'openshell-logo-dark.svg',
}));

import { useAllSandboxes } from '../../api/allWorkspaces';
import {
  useAllWorkspacesDraftSummary,
  useWorkspaceDraftSummary,
} from '../../api/draftSummary';
import { NAV_COUNT_POLL_MS } from '../../constants';
import { useWorkspaces } from '../../api/workspaces';
import AppLayout from '../AppLayout';

const mockUseAllSandboxes = useAllSandboxes as jest.Mock;
const mockUseWorkspaces = useWorkspaces as jest.Mock;

const renderShell = (route: string) =>
  render(
    <MemoryRouter
      initialEntries={[route]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppLayout>
        <h1>Page</h1>
      </AppLayout>
    </MemoryRouter>,
  );

// jsdom has no width, so the page keeps its sidebar collapsed and out of the
// accessibility tree. The entries are in the document all the same.
const primaryNav = () =>
  within(
    screen.getByRole('navigation', {
      name: 'Primary navigation',
      hidden: true,
    }),
  );

const navLinks = () =>
  primaryNav()
    .getAllByRole('link', { hidden: true })
    // Without the count some entries are badged with.
    .map((link) => [
      link.textContent?.replace(/\d+$/, ''),
      link.getAttribute('href'),
    ]);

const currentNavItem = () =>
  primaryNav().getByRole('link', { current: 'page', hidden: true });

// Opens the user menu and picks an entry. The test id is on the list item and
// the click handler on the button inside it. The menu positions itself after
// it opens, so the test waits for it to settle.
const pickFromUserMenu = async (testId: string) => {
  fireEvent.click(screen.getByTestId('current-user'));
  const item = await screen.findByTestId(testId);
  fireEvent.click(within(item).getByRole('menuitem'));
  await act(async () => {});
};

describe('AppLayout navigation', () => {
  beforeEach(() => {
    mockIsPlatformAdmin = false;
    mockIsUser = true;
    mockIsUnentitled = false;
    mockUser = { subject: 'user-1', roles: [] };
    mockPendingProposals = 0;
    mockPendingItems = [];
    mockPendingHere = 0;
    window.localStorage.clear();
    mockUseAllSandboxes.mockReset();
    mockUseAllSandboxes.mockReturnValue({ data: [] });
    mockUseWorkspaces.mockReset();
    mockUseWorkspaces.mockReturnValue({ data: [] });
  });

  const workspaces = (...names: string[]) =>
    mockUseWorkspaces.mockReturnValue({
      data: names.map((name) => ({ metadata: { name } })),
    });
  const WORKSPACE_ENTRIES = (workspace: string) => [
    ['Sandboxes', `/workspaces/${workspace}/sandboxes`],
    ['Providers', `/workspaces/${workspace}/providers`],
    ['Proposals', `/workspaces/${workspace}/proposals`],
    ['Templates', `/workspaces/${workspace}/templates`],
    ['Services', `/workspaces/${workspace}/services`],
    ['Members', `/workspaces/${workspace}/members`],
  ];
  const PLATFORM_ENTRIES = [
    ['Gateway', '/gateway'],
    ['Workspaces', '/workspaces'],
    ['Provider profiles', '/provider-profiles'],
    ['Global policy', '/global-policy'],
    ['Settings', '/settings'],
  ];

  // The navigation is in one workspace, and its entries are that
  // workspace's things: each a page that lists and creates.
  it('shows the things of the workspace the URL is in', () => {
    workspaces('team-a', 'team-b');
    renderShell('/workspaces/team-b/providers');

    expect(screen.getByTestId('workspace-switcher')).toHaveTextContent(
      'team-b',
    );
    expect(navLinks()).toEqual(WORKSPACE_ENTRIES('team-b'));
    expect(currentNavItem()).toHaveTextContent(/^Providers$/);
  });

  it('adds the platform pages for a platform admin, ruled off', () => {
    mockIsPlatformAdmin = true;
    workspaces('team-a');
    renderShell('/workspaces/team-a/sandboxes');

    expect(navLinks()).toEqual([
      ...WORKSPACE_ENTRIES('team-a'),
      ...PLATFORM_ENTRIES,
    ]);
    expect(primaryNav().getAllByTestId('nav-section-rule')).toHaveLength(1);
  });

  // A rule above the only section there is would divide the sidebar from
  // nothing.
  it('leaves the nav unruled for a standard user', () => {
    workspaces('team-a');
    renderShell('/workspaces/team-a/sandboxes');
    expect(primaryNav().queryAllByTestId('nav-section-rule')).toHaveLength(0);
  });

  // A platform page belongs to no workspace. The navigation stays in the one
  // last worked in, and none of its entries is the current page.
  it('stays in the last workspace on a platform page', () => {
    mockIsPlatformAdmin = true;
    workspaces('team-a', 'team-b');
    const first = renderShell('/workspaces/team-b/sandboxes');
    first.unmount();
    renderShell('/gateway');

    expect(screen.getByTestId('workspace-switcher')).toHaveTextContent(
      'team-b',
    );
    expect(currentNavItem()).toHaveTextContent(/^Gateway$/);
  });

  it('starts in the first workspace when none was worked in', () => {
    workspaces('team-a', 'team-b');
    renderShell('/settings');
    expect(navLinks()).toEqual(WORKSPACE_ENTRIES('team-a'));
  });

  it('has no entries for someone with no workspace', () => {
    renderShell('/workspaces');
    expect(screen.queryByTestId('workspace-switcher')).not.toBeInTheDocument();
    expect(primaryNav().queryAllByRole('link', { hidden: true })).toEqual([]);
  });

  // Every workspace at once is the scope the gateway serves its
  // cross-workspace lists in, to platform admins only. Members are of one
  // workspace, so that entry goes.
  it('shows the lists across workspaces in the All workspaces scope', () => {
    mockIsPlatformAdmin = true;
    workspaces('team-a');
    renderShell('/sandboxes');

    expect(screen.getByTestId('workspace-switcher')).toHaveTextContent(
      'All workspaces',
    );
    expect(navLinks()).toEqual([
      ['Sandboxes', '/sandboxes'],
      ['Providers', '/all-workspaces'],
      ['Proposals', '/proposals'],
      ['Templates', '/all-workspaces?tab=templates'],
      ['Services', '/all-workspaces?tab=services'],
      ...PLATFORM_ENTRIES,
    ]);
    expect(mockUseAllSandboxes).toHaveBeenCalledWith(undefined, {
      enabled: true,
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  });

  it('does not put anyone else in the All workspaces scope', () => {
    workspaces('team-a');
    renderShell('/proposals');

    expect(screen.getByTestId('workspace-switcher')).toHaveTextContent(
      'team-a',
    );
    expect(navLinks()).toEqual(WORKSPACE_ENTRIES('team-a'));
    expect(mockUseAllSandboxes).toHaveBeenCalledWith(undefined, {
      enabled: false,
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  });

  // Each entry is current only on its own pages: a sandbox's page and the
  // create page are part of Sandboxes, and the Workspaces list is not
  // current on a page under a workspace.
  it.each([
    ['/workspaces/team-a/sandboxes/agent', 'Sandboxes'],
    ['/workspaces/team-a/create-sandbox', 'Sandboxes'],
    ['/workspaces/team-a/providers/claude', 'Providers'],
    ['/workspaces/team-a/proposals', 'Proposals'],
    ['/workspaces', 'Workspaces'],
    ['/sandboxes', 'Sandboxes'],
    ['/all-workspaces', 'Providers'],
    ['/all-workspaces?tab=services', 'Services'],
    ['/provider-profiles', 'Provider profiles'],
  ])('marks the right entry as current on %s', (route, entry) => {
    mockIsPlatformAdmin = true;
    workspaces('team-a');
    renderShell(route);

    expect(currentNavItem()).toHaveTextContent(new RegExp(`^${entry}\\d*$`));
  });

  // Changing the workspace keeps the place.
  it('switches workspace and stays on the same section', async () => {
    mockIsPlatformAdmin = true;
    workspaces('team-a', 'team-b');
    renderShell('/workspaces/team-a/providers');

    fireEvent.click(screen.getByTestId('workspace-switcher'));
    fireEvent.click(
      within(await screen.findByTestId('workspace-option-team-b')).getByRole(
        'option',
      ),
    );
    expect(screen.getByTestId('workspace-switcher')).toHaveTextContent(
      'team-b',
    );
    expect(currentNavItem()).toHaveAttribute(
      'href',
      '/workspaces/team-b/providers',
    );

    fireEvent.click(screen.getByTestId('workspace-switcher'));
    fireEvent.click(
      within(await screen.findByTestId('workspace-option-all')).getByRole(
        'option',
      ),
    );
    expect(currentNavItem()).toHaveAttribute('href', '/all-workspaces');
  });

  it('offers All workspaces to a platform admin only', async () => {
    workspaces('team-a');
    renderShell('/workspaces/team-a/sandboxes');
    fireEvent.click(screen.getByTestId('workspace-switcher'));
    await screen.findByTestId('workspace-option-team-a');
    expect(
      screen.queryByTestId('workspace-option-all'),
    ).not.toBeInTheDocument();
  });

  // The badge is the whole point of the entry: how many requests are waiting
  // for a decision, without opening the page. In a workspace it counts that
  // workspace's.
  it('counts what is waiting in the workspace, from the summary an admin already reads', () => {
    mockIsPlatformAdmin = true;
    mockPendingProposals = 5;
    mockPendingItems = [
      { workspace: 'team-a', pendingCount: 2 },
      { workspace: 'team-b', pendingCount: 3 },
    ];
    workspaces('team-a', 'team-b');
    renderShell('/workspaces/team-a/sandboxes');

    expect(screen.getByTestId('proposals-badge')).toHaveTextContent('2');
    // No second read for it.
    expect(useWorkspaceDraftSummary).toHaveBeenCalledWith('team-a', false);
  });

  it('counts every workspace in the All workspaces scope', () => {
    mockIsPlatformAdmin = true;
    mockPendingProposals = 5;
    workspaces('team-a');
    renderShell('/proposals');
    expect(screen.getByTestId('proposals-badge')).toHaveTextContent('5');
  });

  // A standard user's count is one request, for the workspace they are in.
  it('counts what is waiting for a standard user with one read of their workspace', () => {
    mockPendingHere = 4;
    workspaces('team-a');
    renderShell('/workspaces/team-a/sandboxes');

    expect(screen.getByTestId('proposals-badge')).toHaveTextContent('4');
    expect(useWorkspaceDraftSummary).toHaveBeenCalledWith('team-a', true);
    expect(useAllWorkspacesDraftSummary).toHaveBeenCalledWith(false, {
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  });

  it('badges nothing when nothing is waiting', () => {
    workspaces('team-a');
    renderShell('/workspaces/team-a/sandboxes');
    expect(screen.queryByTestId('proposals-badge')).not.toBeInTheDocument();
  });

  // The count costs the gateway one draft read per sandbox, so the shell
  // reads it at the navigation's pace, not the Proposals page's.
  it('reads the proposal count at the navigation pace', () => {
    mockIsPlatformAdmin = true;
    renderShell('/workspaces');

    expect(useAllWorkspacesDraftSummary).toHaveBeenCalledWith(true, {
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  });

  it("counts the sandboxes of every workspace on that scope's entry", () => {
    mockIsPlatformAdmin = true;
    mockUseAllSandboxes.mockReturnValue({ data: [{}, {}, {}] });
    workspaces('team-a');
    renderShell('/sandboxes');
    expect(screen.getByTestId('sandboxes-badge')).toHaveTextContent('3');
  });

  it('counts the workspaces on the platform entry', () => {
    mockIsPlatformAdmin = true;
    workspaces('team-a', 'team-b');
    renderShell('/workspaces');
    expect(screen.getByTestId('workspaces-badge')).toHaveTextContent('2');
  });

  // The shell reads it on every page, so at the navigation's pace, and not
  // at all for a user the gateway gives no role.
  it('reads the workspaces at the navigation pace', () => {
    renderShell('/workspaces');

    expect(mockUseWorkspaces).toHaveBeenCalledWith(undefined, {
      enabled: true,
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  });

  it('does not ask for the workspaces of a user with no role', () => {
    mockIsUser = false;
    mockIsUnentitled = true;
    renderShell('/workspaces');

    expect(mockUseWorkspaces).toHaveBeenCalledWith(undefined, {
      enabled: false,
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  });
});

// Unentitled users keep the masthead (theme, identity, sign-out) but must not
// see side nav, the nav toggle, or the gateway health chip.
describe('AppLayout entitlement chrome', () => {
  beforeEach(() => {
    mockIsPlatformAdmin = false;
    mockIsUser = false;
    mockIsUnentitled = true;
    mockUser = { subject: 'user-1', roles: [] };
  });

  it('hides side nav, nav toggle, and gateway health when unentitled', () => {
    renderShell('/workspaces');

    expect(
      screen.queryByRole('navigation', {
        name: 'Primary navigation',
        hidden: true,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Global navigation' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('gateway-status-region'),
    ).not.toBeInTheDocument();

    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('current-user')).toBeInTheDocument();
  });
});

// What `openshell whoami` prints, for the session the dashboard is using.
describe('AppLayout identity', () => {
  beforeEach(() => {
    mockIsPlatformAdmin = false;
    mockIsUser = true;
    mockIsUnentitled = false;
    mockUseAllSandboxes.mockReturnValue({ data: [] });
    mockUser = {
      subject: 'f3b1c2d4',
      displayName: 'Ada Lovelace',
      identityProvider: 'oidc',
      roles: ['openshell-user'],
      scopes: ['openid', 'sandbox:read'],
    };
  });

  it('shows the signed-in identity from the user menu', async () => {
    renderShell('/workspaces');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await pickFromUserMenu('view-identity');

    const dialog = within(
      screen.getByRole('dialog', { name: 'Signed-in identity' }),
    );
    expect(dialog.getByTestId('identity-subject')).toHaveTextContent(
      'f3b1c2d4',
    );
    expect(dialog.getByTestId('identity-name')).toHaveTextContent(
      'Ada Lovelace',
    );
    expect(dialog.getByTestId('identity-provider')).toHaveTextContent('oidc');
    expect(dialog.getByTestId('identity-roles')).toHaveTextContent(
      'openshell-user',
    );
    expect(dialog.getByTestId('identity-scopes')).toHaveTextContent('openid');
    expect(dialog.getByTestId('identity-scopes')).toHaveTextContent(
      'sandbox:read',
    );
  });

  it('closes the identity again', async () => {
    renderShell('/workspaces');
    await pickFromUserMenu('view-identity');

    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers the identity even before the gateway has answered', async () => {
    mockUser = undefined;
    renderShell('/workspaces');

    await pickFromUserMenu('view-identity');

    expect(screen.getByTestId('identity-subject')).toHaveTextContent('None');
  });
});
