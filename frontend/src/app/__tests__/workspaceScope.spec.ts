import {
  defaultWorkspace,
  scopeOfLocation,
  sectionOfLegacyTab,
  sectionPath,
} from '../workspaceScope';

describe('scopeOfLocation', () => {
  it.each([
    ['/workspaces/team-a/sandboxes', 'team-a', 'sandboxes'],
    ['/workspaces/team-a/sandboxes/agent-1', 'team-a', 'sandboxes'],
    ['/workspaces/team-a/providers/claude', 'team-a', 'providers'],
    ['/workspaces/team-a/proposals', 'team-a', 'proposals'],
    ['/workspaces/team-a/members', 'team-a', 'members'],
    // Creating a sandbox is part of Sandboxes, and the bare URL leads there.
    ['/workspaces/team-a/create-sandbox', 'team-a', 'sandboxes'],
    ['/workspaces/team-a', 'team-a', 'sandboxes'],
    ['/workspaces/team%20b/services', 'team b', 'services'],
    // A workspace may be named like a section, or like a platform page.
    ['/workspaces/sandboxes/templates', 'sandboxes', 'templates'],
    ['/workspaces/all-workspaces/sandboxes', 'all-workspaces', 'sandboxes'],
  ])('reads %s as a workspace and a section', (path, workspace, section) => {
    expect(scopeOfLocation(path)).toEqual({ workspace, isAll: false, section });
  });

  it.each([
    ['/sandboxes', '', 'sandboxes'],
    ['/proposals', '', 'proposals'],
    ['/all-workspaces', '', 'providers'],
    ['/all-workspaces', '?tab=templates', 'templates'],
    ['/all-workspaces', '?tab=services', 'services'],
    ['/all-workspaces', '?tab=nonsense', 'providers'],
  ])('reads %s%s as every workspace', (path, search, section) => {
    expect(scopeOfLocation(path, search)).toEqual({ isAll: true, section });
  });

  it.each([['/gateway'], ['/workspaces'], ['/provider-profiles'], ['/']])(
    'reads %s as belonging to no workspace',
    (path) => {
      expect(scopeOfLocation(path)).toEqual({ isAll: false });
    },
  );
});

describe('sectionPath', () => {
  it('is under the workspace, with its name encoded', () => {
    expect(sectionPath({ workspace: 'team b' }, 'providers')).toBe(
      '/workspaces/team%20b/providers',
    );
  });

  // Exactly the lists the gateway serves across workspaces (hard fact 12).
  // Members are of one workspace, so that way leads to Sandboxes.
  it.each([
    ['sandboxes', '/sandboxes'],
    ['providers', '/all-workspaces'],
    ['templates', '/all-workspaces?tab=templates'],
    ['services', '/all-workspaces?tab=services'],
    ['proposals', '/proposals'],
    ['members', '/sandboxes'],
  ] as const)('leads %s of every workspace to %s', (section, path) => {
    expect(sectionPath('all', section)).toBe(path);
  });

  it('round-trips with scopeOfLocation', () => {
    for (const section of ['sandboxes', 'providers', 'proposals'] as const) {
      const [path, search = ''] = sectionPath('all', section).split('?');
      expect(scopeOfLocation(path, search ? `?${search}` : '').section).toBe(
        section,
      );
    }
  });
});

describe('the old one-page workspace view', () => {
  it.each([
    [null, 'sandboxes', ''],
    ['providers', 'providers', ''],
    ['profiles', 'providers', '?tab=profiles'],
    ['members', 'members', ''],
    ['nonsense', 'sandboxes', ''],
  ])('leads ?tab=%s to its page', (tab, section, search) => {
    expect(sectionOfLegacyTab(tab)).toEqual({ section, search });
  });
});

describe('defaultWorkspace', () => {
  it('is the one last worked in while it exists, else the first', () => {
    expect(defaultWorkspace(['a', 'b'], 'b')).toBe('b');
    expect(defaultWorkspace(['a', 'b'], 'gone')).toBe('a');
    expect(defaultWorkspace(['a', 'b'], undefined)).toBe('a');
    expect(defaultWorkspace([], 'b')).toBeUndefined();
  });
});
