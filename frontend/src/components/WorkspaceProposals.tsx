import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Card,
  CardBody,
  CardExpandableContent,
  CardHeader,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Label,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { CheckCircleIcon } from '@patternfly/react-icons';
import { Link } from 'react-router-dom';

import { useFeatureFlags } from '../api/auth';
import { useWorkspaceDraftSummary } from '../api/draftSummary';
import SandboxDraftsTab from './SandboxDraftsTab';
import type { DraftSandboxSummary } from '../types';

type WorkspaceProposalsProps = {
  workspace: string;
};

// Flagged first, then the newest: the order they are worth looking at in.
const byUrgency = (a: DraftSandboxSummary, b: DraftSandboxSummary): number => {
  if (!!a.unavailable !== !!b.unavailable) return a.unavailable ? 1 : -1;
  if (a.hasSecurityFlags !== b.hasSecurityFlags) {
    return a.hasSecurityFlags ? -1 : 1;
  }
  return b.latestDraftMs - a.latestDraftMs;
};

// The first few sandboxes are open, so that what is waiting can be decided
// without a click; each open one reads its own proposals.
const OPEN_AT_FIRST = 3;

// What the sandboxes of a workspace have had blocked and are waiting on, as
// a queue to decide from: each sandbox's proposals are shown where they are,
// with the same Allow, Change and Reject as on the sandbox's own Proposals
// tab. A list that only linked to each sandbox made every decision a trip.
const WorkspaceProposals: React.FC<WorkspaceProposalsProps> = ({
  workspace,
}) => {
  const features = useFeatureFlags();
  const summary = useWorkspaceDraftSummary(workspace, features.draftPolicy);
  // Which sandboxes were opened or closed by hand; the rest follow the rule.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  if (summary.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading proposals" />
      </Bullseye>
    );
  }
  if (summary.isError) {
    return (
      <Alert
        variant="danger"
        isInline
        title="The proposals could not be loaded"
        data-testid="workspace-proposals-error"
      />
    );
  }

  const waiting = [...summary.items].sort(byUrgency);
  if (waiting.length === 0) {
    return (
      <EmptyState
        headingLevel="h2"
        titleText="Nothing is waiting"
        icon={CheckCircleIcon}
        data-testid="workspace-proposals-empty"
      >
        <EmptyStateBody>
          When a program in a sandbox of {workspace} tries to reach a host its
          policy does not allow, the request is blocked and shows up here, to
          allow or reject.
        </EmptyStateBody>
      </EmptyState>
    );
  }

  return (
    <Stack hasGutter data-testid="workspace-proposals">
      {waiting.map((entry, index) => {
        const isExpanded =
          toggled[entry.sandboxName] ??
          (index < OPEN_AT_FIRST && !entry.unavailable);
        return (
          <StackItem key={entry.sandboxName}>
            <Card
              isExpanded={isExpanded}
              isCompact
              data-testid={`workspace-proposals-${entry.sandboxName}`}
            >
              <CardHeader
                onExpand={() =>
                  setToggled((current) => ({
                    ...current,
                    [entry.sandboxName]: !isExpanded,
                  }))
                }
                toggleButtonProps={{
                  'aria-label': `Proposals of ${entry.sandboxName}`,
                  'aria-expanded': isExpanded,
                }}
              >
                <CardTitle>
                  <Link
                    to={`/workspaces/${workspace}/sandboxes/${entry.sandboxName}?tab=proposals`}
                  >
                    {entry.sandboxName}
                  </Link>{' '}
                  {entry.unavailable ? (
                    <Label isCompact color="grey">
                      could not be read
                    </Label>
                  ) : (
                    <Label isCompact color="blue">
                      {entry.pendingCount} waiting
                    </Label>
                  )}{' '}
                  {entry.hasSecurityFlags && (
                    <Label isCompact color="orange">
                      flagged
                    </Label>
                  )}
                </CardTitle>
              </CardHeader>
              <CardExpandableContent>
                <CardBody>
                  {isExpanded && (
                    <SandboxDraftsTab
                      workspace={workspace}
                      sandboxName={entry.sandboxName}
                    />
                  )}
                </CardBody>
              </CardExpandableContent>
            </Card>
          </StackItem>
        );
      })}
    </Stack>
  );
};

export default WorkspaceProposals;
