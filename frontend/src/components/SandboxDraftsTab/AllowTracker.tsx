import { Alert, AlertActionCloseButton, Spinner } from '@patternfly/react-core';

import { POLICY_PENDING_WATCH_MS, useSandboxPolicy } from '../../api/policy';

export type AllowedChange = {
  // The revision the approval wrote.
  version: number;
  // "curl → pypi.org:443", what was allowed.
  what: string;
  // When this view saw the approval go through, on the browser's clock.
  sinceMs: number;
};

type AllowTrackerProps = {
  workspace: string;
  sandboxName: string;
  change: AllowedChange;
  onClose: () => void;
};

// What happened to an approval after the gateway took it: the revision it
// wrote waits for the sandbox to load it, and only then does the blocked
// request go through. `openshell policy update --wait` waits for the same
// thing. The sandbox's policy is re-read quickly while the revision is
// pending (useSandboxPolicy), so this settles by itself.
const AllowTracker: React.FC<AllowTrackerProps> = ({
  workspace,
  sandboxName,
  change,
  onClose,
}) => {
  const policy = useSandboxPolicy(workspace, sandboxName);
  const close = <AlertActionCloseButton onClose={onClose} />;
  const revision = policy.data?.revisions.find(
    (r) => r.version === change.version,
  );
  const activeVersion = policy.data?.activeVersion ?? 0;

  // A later revision that loaded carries this one's rule with it.
  if (revision?.status === 'LOADED' || activeVersion >= change.version) {
    return (
      <Alert
        variant="success"
        isInline
        title={`Allowed: ${change.what}`}
        actionClose={close}
        data-testid="allow-tracker-loaded"
      >
        The sandbox loaded revision {change.version} of its policy. Run the
        command again: nothing needs a restart.
      </Alert>
    );
  }
  if (revision?.status === 'FAILED') {
    return (
      <Alert
        variant="danger"
        isInline
        title={`The sandbox could not load revision ${change.version}`}
        actionClose={close}
        data-testid="allow-tracker-failed"
      >
        {revision.loadError || 'It gave no reason.'} It is still enforcing
        revision {activeVersion || '-'}, so {change.what} is still blocked.
      </Alert>
    );
  }
  const waited = Date.now() - change.sinceMs;
  if (waited > POLICY_PENDING_WATCH_MS) {
    return (
      <Alert
        variant="warning"
        isInline
        title={`Revision ${change.version} is not loaded yet`}
        actionClose={close}
        data-testid="allow-tracker-slow"
      >
        The approval is saved, but the sandbox has not picked it up in a minute.
        A stopped sandbox loads it when it starts. The Policy tab shows where it
        stands.
      </Alert>
    );
  }
  return (
    <Alert
      variant="info"
      isInline
      customIcon={<Spinner size="md" aria-label="Loading" />}
      title={`Allowing ${change.what}`}
      actionClose={close}
      data-testid="allow-tracker-pending"
    >
      Approved as revision {change.version} of the policy. Waiting for the
      sandbox to load it, which usually takes a few seconds.
    </Alert>
  );
};

export default AllowTracker;
