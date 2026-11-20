import { useEffect, useState } from 'react';
import { BUILD_COMMIT, NAV_COUNT_POLL_MS } from '../constants';
import {
  AboutModal,
  Badge,
  Button,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownList,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  MastheadToggle,
  MenuToggle,
  Nav,
  NavItem,
  NavItemSeparator,
  NavList,
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  PageToggleButton,
  Select,
  SelectList,
  SelectOption,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  BarsIcon,
  MoonIcon,
  QuestionCircleIcon,
  SunIcon,
} from '@patternfly/react-icons';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import openshellLogo from '~/assets/openshell-logo.svg';
import openshellLogoDark from '~/assets/openshell-logo-dark.svg';
import { useAllSandboxes } from '../api/allWorkspaces';
import { useGatewayCompatibility } from '../api/gateway';
import { useCurrentUser, useFeatureFlags } from '../api/auth';
import {
  useAllWorkspacesDraftSummary,
  useWorkspaceDraftSummary,
} from '../api/draftSummary';
import { useUserRole } from '../api/rbac';
import { useWorkspaces } from '../api/workspaces';
import CurrentUserModal from '../components/CurrentUserModal';
import GatewayCompatibilityAlert from '../components/GatewayCompatibilityAlert';
import GatewayStatusIndicator from '../components/GatewayStatusIndicator';
import RoleBadge from '../components/RoleBadge';
import { useI18n } from '../i18n';
import { logout } from './logout';
import { useTheme } from './theme';
import {
  defaultWorkspace,
  recallWorkspace,
  rememberWorkspace,
  scopeOfLocation,
  sectionPath,
  type NavSection,
} from './workspaceScope';

type AppLayoutProps = {
  children: React.ReactNode;
  sessionAlert?: React.ReactNode;
};

// One entry of the sidebar.
type NavEntry = {
  id: string;
  label: string;
  to: string;
  isActive: boolean;
  badge?: { count: number; testId: string };
};

// The things of a workspace, in the order they are used. Proposals and
// Services are features a deployment can turn off.
const SECTION_ENTRIES: {
  section: NavSection;
  labelKey:
    | 'nav.sandboxes'
    | 'nav.providers'
    | 'nav.proposals'
    | 'nav.templates'
    | 'nav.services'
    | 'nav.members';
  featureKey?: keyof import('../types').FeatureFlags;
}[] = [
  { section: 'sandboxes', labelKey: 'nav.sandboxes' },
  { section: 'providers', labelKey: 'nav.providers' },
  {
    section: 'proposals',
    labelKey: 'nav.proposals',
    featureKey: 'draftPolicy',
  },
  { section: 'templates', labelKey: 'nav.templates' },
  { section: 'services', labelKey: 'nav.services', featureKey: 'services' },
  { section: 'members', labelKey: 'nav.members' },
];

// The platform's own pages, for platform admins: they belong to no
// workspace.
const PLATFORM_ENTRIES: {
  path: string;
  labelKey:
    | 'nav.gateway'
    | 'nav.workspaces'
    | 'nav.providerProfiles'
    | 'nav.globalPolicy'
    | 'nav.settings';
  featureKey?: keyof import('../types').FeatureFlags;
}[] = [
  { path: '/gateway', labelKey: 'nav.gateway' },
  { path: '/workspaces', labelKey: 'nav.workspaces' },
  { path: '/provider-profiles', labelKey: 'nav.providerProfiles' },
  {
    path: '/global-policy',
    labelKey: 'nav.globalPolicy',
    featureKey: 'globalPolicy',
  },
  { path: '/settings', labelKey: 'nav.settings', featureKey: 'settings' },
];

// The switcher's value for every workspace at once.
const ALL_WORKSPACES = '\u0000all';

