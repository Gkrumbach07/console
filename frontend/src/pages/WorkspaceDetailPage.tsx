import {
  Alert,
  Bullseye,
  Button,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Label,
  PageSection,
  Spinner,
  Tab,
  TabTitleText,
  Tabs,
  Title,
} from '@patternfly/react-core';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useFeatureFlags } from '../api/auth';
import type { ApiError } from '../api/client';
import { useWorkspace, useWorkspaceServices } from '../api/workspaces';
import LabelsList from '../components/LabelsList';
import PhaseLabel from '../components/PhaseLabel';
import ProfilesTab from '../components/provider/ProfilesTab';
import RefreshErrorAlert, {
  isRefreshError,
} from '../components/RefreshErrorAlert';
import ServiceEndpointsTable from '../components/ServiceEndpointsTable';
import TemplatesTab from '../components/TemplatesTab';
import WorkspaceProposals from '../components/WorkspaceProposals';
import { useSlots } from '../slots';
import { formatTimestamp } from '../utils/formatters';
import MemberListPage from './MemberListPage';
import ProviderListPage from './ProviderListPage';
import SandboxListPage from './SandboxListPage';
import type { CredentialInputSlot } from '../types';

// The things of a workspace, each a page of its own under the workspace
// that the navigation is in.
export type WorkspaceSection =
  | 'sandboxes'
  | 'providers'
  | 'proposals'
  | 'templates'
  | 'services'
  | 'members';

const SECTIONS: Record<WorkspaceSection, { title: string; intro: string }> = {
  sandboxes: {
    title: 'Sandboxes',
    intro:
      'Secure environments for agents and tools, each reaching only what it is allowed.',
  },
  providers: {
    title: 'Providers',
    intro:
      'The credentials sandboxes use to reach models and services, and the profiles they are made from.',
  },
  proposals: {
    title: 'Proposals',
    intro:
      'Requests the sandboxes had blocked, waiting to be allowed or rejected.',
  },
  templates: {
    title: 'Templates',
    intro:
      'Reusable sandbox setups: an image, a command, an environment and resources.',
  },
  services: {
    title: 'Services',
    intro: 'Ports that sandboxes expose.',
  },
  members: {
    title: 'Members',
    intro: 'Who may use this workspace, and as what.',
  },
};

type WorkspaceDetailPageProps = {
  workspace: string;
  // Which of the workspace's things the page shows.
  section?: WorkspaceSection;
  onSelectSandbox?: (name: string) => void;
  onViewSandbox?: (name: string, tab?: string) => void;
  onSelectProvider?: (name: string) => void;
  renderCredentialInput?: CredentialInputSlot;
};

const TabPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pf-v6-u-pt-lg">{children}</div>
);

