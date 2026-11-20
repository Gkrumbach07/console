import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type MockRole = {
  isPlatformAdmin: boolean;
  isUser: boolean;
  isUnentitled: boolean;
  isLoading: boolean;
};

const entitledUser = (): MockRole => ({
  isPlatformAdmin: false,
  isUser: true,
  isUnentitled: false,
  isLoading: false,
});

let mockRole: MockRole = entitledUser();
jest.mock('../../api/rbac', () => ({
  useUserRole: () => mockRole,
}));

// The workspaces the signed-in user can see, which is where home leads.
let mockWorkspaces: { metadata: { name: string } }[] = [];
jest.mock('../../api/workspaces', () => ({
  useWorkspaces: () => ({ data: mockWorkspaces, isLoading: false }),
}));

// The shell and the pages are not what is under test: only which page a path
// leads to, and for whom.
jest.mock('../AppLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const mockPage = (testId: string) => ({
  __esModule: true,
  default: () => <div data-testid={testId} />,
});
// The workspace page says which workspace and which of its sections it was
// given, and where the router is.
jest.mock('../../pages/WorkspaceDetailPage', () => {
  const MockWorkspacePage = ({
    workspace,
    section,
  }: {
    workspace: string;
    section: string;
  }) => {
    const { useLocation } =
      jest.requireActual<typeof import('react-router-dom')>('react-router-dom');
    const location = useLocation();
    return (
      <div data-testid="workspace">
        {workspace}/{section} at {location.pathname}
        {location.search}
      </div>
    );
  };
  return { __esModule: true, default: MockWorkspacePage };
});
jest.mock('../../pages/AllSandboxesPage', () => mockPage('sandboxes'));
jest.mock('../../pages/AllWorkspacesPage', () => mockPage('all-workspaces'));
jest.mock('../../pages/EntitlementPage', () => mockPage('entitlement-screen'));
jest.mock('../../pages/GatewayOverviewPage', () => mockPage('gateway'));
jest.mock('../../pages/WorkspaceListPage', () => mockPage('workspace-list'));
jest.mock('../../pages/SandboxDetailPage', () => mockPage('sandbox'));
jest.mock('../../pages/ProviderDetailPage', () => mockPage('provider'));
jest.mock('../../pages/GlobalPolicyPage', () => mockPage('global-policy'));
jest.mock('../../pages/SettingsPage', () => mockPage('settings'));

import AuthenticatedRoutes from '../AuthenticatedRoutes';

