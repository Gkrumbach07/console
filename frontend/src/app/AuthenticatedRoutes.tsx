import {
  Breadcrumb,
  BreadcrumbItem,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  PageBreadcrumb,
  PageSection,
} from '@patternfly/react-core';
import { LockIcon } from '@patternfly/react-icons';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import AllSandboxesPage from '../pages/AllSandboxesPage';
import AllWorkspacesPage from '../pages/AllWorkspacesPage';
import EntitlementPage from '../pages/EntitlementPage';
import GatewayOverviewPage from '../pages/GatewayOverviewPage';
import WorkspaceListPage from '../pages/WorkspaceListPage';
import WorkspaceDetailPage from '../pages/WorkspaceDetailPage';
import SandboxDetailPage from '../pages/SandboxDetailPage';
import ProviderDetailPage from '../pages/ProviderDetailPage';
import ProviderProfilesPage from '../pages/ProviderProfilesPage';
import GlobalPolicyPage from '../pages/GlobalPolicyPage';
import CreateSandboxPage from '../pages/CreateSandboxPage';
import ProposalsPage from '../pages/ProposalsPage';
import SettingsPage from '../pages/SettingsPage';
import { useUserRole } from '../api/rbac';
import { useWorkspaces } from '../api/workspaces';
import { useI18n } from '../i18n';
import AppLayout from './AppLayout';
import {
  NAV_SECTIONS,
  defaultWorkspace,
  recallWorkspace,
  sectionOfLegacyTab,
  sectionPath,
  type NavSection,
} from './workspaceScope';

const WorkspaceListRoute: React.FC = () => {
  const navigate = useNavigate();
  return (
    <WorkspaceListPage onSelect={(name) => navigate(`/workspaces/${name}`)} />
  );
};

// Where a page under one of a workspace's sections is: "Sandboxes > name".
// The workspace itself is in the navigation's switcher, so it is not
// repeated here.
const SectionCrumbs: React.FC<{
  workspace: string;
  section: NavSection;
  leaf: string;
}> = ({ workspace, section, leaf }) => {
  const { t } = useI18n('common');
  // Flat children, never a fragment: Breadcrumb puts the divider on each
  // child after the first with Children.map, which does not look inside a
  // fragment.
  return (
    <PageBreadcrumb>
      <Breadcrumb>
        <BreadcrumbItem
          render={({ className }) => (
            <Link
              className={className}
              to={sectionPath({ workspace }, section)}
            >
              {t(`nav.${section}`)}
            </Link>
          )}
        />
        <BreadcrumbItem isActive>{leaf}</BreadcrumbItem>
      </Breadcrumb>
    </PageBreadcrumb>
  );
};

// The bare workspace URL, and the `?tab=` links of the one-page workspace
// view it used to be, lead to the section's own page.
const WorkspaceHomeRedirect: React.FC = () => {
  const { workspace } = useParams<{ workspace: string }>();
  const [searchParams] = useSearchParams();
  if (!workspace) {
    return <Navigate to="/workspaces" replace />;
  }
  const { section, search } = sectionOfLegacyTab(searchParams.get('tab'));
  return (
    <Navigate to={`${sectionPath({ workspace }, section)}${search}`} replace />
  );
};

// Where signing in lands: the sandboxes of the workspace last worked in, or
// of the first there is. With no workspace at all, the list that says so.
const HomeRedirect: React.FC = () => {
  const { isUnentitled, isLoading: isRoleLoading } = useUserRole();
  const workspaces = useWorkspaces(undefined, {
    enabled: !isRoleLoading && !isUnentitled,
  });
  if (workspaces.isLoading || isRoleLoading) {
    return null;
  }
  const workspace = defaultWorkspace(
    (workspaces.data ?? []).map((w) => w.metadata.name),
    recallWorkspace(),
  );
  return (
    <Navigate
      to={workspace ? sectionPath({ workspace }, 'sandboxes') : '/workspaces'}
      replace
    />
  );
};

const WorkspaceSectionRoute: React.FC<{ section: NavSection }> = ({
  section,
}) => {
  const { workspace } = useParams<{ workspace: string }>();
  const navigate = useNavigate();
  if (!workspace) {
    return <Navigate to="/workspaces" replace />;
  }
  return (
    <WorkspaceDetailPage
      // A page per workspace and section: what one holds (a filter, an open
      // dialog) is not carried into another.
      key={`${workspace}/${section}`}
      workspace={workspace}
      section={section}
      onSelectSandbox={(name) =>
        navigate(`/workspaces/${workspace}/sandboxes/${name}`)
      }
      onSelectProvider={(name) =>
        navigate(`/workspaces/${workspace}/providers/${name}`)
      }
    />
  );
};

