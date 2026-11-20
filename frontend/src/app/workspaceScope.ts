// The workspace the navigation is in. Almost everything a person does is in
// one workspace (its sandboxes, providers, proposals), so the navigation
// holds one, shows that workspace's things as its entries, and offers a
// switcher above them. A platform admin can also choose every workspace at
// once, which is the scope the gateway serves its cross-workspace lists in
// (hard fact 12), to platform admins only.

export type NavSection =
  | 'sandboxes'
  | 'providers'
  | 'proposals'
  | 'templates'
  | 'services'
  | 'members';

export const NAV_SECTIONS: NavSection[] = [
  'sandboxes',
  'providers',
  'proposals',
  'templates',
  'services',
  'members',
];

// What a URL says about the scope: a workspace's name, every workspace, or
// nothing (a platform page, which belongs to no workspace).
export type LocationScope = {
  workspace?: string;
  isAll: boolean;
  section?: NavSection;
};

const isSection = (value: string | undefined): value is NavSection =>
  NAV_SECTIONS.includes(value as NavSection);

export const scopeOfLocation = (
  pathname: string,
  search = '',
): LocationScope => {
  const inWorkspace = /^\/workspaces\/([^/]+)(?:\/([^/]+))?/.exec(pathname);
  if (inWorkspace) {
    const [, workspace, segment] = inWorkspace;
    return {
      workspace: decodeURIComponent(workspace),
      isAll: false,
      // Creating a sandbox is part of Sandboxes; the bare workspace URL
      // leads there too.
      section: isSection(segment) ? segment : 'sandboxes',
    };
  }
  if (pathname === '/sandboxes') return { isAll: true, section: 'sandboxes' };
  if (pathname === '/proposals') return { isAll: true, section: 'proposals' };
  if (pathname === '/all-workspaces') {
    const tab = new URLSearchParams(search).get('tab') ?? undefined;
    return { isAll: true, section: isSection(tab) ? tab : 'providers' };
  }
  return { isAll: false };
};

// Where a section is, in a workspace or across all of them. Members exist in
// one workspace only, so across all of them the way leads to Sandboxes.
export const sectionPath = (
  scope: { workspace: string } | 'all',
  section: NavSection,
): string => {
  if (scope !== 'all') {
    return `/workspaces/${encodeURIComponent(scope.workspace)}/${section}`;
  }
  switch (section) {
    case 'proposals':
      return '/proposals';
    case 'providers':
      return '/all-workspaces';
    case 'templates':
    case 'services':
      return `/all-workspaces?tab=${section}`;
    default:
      return '/sandboxes';
  }
};

// The section a `?tab=` of the old one-page workspace view leads to now.
export const sectionOfLegacyTab = (
  tab: string | null,
): { section: NavSection; search: string } => {
  if (tab === 'profiles')
    return { section: 'providers', search: '?tab=profiles' };
  return {
    section: isSection(tab ?? undefined) ? (tab as NavSection) : 'sandboxes',
    search: '',
  };
};

const STORAGE_KEY = 'openshell.console.workspace';

// The workspace last worked in, so that a platform page, or coming back
// tomorrow, does not lose it. Storage may be unavailable; nothing depends on
// it.
export const rememberWorkspace = (workspace: string): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, workspace);
  } catch {
    // Nothing to do: the workspace is in the URL while it matters.
  }
};

export const recallWorkspace = (): string | undefined => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

// The workspace the navigation is in when the URL names none: the one last
// worked in if it still exists, else the first there is.
export const defaultWorkspace = (
  names: string[],
  remembered: string | undefined,
): string | undefined =>
  remembered && names.includes(remembered) ? remembered : names[0];