const renderAt = (route: string) =>
  render(
    <MemoryRouter
      initialEntries={[route]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthenticatedRoutes />
    </MemoryRouter>,
  );

describe('AuthenticatedRoutes', () => {
  beforeEach(() => {
    mockRole = entitledUser();
    mockWorkspaces = [];
    window.localStorage.clear();
  });

  // The gateway answers the lists across workspaces for platform admins
  // only. The route does not decide that: it just does not send anyone else
  // to a page that could only show them a refusal.
  it('shows the all-workspaces page to a platform admin', () => {
    mockRole = { ...entitledUser(), isPlatformAdmin: true };
    renderAt('/all-workspaces');

    expect(screen.getByTestId('all-workspaces')).toBeInTheDocument();
  });

  // Said, not redirected: a shared link or a typed URL would otherwise land
  // on Workspaces with no word of why.
  it('tells anyone else the page needs a platform admin', () => {
    renderAt('/all-workspaces');

    expect(screen.queryByTestId('all-workspaces')).not.toBeInTheDocument();
    expect(screen.getByTestId('admin-only-page')).toHaveTextContent(
      'This page needs a platform admin',
    );
    expect(screen.getByTestId('admin-only-workspaces-link')).toHaveAttribute(
      'href',
      '/workspaces',
    );
  });

  it('shows the sandboxes page to a platform admin', () => {
    mockRole = { ...entitledUser(), isPlatformAdmin: true };
    renderAt('/sandboxes');

    expect(screen.getByTestId('sandboxes')).toBeInTheDocument();
  });

  it('keeps anyone else out of the sandboxes of every workspace', () => {
    renderAt('/sandboxes');

    expect(screen.queryByTestId('sandboxes')).not.toBeInTheDocument();
    expect(screen.getByTestId('admin-only-page')).toBeInTheDocument();
  });

  it('decides nothing while the role is still loading', () => {
    mockRole = { ...entitledUser(), isLoading: true };
    renderAt('/all-workspaces');

    expect(screen.queryByTestId('all-workspaces')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-only-page')).not.toBeInTheDocument();
  });

  // Breadcrumb puts the divider on each child after the first, and it counts
  // its children without looking inside a fragment. The workspace is in the
  // navigation's switcher, so the trail starts at the section.
  it('leads a sandbox back to the Sandboxes of its workspace', () => {
    const { container } = renderAt('/workspaces/team-a/sandboxes/sb');

    const crumbs = screen.getAllByRole('listitem');
    expect(crumbs.map((crumb) => crumb.textContent)).toEqual([
      'Sandboxes',
      'sb',
    ]);
    expect(screen.getByRole('link', { name: 'Sandboxes' })).toHaveAttribute(
      'href',
      '/workspaces/team-a/sandboxes',
    );
    expect(
      container.querySelectorAll('.pf-v6-c-breadcrumb__item-divider'),
    ).toHaveLength(1);
  });

  // Each thing of a workspace is a page of its own under it.
  it.each([
    ['sandboxes'],
    ['providers'],
    ['proposals'],
    ['templates'],
    ['services'],
    ['members'],
  ])('shows the %s of a workspace on their own route', (section) => {
    renderAt(`/workspaces/team-a/${section}`);
    expect(screen.getByTestId('workspace')).toHaveTextContent(
      `team-a/${section} at /workspaces/team-a/${section}`,
    );
  });

  // The bare workspace URL, and the ?tab= links of the one page it used to
  // be, still lead somewhere.
  it.each([
    ['/workspaces/team-a', 'team-a/sandboxes at /workspaces/team-a/sandboxes'],
    [
      '/workspaces/team-a?tab=providers',
      'team-a/providers at /workspaces/team-a/providers',
    ],
    [
      '/workspaces/team-a?tab=profiles',
      'team-a/providers at /workspaces/team-a/providers?tab=profiles',
    ],
    [
      '/workspaces/team-a?tab=members',
      'team-a/members at /workspaces/team-a/members',
    ],
  ])('sends %s to the section it means', (route, shown) => {
    renderAt(route);
    expect(screen.getByTestId('workspace')).toHaveTextContent(shown);
  });

  // Home is where the work is: the sandboxes of the workspace last worked
  // in, or of the first there is.
  it('lands in the sandboxes of the first workspace', () => {
    mockWorkspaces = [
      { metadata: { name: 'team-a' } },
      { metadata: { name: 'team-b' } },
    ];
    renderAt('/');
    expect(screen.getByTestId('workspace')).toHaveTextContent(
      'team-a/sandboxes',
    );
  });

  it('lands in the workspace last worked in, when it still exists', () => {
    mockWorkspaces = [
      { metadata: { name: 'team-a' } },
      { metadata: { name: 'team-b' } },
    ];
    window.localStorage.setItem('openshell.console.workspace', 'team-b');
    const first = renderAt('/');
    expect(screen.getByTestId('workspace')).toHaveTextContent(
      'team-b/sandboxes',
    );
    first.unmount();

    window.localStorage.setItem('openshell.console.workspace', 'gone');
    renderAt('/no-such-page');
    expect(screen.getByTestId('workspace')).toHaveTextContent(
      'team-a/sandboxes',
    );
  });

  it('lands on the list that says so when there is no workspace', () => {
    renderAt('/');
    expect(screen.getByTestId('workspace-list')).toBeInTheDocument();
  });

  // It sits beside /workspaces, not under it: a workspace named
  // "all-workspaces" would otherwise be shadowed, and the reverse.
  it('keeps the workspace routes where they were', () => {
    mockRole = { ...entitledUser(), isPlatformAdmin: true };

    const { unmount } = renderAt('/workspaces');
    expect(screen.getByTestId('workspace-list')).toBeInTheDocument();
    unmount();

    const { unmount: unmountAllWorkspaces } = renderAt(
      '/workspaces/all-workspaces',
    );
    expect(screen.getByTestId('workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('all-workspaces')).not.toBeInTheDocument();
    unmountAllWorkspaces();

    // Beside /workspaces, not under it: a workspace named "sandboxes" is
    // still that workspace, and a sandbox detail path is still a sandbox.
    const { unmount: unmountWorkspace } = renderAt('/workspaces/sandboxes');
    expect(screen.getByTestId('workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('sandboxes')).not.toBeInTheDocument();
    unmountWorkspace();

    renderAt('/workspaces/team-a/sandboxes/agent');
    expect(screen.getByTestId('sandbox')).toBeInTheDocument();
    expect(screen.queryByTestId('sandboxes')).not.toBeInTheDocument();
  });

  it('shows the entitlement screen instead of routes when unentitled', () => {
    mockRole = {
      isPlatformAdmin: false,
      isUser: false,
      isUnentitled: true,
      isLoading: false,
    };
    renderAt('/workspaces');

    expect(screen.getByTestId('entitlement-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-list')).not.toBeInTheDocument();
  });

  it('does not treat a missing whoami as unentitled', () => {
    mockRole = {
      isPlatformAdmin: false,
      isUser: false,
      isUnentitled: false,
      isLoading: false,
    };
    renderAt('/workspaces');

    expect(screen.queryByTestId('entitlement-screen')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-list')).toBeInTheDocument();
  });
});