const SandboxDetailRoute: React.FC = () => {
  const { workspace, sandbox } = useParams<{
    workspace: string;
    sandbox: string;
  }>();
  if (!workspace || !sandbox) {
    return <Navigate to="/workspaces" replace />;
  }
  return (
    <>
      <SectionCrumbs workspace={workspace} section="sandboxes" leaf={sandbox} />
      <SandboxDetailPage workspace={workspace} sandboxName={sandbox} />
    </>
  );
};

const CreateSandboxRoute: React.FC = () => {
  const { workspace } = useParams<{ workspace: string }>();
  const navigate = useNavigate();
  if (!workspace) {
    return <Navigate to="/workspaces" replace />;
  }
  return (
    <>
      <SectionCrumbs
        workspace={workspace}
        section="sandboxes"
        leaf="Create sandbox"
      />
      <CreateSandboxPage
        workspace={workspace}
        // What the sandbox was made to run travels in the navigation state,
        // which a link from outside the app cannot set: opening a URL never
        // runs a command.
        onCreated={(name, terminalCommand) =>
          navigate(
            `/workspaces/${workspace}/sandboxes/${name}${terminalCommand ? '?tab=terminal' : ''}`,
            terminalCommand ? { state: { terminalCommand } } : undefined,
          )
        }
        onCancel={() => navigate(sectionPath({ workspace }, 'sandboxes'))}
      />
    </>
  );
};

const ProviderDetailRoute: React.FC = () => {
  const { workspace, provider } = useParams<{
    workspace: string;
    provider: string;
  }>();
  if (!workspace || !provider) {
    return <Navigate to="/workspaces" replace />;
  }
  return (
    <>
      <SectionCrumbs
        workspace={workspace}
        section="providers"
        leaf={provider}
      />
      <ProviderDetailPage workspace={workspace} providerName={provider} />
    </>
  );
};

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isPlatformAdmin, isLoading } = useUserRole();
  if (isLoading) {
    return null;
  }
  // Said, not redirected: a link someone shared, or a page a standard user
  // typed, otherwise lands on Workspaces with no word of why.
  if (!isPlatformAdmin) {
    return (
      <PageSection>
        <EmptyState
          variant="lg"
          titleText="This page needs a platform admin"
          icon={LockIcon}
          data-testid="admin-only-page"
        >
          <EmptyStateBody>
            Gateway-wide pages are for platform admins. You can work with the
            sandboxes, providers and members of the workspaces you belong to.
          </EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Link to="/workspaces" data-testid="admin-only-workspaces-link">
                Go to workspaces
              </Link>
            </EmptyStateActions>
          </EmptyStateFooter>
        </EmptyState>
      </PageSection>
    );
  }
  return <>{children}</>;
};

const AuthenticatedRoutes: React.FC<{ sessionAlert?: React.ReactNode }> = ({
  sessionAlert,
}) => {
  const { isUnentitled, isLoading } = useUserRole();

  if (isLoading) {
    return null;
  }

  const content = isUnentitled ? (
    <EntitlementPage />
  ) : (
    <Routes>
      <Route
        path="/gateway"
        element={
          <AdminRoute>
            <GatewayOverviewPage />
          </AdminRoute>
        }
      />
      <Route
        path="/global-policy"
        element={
          <AdminRoute>
            <GlobalPolicyPage />
          </AdminRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <AdminRoute>
            <SettingsPage />
          </AdminRoute>
        }
      />
      <Route
        path="/sandboxes"
        element={
          <AdminRoute>
            <AllSandboxesPage />
          </AdminRoute>
        }
      />
      <Route
        path="/all-workspaces"
        element={
          <AdminRoute>
            <AllWorkspacesPage />
          </AdminRoute>
        }
      />
      <Route
        path="/provider-profiles"
        element={
          <AdminRoute>
            <ProviderProfilesPage />
          </AdminRoute>
        }
      />
      {/* Not behind AdminRoute: proposals are a sandbox's, and a standard
          user reviews the ones in the workspaces they are a member of. Only
          the cross-workspace rollup needs a platform admin, and the page
          falls back to a request per workspace without one. */}
      <Route path="/proposals" element={<ProposalsPage />} />
      <Route path="/workspaces" element={<WorkspaceListRoute />} />
      <Route
        path="/workspaces/:workspace"
        element={<WorkspaceHomeRedirect />}
      />
      {NAV_SECTIONS.map((section) => (
        <Route
          key={section}
          path={`/workspaces/:workspace/${section}`}
          element={<WorkspaceSectionRoute section={section} />}
        />
      ))}
      <Route
        path="/workspaces/:workspace/sandboxes/:sandbox"
        element={<SandboxDetailRoute />}
      />
      {/* Not under sandboxes/: a sandbox may be named anything a DNS label
          allows, "new" included. */}
      <Route
        path="/workspaces/:workspace/create-sandbox"
        element={<CreateSandboxRoute />}
      />
      <Route
        path="/workspaces/:workspace/providers/:provider"
        element={<ProviderDetailRoute />}
      />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );

  return <AppLayout sessionAlert={sessionAlert}>{content}</AppLayout>;
};

export default AuthenticatedRoutes;