const WorkspaceDetailPage: React.FC<WorkspaceDetailPageProps> = ({
  workspace,
  section = 'sandboxes',
  onSelectSandbox,
  onViewSandbox,
  onSelectProvider,
  renderCredentialInput,
}) => {
  const slots = useSlots();
  const resolvedCredentialInput =
    renderCredentialInput ?? slots.credentialInput;
  const workspaceQuery = useWorkspace(workspace);
  const features = useFeatureFlags();
  const services = useWorkspaceServices(workspace, {
    enabled: features.services && section === 'services',
  });
  const navigate = useNavigate();
  // Profiles sit behind Providers: a provider is made from one, and the two
  // are managed together. Which of the two is shown is in the URL
  // (?tab=profiles), so that a link can open on it.
  const [searchParams, setSearchParams] = useSearchParams();
  const providersTab =
    searchParams.get('tab') === 'profiles' ? 'profiles' : 'providers';
  const setProvidersTab = (key: string | number) =>
    setSearchParams(key === 'profiles' ? { tab: 'profiles' } : {}, {
      replace: true,
    });

  // A service endpoint is exposed and deleted on its sandbox's Services tab.
  const viewSandboxServices = (name: string) => {
    if (onViewSandbox) {
      onViewSandbox(name, 'services');
    } else {
      navigate(`/workspaces/${workspace}/sandboxes/${name}?tab=services`);
    }
  };

  if (workspaceQuery.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading workspace" />
        </Bullseye>
      </PageSection>
    );
  }

  // The workspace is re-read while the page is open. Only a first load that
  // failed takes the page: every tab below, and any dialog open in one, lives
  // in this component, and a refresh that did not get through must not throw
  // them away. It is reported above the details instead.
  const refreshFailed = isRefreshError(workspaceQuery);
  // The gateway refuses a workspace to someone who is not its member, with
  // an instruction for the CLI. Retrying cannot help; a platform admin can.
  const notMember =
    workspaceQuery.isError &&
    !refreshFailed &&
    (workspaceQuery.error as ApiError | null)?.status === 403;
  if (notMember) {
    return (
      <PageSection>
        <Alert
          variant="warning"
          title={`You're not a member of ${workspace}`}
          data-testid="workspace-not-member"
        >
          <Content component="p">
            A platform admin adds you on this workspace&apos;s Members tab, with
            your subject ID. Copy it from the user menu (Copy my subject ID) and
            send it to them.
          </Content>
          <Content component="small">
            The gateway said: {(workspaceQuery.error as Error).message}
          </Content>
        </Alert>
      </PageSection>
    );
  }
  if (workspaceQuery.isError && !refreshFailed) {
    return (
      <PageSection>
        <Alert
          variant="danger"
          title={`Failed to load workspace ${workspace}`}
          actionLinks={
            <Button variant="link" onClick={() => workspaceQuery.refetch()}>
              Retry
            </Button>
          }
        >
          {(workspaceQuery.error as Error).message}
        </Alert>
      </PageSection>
    );
  }

  const { title, intro } = SECTIONS[section];
  const details = workspaceQuery.data;

  return (
    <>
      <PageSection>
        {refreshFailed && (
          <RefreshErrorAlert
            title={`Workspace ${workspace} could not be refreshed`}
            error={workspaceQuery.error}
            onRetry={() => workspaceQuery.refetch()}
            className="pf-v6-u-mb-md"
            data-testid="workspace-refresh-error"
          />
        )}
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          gap={{ default: 'gapMd' }}
        >
          <FlexItem>
            <Title headingLevel="h1" data-testid="workspace-section-title">
              {title}
            </Title>
          </FlexItem>
          <FlexItem>
            <Label isCompact variant="outline" data-testid="workspace-name">
              {workspace}
            </Label>
          </FlexItem>
          {details && details.phase !== 'ACTIVE' && (
            <FlexItem>
              <PhaseLabel phase={details.phase} />
            </FlexItem>
          )}
        </Flex>
        <Content component="p">{intro}</Content>
        {/* What the gateway holds about the workspace itself, beside the
            people in it. */}
        {section === 'members' && details && (
          <DescriptionList
            isHorizontal
            isCompact
            className="pf-v6-u-mt-md"
            data-testid="workspace-details"
          >
            <DescriptionListGroup>
              <DescriptionListTerm>ID</DescriptionListTerm>
              <DescriptionListDescription>
                {details.metadata.id || '-'}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Resource version</DescriptionListTerm>
              <DescriptionListDescription>
                {details.metadata.resourceVersion}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Created</DescriptionListTerm>
              <DescriptionListDescription>
                {formatTimestamp(details.metadata.createdAtMs)}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Labels</DescriptionListTerm>
              <DescriptionListDescription>
                <LabelsList labels={details.metadata.labels} />
              </DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>
        )}
      </PageSection>
      <PageSection>
        {section === 'sandboxes' && (
          <SandboxListPage
            workspace={workspace}
            onSelect={onSelectSandbox}
            onViewSandbox={onViewSandbox}
          />
        )}
        {section === 'providers' && (
          <Tabs
            activeKey={providersTab}
            onSelect={(_event, key) => setProvidersTab(key)}
            aria-label="Providers and their profiles"
          >
            <Tab
              eventKey="providers"
              title={<TabTitleText>Providers</TabTitleText>}
              data-testid="tab-providers"
            >
              <TabPanel>
                <ProviderListPage
                  workspace={workspace}
                  onSelect={onSelectProvider}
                  renderCredentialInput={resolvedCredentialInput}
                />
              </TabPanel>
            </Tab>
            <Tab
              eventKey="profiles"
              title={<TabTitleText>Profiles</TabTitleText>}
              data-testid="tab-profiles"
            >
              <TabPanel>
                <ProfilesTab workspace={workspace} />
              </TabPanel>
            </Tab>
          </Tabs>
        )}
        {section === 'proposals' && (
          <WorkspaceProposals workspace={workspace} />
        )}
        {section === 'templates' && <TemplatesTab workspace={workspace} />}
        {section === 'services' && (
          <ServiceEndpointsTable
            query={services}
            workspace={workspace}
            onSelectSandbox={(_workspace, name) => viewSandboxServices(name)}
          />
        )}
        {section === 'members' && <MemberListPage workspace={workspace} />}
      </PageSection>
    </>
  );
};

export default WorkspaceDetailPage;
