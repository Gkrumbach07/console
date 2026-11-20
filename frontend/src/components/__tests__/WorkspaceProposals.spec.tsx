import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import WorkspaceProposals from '../WorkspaceProposals';
import type { DraftSandboxSummary } from '../../types';

let mockSummary: {
  items: DraftSandboxSummary[];
  isLoading: boolean;
  isError: boolean;
};
let mockDraftPolicy = true;

const mockUseSummary = jest.fn(() => mockSummary);
jest.mock('../../api/draftSummary', () => ({
  useWorkspaceDraftSummary: (...args: unknown[]) =>
    mockUseSummary(...(args as [])),
}));
jest.mock('../../api/auth', () => ({
  useFeatureFlags: jest.fn(() => ({ draftPolicy: mockDraftPolicy })),
}));
// Each sandbox's own proposals, with their Allow and Reject, are the
// sandbox tab's and are tested there.
jest.mock('../SandboxDraftsTab', () => ({
  __esModule: true,
  default: ({ sandboxName }: { sandboxName: string }) => (
    <div data-testid={`drafts-of-${sandboxName}`} />
  ),
}));

const entry = (
  sandboxName: string,
  over: Partial<DraftSandboxSummary> = {},
): DraftSandboxSummary => ({
  workspace: 'team-a',
  sandboxName,
  pendingCount: 1,
  hasSecurityFlags: false,
  latestDraftMs: 1000,
  ...over,
});

const renderQueue = () =>
  render(
    <MemoryRouter>
      <WorkspaceProposals workspace="team-a" />
    </MemoryRouter>,
  );

const order = () =>
  Array.from(
    document.querySelectorAll('[data-testid^="workspace-proposals-"]'),
  ).map((card) => card.getAttribute('data-testid'));

beforeEach(() => {
  mockDraftPolicy = true;
  mockSummary = { items: [], isLoading: false, isError: false };
  mockUseSummary.mockClear();
});

describe('WorkspaceProposals', () => {
  it('says nothing is waiting, and what would be', () => {
    renderQueue();
    expect(screen.getByTestId('workspace-proposals-empty')).toHaveTextContent(
      'Nothing is waiting',
    );
    expect(mockUseSummary).toHaveBeenCalledWith('team-a', true);
  });

  // A queue to decide from: the proposals are on the page, not a click away
  // on each sandbox.
  it("shows each sandbox's proposals in place, flagged ones first, then the newest", () => {
    mockSummary.items = [
      entry('old', { latestDraftMs: 10, pendingCount: 2 }),
      entry('new', { latestDraftMs: 99 }),
      entry('flagged', { latestDraftMs: 5, hasSecurityFlags: true }),
    ];
    renderQueue();

    expect(order()).toEqual([
      'workspace-proposals-flagged',
      'workspace-proposals-new',
      'workspace-proposals-old',
    ]);
    expect(screen.getByTestId('workspace-proposals-old')).toHaveTextContent(
      '2 waiting',
    );
    for (const name of ['flagged', 'new', 'old']) {
      expect(screen.getByTestId(`drafts-of-${name}`)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'new' })).toHaveAttribute(
      'href',
      '/workspaces/team-a/sandboxes/new?tab=proposals',
    );
  });

  // Each open sandbox reads its own proposals, so only the first few start
  // open, and the rest are read when they are opened.
  it('opens the first three, and reads the others when they are opened', () => {
    mockSummary.items = ['a', 'b', 'c', 'd'].map((name, index) =>
      entry(name, { latestDraftMs: 100 - index }),
    );
    renderQueue();

    expect(screen.getByTestId('drafts-of-c')).toBeInTheDocument();
    expect(screen.queryByTestId('drafts-of-d')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Proposals of d' }));
    expect(screen.getByTestId('drafts-of-d')).toBeInTheDocument();
  });

  it('lists a sandbox whose proposals could not be read last, closed', () => {
    mockSummary.items = [
      entry('broken', { unavailable: true, latestDraftMs: 999 }),
      entry('fine'),
    ];
    renderQueue();

    expect(order()).toEqual([
      'workspace-proposals-fine',
      'workspace-proposals-broken',
    ]);
    expect(screen.getByTestId('workspace-proposals-broken')).toHaveTextContent(
      'could not be read',
    );
    expect(screen.queryByTestId('drafts-of-broken')).not.toBeInTheDocument();
  });

  it('says so when the summary cannot be loaded', () => {
    mockSummary = { items: [], isLoading: false, isError: true };
    renderQueue();
    expect(screen.getByTestId('workspace-proposals-error')).toBeInTheDocument();
  });
});