const AppLayout: React.FC<AppLayoutProps> = ({ children, sessionAlert }) => {
  const { t } = useI18n('common');
  const location = useLocation();
  const navigate = useNavigate();
  const user = useCurrentUser({ notifySessionExpired: false });
  const [isSwitcherOpen, setSwitcherOpen] = useState(false);
  const {
    isPlatformAdmin,
    isUser,
    isUnentitled,
    isLoading: isRoleLoading,
  } = useUserRole();
  const features = useFeatureFlags();
  // The release line this build is for comes from the BFF, which has it
  // compiled in, so it is known in every image whatever built it. Read from
  // the route every signed-in user may call; the notice and the masthead keep
  // the same query fresh. Gateway info is not read here: a gateway with roles
  // refuses it to anyone who is not a platform admin, and the shell is
  // mounted for everyone.
  const compatibility = useGatewayCompatibility().data;
  const builtForLine = compatibility?.compatibility?.supportedLine;
  const [isAboutOpen, setAboutOpen] = useState(false);
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [isUserOpen, setUserOpen] = useState(false);
  const [isIdentityOpen, setIdentityOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const logoSrc = theme === 'dark' ? openshellLogoDark : openshellLogo;

  // How many rules are waiting for a decision, on the Proposals entry. Read
  // for a platform admin only, and not because proposals are theirs: this is
  // the shell, mounted on every page, and the cross-workspace summary is the
  // one shape of this read that is a single request to the BFF. Reading it
  // the way a standard user has to — one request per workspace they are in —
  // would put that behind every page they open. The page itself does that
  // read, once, where someone is looking at it. The same query the Proposals
  // page and the Gateway page use, so an admin on either is not polling it
  // twice. The BFF answers it with one draft read per sandbox on the gateway,
  // so the shell's own pace is NAV_COUNT_POLL_MS, not the pages'.
  const { totalPending: pendingProposals, items: pendingBySandbox } =
    useAllWorkspacesDraftSummary(features.draftPolicy && isPlatformAdmin, {
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  // How many sandboxes the gateway has, on the Sandboxes entry. The unfiltered
  // all-workspaces list — the same query the Sandboxes page reads when no
  // label selector is set — so an admin looking at that list is not polling
  // it twice. A platform admin only: the gateway refuses the list to anyone
  // else, and the shell is mounted on every page.
  const { data: allSandboxes } = useAllSandboxes(undefined, {
    enabled: isPlatformAdmin,
    refetchInterval: NAV_COUNT_POLL_MS,
  });
  const sandboxCount = allSandboxes?.length ?? 0;
  // How many workspaces the signed-in user can see, on the Workspaces entry.
  // The same unfiltered list the Workspaces page reads, so looking at that
  // list is not a second poll. Unlike the sandboxes count this is for every
  // user with a role: the gateway answers each with the workspaces they are
  // in. A user with no role is shown the entitlement page and no navigation,
  // so nothing is asked for them.
  const { data: workspaces } = useWorkspaces(undefined, {
    enabled: !isRoleLoading && !isUnentitled,
    refetchInterval: NAV_COUNT_POLL_MS,
  });
  const workspaceCount = workspaces?.length ?? 0;

  // The workspace the navigation is in: the one the URL names, else, on a
  // page that belongs to none, the one last worked in. Every workspace at
  // once is a scope of its own, for platform admins.
  const here = scopeOfLocation(location.pathname, location.search);
  const workspaceNames = (workspaces ?? []).map((w) => w.metadata.name);
  const isAllScope = here.isAll && isPlatformAdmin;
  const currentWorkspace = isAllScope
    ? undefined
    : (here.workspace ?? defaultWorkspace(workspaceNames, recallWorkspace()));
  useEffect(() => {
    if (here.workspace) rememberWorkspace(here.workspace);
  }, [here.workspace]);
  // What is waiting in the current workspace. A platform admin's count comes
  // from the summary the shell already reads; anyone else's is one request,
  // for the one workspace they are in.
  const ownSummary = useWorkspaceDraftSummary(
    currentWorkspace ?? '',
    features.draftPolicy && !isPlatformAdmin && !!currentWorkspace,
  );
  const pendingHere = isPlatformAdmin
    ? pendingBySandbox
        .filter((entry) => entry.workspace === currentWorkspace)
        .reduce((sum, entry) => sum + entry.pendingCount, 0)
    : ownSummary.totalPending;

  const masthead = (
    <Masthead
      display={{ default: 'inline' }}
      className="pf-v6-u-align-items-center"
    >
      <MastheadMain>
        {!isUnentitled && (
          <MastheadToggle>
            <PageToggleButton variant="plain" aria-label={t('nav.global')}>
              <BarsIcon />
            </PageToggleButton>
          </MastheadToggle>
        )}
        <MastheadBrand>
          <MastheadLogo
            component={(props) => (
              <Link
                {...props}
                // Home: the sandboxes of the workspace last worked in.
                to="/"
                className="pf-v6-u-text-decoration-none"
              />
            )}
          >
            <img
              src={logoSrc}
              alt={t('about.brandAlt')}
              style={{ height: 'var(--pf-t--global--spacer--2xl)' }}
            />
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar isFullHeight isStatic aria-label={t('header.actions')}>
          <ToolbarContent>
            {!isUnentitled && (
              <ToolbarItem align={{ default: 'alignEnd' }} alignSelf="center">
                <GatewayStatusIndicator />
              </ToolbarItem>
            )}
            <ToolbarItem
              align={isUnentitled ? { default: 'alignEnd' } : undefined}
            >
              <Button
                variant="plain"
                onClick={toggleTheme}
                aria-label={
                  theme === 'dark'
                    ? t('header.themeToLight')
                    : t('header.themeToDark')
                }
                data-testid="theme-toggle"
              >
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </Button>
            </ToolbarItem>
            <ToolbarItem>
              <Dropdown
                isOpen={isHelpOpen}
                onSelect={() => setHelpOpen(false)}
                onOpenChange={setHelpOpen}
                toggle={(toggleRef) => (
                  <MenuToggle
                    ref={toggleRef}
                    variant="plain"
                    onClick={() => setHelpOpen(!isHelpOpen)}
                    isExpanded={isHelpOpen}
                    aria-label={t('header.help')}
                    data-testid="help-menu"
                  >
                    <QuestionCircleIcon />
                  </MenuToggle>
                )}
                popperProps={{ position: 'end' }}
              >
                <DropdownList>
                  <DropdownItem
                    key="about"
                    onClick={() => setAboutOpen(true)}
                    data-testid="about-menu-item"
                  >
                    {t('header.about')}
                  </DropdownItem>
                </DropdownList>
              </Dropdown>
            </ToolbarItem>
            {!isRoleLoading && (isPlatformAdmin || isUser) && (
              <ToolbarItem alignSelf="center">
                <RoleBadge
                  isPlatformAdmin={isPlatformAdmin}
                  isUser={isUser}
                  isLoading={isRoleLoading}
                />
              </ToolbarItem>
            )}
            <ToolbarItem>
              <Dropdown
                isOpen={isUserOpen}
                onSelect={() => setUserOpen(false)}
                onOpenChange={setUserOpen}
                toggle={(toggleRef) => (
                  <MenuToggle
                    ref={toggleRef}
                    // Without a variant PatternFly gives this a bordered
                    // button, beside a status indicator and a theme toggle
                    // that are both plain. plainText keeps the caret and
                    // drops the border.
                    variant="plainText"
                    onClick={() => setUserOpen(!isUserOpen)}
                    isExpanded={isUserOpen}
                    data-testid="current-user"
                  >
                    {user.data?.displayName ||
                      user.data?.subject ||
                      t('header.userFallback')}
                  </MenuToggle>
                )}
                popperProps={{ position: 'end' }}
              >
                <DropdownList>
                  {user.data?.subject && (
                    <DropdownItem
                      key="copy-subject"
                      onClick={() => {
                        navigator.clipboard.writeText(user.data!.subject);
                      }}
                      data-testid="copy-subject"
                    >
                      {t('header.copySubject')}
                    </DropdownItem>
                  )}
                  <DropdownItem
                    key="identity"
                    onClick={() => setIdentityOpen(true)}
                    data-testid="view-identity"
                  >
                    {t('header.identity')}
                  </DropdownItem>
                  <Divider key="divider" />
                  <DropdownItem
                    key="logout"
                    onClick={() => logout()}
                    data-testid="logout"
                  >
                    {t('header.logOut')}
                  </DropdownItem>
                </DropdownList>
              </Dropdown>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );

  const scope = isAllScope
    ? ('all' as const)
    : currentWorkspace
      ? { workspace: currentWorkspace }
      : undefined;
  // An entry is the current one only while the URL is in the scope the
  // navigation shows: on a platform page none of the workspace's entries is.
  const inScope = isAllScope || !!here.workspace;
  const sectionEntries: NavEntry[] = scope
    ? SECTION_ENTRIES.filter(
        (entry) =>
          (!entry.featureKey || features[entry.featureKey]) &&
          // Members are of one workspace.
          !(scope === 'all' && entry.section === 'members'),
      ).map((entry) => ({
        id: `section-${entry.section}`,
        label: t(entry.labelKey),
        to: sectionPath(scope, entry.section),
        isActive: inScope && here.section === entry.section,
        badge:
          entry.section === 'proposals'
            ? {
                count: scope === 'all' ? pendingProposals : pendingHere,
                testId: 'proposals-badge',
              }
            : entry.section === 'sandboxes' && scope === 'all'
              ? { count: sandboxCount, testId: 'sandboxes-badge' }
              : undefined,
      }))
    : [];
  const platformEntries: NavEntry[] = isPlatformAdmin
    ? PLATFORM_ENTRIES.filter(
        (entry) => !entry.featureKey || features[entry.featureKey],
      ).map((entry) => ({
        id: `platform-${entry.path}`,
        label: t(entry.labelKey),
        to: entry.path,
        // The Workspaces list is /workspaces alone: a workspace's own pages
        // are under it, and are not it.
        isActive:
          entry.path === '/workspaces'
            ? location.pathname === '/workspaces'
            : location.pathname.startsWith(entry.path),
        badge:
          entry.path === '/workspaces'
            ? { count: workspaceCount, testId: 'workspaces-badge' }
            : undefined,
      }))
    : [];

  const navItem = (entry: NavEntry) => (
    <NavItem
      key={entry.id}
      itemId={entry.id}
      to={entry.to}
      isActive={entry.isActive}
      component={(props) => <Link {...props} to={entry.to} />}
      data-testid={`nav-${entry.id}`}
    >
      {entry.label}
      {entry.badge && entry.badge.count > 0 && (
        <Badge
          isRead
          className="pf-v6-u-ml-sm"
          data-testid={entry.badge.testId}
        >
          {entry.badge.count}
        </Badge>
      )}
    </NavItem>
  );

  // Changing the workspace keeps the place: Providers of one becomes
  // Providers of the other.
  const switchTo = (value: string) => {
    setSwitcherOpen(false);
    const section = (inScope && here.section) || 'sandboxes';
    navigate(
      sectionPath(
        value === ALL_WORKSPACES ? 'all' : { workspace: value },
        section,
      ),
    );
  };

  const switcher = (workspaceNames.length > 0 || isPlatformAdmin) && (
    <PageSidebarBody isFilled={false}>
      <Content
        component="small"
        id="workspace-switcher-label"
        className="pf-v6-u-display-block pf-v6-u-mb-xs"
      >
        {t('nav.workspace')}
      </Content>
      <Select
        isOpen={isSwitcherOpen}
        selected={isAllScope ? ALL_WORKSPACES : currentWorkspace}
        onSelect={(_event, value) => switchTo(String(value))}
        onOpenChange={setSwitcherOpen}
        aria-labelledby="workspace-switcher-label"
        isScrollable
        toggle={(ref) => (
          <MenuToggle
            ref={ref}
            isFullWidth
            isExpanded={isSwitcherOpen}
            onClick={() => setSwitcherOpen((open) => !open)}
            aria-labelledby="workspace-switcher-label"
            data-testid="workspace-switcher"
          >
            {isAllScope
              ? t('nav.allWorkspacesScope')
              : (currentWorkspace ?? t('nav.noWorkspace'))}
          </MenuToggle>
        )}
      >
        <SelectList>
          {isPlatformAdmin && (
            <SelectOption
              value={ALL_WORKSPACES}
              description={t('nav.allWorkspacesScopeDetail')}
              data-testid="workspace-option-all"
            >
              {t('nav.allWorkspacesScope')}
            </SelectOption>
          )}
          {isPlatformAdmin && workspaceNames.length > 0 && (
            <Divider component="li" />
          )}
          {workspaceNames.map((name) => (
            <SelectOption
              key={name}
              value={name}
              data-testid={`workspace-option-${name}`}
            >
              {name}
            </SelectOption>
          ))}
        </SelectList>
      </Select>
    </PageSidebarBody>
  );

  const sidebar = (
    <PageSidebar>
      {switcher}
      <PageSidebarBody>
        <Nav aria-label={t('nav.primary')}>
          <NavList>
            {sectionEntries.map(navItem)}
            {/* A rule between the workspace's things and the platform's, so
                that the second set reads as starting there. */}
            {sectionEntries.length > 0 && platformEntries.length > 0 && (
              <NavItemSeparator data-testid="nav-section-rule" />
            )}
            {platformEntries.map(navItem)}
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <Page
      masthead={masthead}
      sidebar={isUnentitled ? undefined : sidebar}
      isManagedSidebar={!isUnentitled}
    >
      {sessionAlert && <PageSection>{sessionAlert}</PageSection>}
      {/* Above every route, so an unsupported gateway is explained on the
          same screen as the errors it causes, for every signed-in user. It
          lives here rather than in a page so that it stays mounted across
          navigation and is announced once, when it appears. The title is not
          a heading: it sits above each page's h1, where a heading would break
          the outline. Wrapped in a section only when shown. */}
      <GatewayCompatibilityAlert
        component="div"
        wrapper={(alert) => <PageSection>{alert}</PageSection>}
      />
      {children}
      <CurrentUserModal
        user={user.data}
        isOpen={isIdentityOpen}
        onClose={() => setIdentityOpen(false)}
      />
      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setAboutOpen(false)}
        productName={t('about.productName')}
        trademark={t('about.trademark')}
        brandImageSrc={logoSrc}
        brandImageAlt={t('about.brandAlt')}
      >
        <Content>
          <DescriptionList
            isCompact
            isAutoFit
            autoFitMinModifier={{ default: '200px' }}
          >
            {/* A build has no version number to show: the image is built
                before a release is cut and only given more tags afterwards.
                What is true of it is the gateway release line it is for, and
                the commit it is made from when the build was told. */}
            <DescriptionListGroup>
              <DescriptionListTerm>
                {t('about.builtForGateway')}
              </DescriptionListTerm>
              <DescriptionListDescription data-testid="about-gateway-line">
                {builtForLine
                  ? t('about.gatewayLine', { line: builtForLine })
                  : t('about.unknown')}
              </DescriptionListDescription>
            </DescriptionListGroup>
            {BUILD_COMMIT && (
              <DescriptionListGroup>
                <DescriptionListTerm>
                  {t('about.dashboardCommit')}
                </DescriptionListTerm>
                <DescriptionListDescription data-testid="about-dashboard-commit">
                  {BUILD_COMMIT}
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
            <DescriptionListGroup>
              <DescriptionListTerm>
                {t('about.gatewayVersion')}
              </DescriptionListTerm>
              <DescriptionListDescription>
                {compatibility?.gatewayVersion || t('about.unknown')}
              </DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>
        </Content>
      </AboutModal>
    </Page>
  );
};

export default AppLayout;
