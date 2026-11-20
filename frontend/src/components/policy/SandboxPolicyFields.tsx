import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  ExpandableSection,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Label,
  LabelGroup,
  List,
  ListItem,
  Tooltip,
} from '@patternfly/react-core';
import { PlusCircleIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { Link } from 'react-router-dom';

import {
  useProviderProfiles,
  useProviders,
  useUpdateProviderProfile,
} from '../../api/providers';
import { useWorkspaceRole } from '../../api/rbac';
import type { CreateSandboxForm } from '../../hooks/useCreateSandboxForm';
import {
  profileAllows,
  profileWithPrograms,
} from '../../sandboxPresets/presets';
import { profileForProvider } from '../../utils/providerProfiles';
import ListInput from '../ListInput';
import { isSimpleRule } from '../SandboxDraftsTab/proposalWords';
import ProviderSelect from '../sandbox/ProviderSelect';
import OwnServiceProviderModal from '../provider/OwnServiceProviderModal';
import HostRuleForm from './HostRuleForm';
import { describeEndpoint } from './policyBuilder';

// The pieces of what a sandbox may reach and touch, as the create wizard asks
// them: the providers it gets keys and access from, the hosts it may reach
// besides, and the paths it may read and write. The hosts and the paths are
// views of the policy file (useCreateSandboxForm): what they change is
// written there, and what the file says is what they show.

type FieldProps = {
  workspace: string;
  form: CreateSandboxForm;
};

// The hosts attaching each chosen provider adds: those of its type's profile.
const useProviderHosts = (workspace: string, names: string[]) => {
  const providers = useProviders(workspace);
  const profiles = useProviderProfiles(workspace);
  const hostsOf = (name: string): string[] => {
    const provider = (providers.data ?? []).find(
      (candidate) => candidate.metadata.name === name,
    );
    return provider
      ? (profileForProvider(profiles.data ?? [], provider)?.endpoints ?? [])
      : [];
  };
  return names.map((name) => ({ name, hosts: hostsOf(name) }));
};

// A provider that was chosen whose profile does not name the programs of
// what the sandbox will run: the agent would reach nothing through it.
const ProviderLetsThrough: React.FC<FieldProps & { providerName: string }> = ({
  workspace,
  form,
  providerName,
}) => {
  const providers = useProviders(workspace);
  const profiles = useProviderProfiles(workspace);
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const update = useUpdateProviderProfile(workspace);
  const provider = (providers.data ?? []).find(
    (candidate) => candidate.metadata.name === providerName,
  );
  const profile = provider
    ? profileForProvider(profiles.data ?? [], provider)
    : undefined;
  if (!provider || !profile || profileAllows(profile, form.preset)) {
    return null;
  }
  // A workspace's own profile is its admin's to change. A platform profile
  // is shared by every workspace, and is changed under Provider profiles.
  const canFix = isWorkspaceAdmin && profile.scope === 'workspace';
  return (
    <Alert
      variant="warning"
      isInline
      className="pf-v6-u-mt-sm"
      title={`${providerName} does not let ${form.preset.name} through`}
      data-testid={`sandbox-provider-blocks-${providerName}`}
      actionLinks={
        canFix ? (
          <Button
            variant="link"
            isInline
            isLoading={update.isPending}
            isDisabled={update.isPending}
            onClick={() =>
              update.mutate({
                profileId: profile.id,
                profile: profileWithPrograms(profile, form.preset),
                expectedResourceVersion: profile.resourceVersion,
              })
            }
            data-testid={`sandbox-provider-allow-${providerName}`}
          >
            Let {form.preset.name} use it
          </Button>
        ) : undefined
      }
    >
      A provider is reached only from the programs its profile names, and{' '}
      {profile.displayName || profile.id} names{' '}
      {(profile.binaries ?? []).map((binary) => binary.path).join(', ') ||
        'none'}
      . {form.preset.name} would be blocked from it.
      {!canFix &&
        ` ${profile.scope === 'workspace' ? 'A workspace admin' : 'A platform admin'} adds ${form.preset.name}'s programs to the profile.`}
      {update.isError && ` ${(update.error as Error).message}`}
    </Alert>
  );
};

export const ProvidersField: React.FC<FieldProps> = ({ workspace, form }) => {
  const providers = useProviders(workspace);
  const profiles = useProviderProfiles(workspace);
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const [isOwnServiceOpen, setOwnServiceOpen] = useState(false);
  const providerList = providers.data ?? [];
  const runsAgent = form.preset.id !== 'shell';

  const addOwn = isWorkspaceAdmin && (
    <Button
      variant="link"
      isInline
      icon={<PlusCircleIcon />}
      onClick={() => setOwnServiceOpen(true)}
      data-testid="sandbox-add-own-service"
    >
      Add a provider by URL and key
    </Button>
  );

  return (
    <FormGroup label="Providers" fieldId="sandbox-providers">
      {providerList.length === 0 ? (
        <FormHelperText>
          <HelperText>
            <HelperTextItem data-testid="sandbox-providers-empty">
              No providers in this workspace yet. A provider gives a sandbox an
              API key and the access to use it; a workspace admin adds one on
              the workspace&apos;s{' '}
              <Link to={`/workspaces/${workspace}?tab=providers`}>
                Providers tab
              </Link>
              .
            </HelperTextItem>
          </HelperText>
        </FormHelperText>
      ) : (
        <>
          <ProviderSelect
            providers={providerList}
            selected={form.selectedProviders}
            onToggle={form.toggleProvider}
            onClear={() => form.setSelectedProviders([])}
            describe={(provider) => {
              const hosts =
                profileForProvider(profiles.data ?? [], provider)?.endpoints ??
                [];
              return hosts.length > 0
                ? `Adds ${hosts.join(', ')} and its key`
                : undefined;
            }}
          />
          <FormHelperText>
            <HelperText>
              <HelperTextItem data-testid="sandbox-providers-help">
                Each provider gives the sandbox an API key and the hosts to use
                it with. The key never enters the sandbox: it holds a
                placeholder that the gateway&apos;s proxy fills in on the way
                out.
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        </>
      )}
      {runsAgent && form.selectedProviders.length === 0 && (
        <Alert
          variant="info"
          isInline
          isPlain
          className="pf-v6-u-mt-sm"
          title={`${form.preset.name} needs a model to talk to: choose a provider that reaches one.`}
          data-testid="sandbox-preset-needs-provider"
        />
      )}
      {runsAgent &&
        form.selectedProviders.map((name) => (
          <ProviderLetsThrough
            key={name}
            workspace={workspace}
            form={form}
            providerName={name}
          />
        ))}
      {addOwn && <div className="pf-v6-u-mt-sm">{addOwn}</div>}
      {/* Mounted when opened, so that it starts with the programs of what
          the sandbox runs now. */}
      {isOwnServiceOpen && (
        <OwnServiceProviderModal
          workspace={workspace}
          isOpen
          onClose={() => setOwnServiceOpen(false)}
          onCreated={(name) => form.toggleProvider(name, true)}
          defaultPrograms={form.preset.programs}
        />
      )}
    </FormGroup>
  );
};

// What the form shows while the policy file does not read as a policy: its
// fields would not be what is sent, so they wait for the file to be fixed.
export const PolicyFileBroken: React.FC<{ onShowFile: () => void }> = ({
  onShowFile,
}) => (
  <Alert
    variant="warning"
    isInline
    title="The policy file has an error"
    data-testid="sandbox-policy-file-broken"
    actionLinks={
      <Button variant="link" isInline onClick={onShowFile}>
        Show the file
      </Button>
    }
  >
    These fields show the policy as it last read, and can be changed again once
    the file is fixed.
  </Alert>
);

const ProvidersHosts: React.FC<FieldProps> = ({ workspace, form }) => {
  const [isExpanded, setExpanded] = useState(false);
  const provided = useProviderHosts(workspace, form.selectedProviders);
  if (provided.length === 0) {
    return (
      <Content component="small" data-testid="sandbox-provider-hosts-none">
        No providers attached. Providers you choose on Basics add their hosts
        and keys here.
      </Content>
    );
  }
  const count = provided.reduce((sum, { hosts }) => sum + hosts.length, 0);
  return (
    <ExpandableSection
      toggleText={`Your providers add ${count} host${count === 1 ? '' : 's'}`}
      isExpanded={isExpanded}
      onToggle={(_event, expanded) => setExpanded(expanded)}
      data-testid="sandbox-provider-hosts"
    >
      <List isPlain>
        {provided.map(({ name, hosts }) => (
          <ListItem key={name}>
            <strong>{name}</strong>:{' '}
            {hosts.length > 0 ? hosts.join(', ') : 'no hosts of its own'}
          </ListItem>
        ))}
      </List>
      <Content component="small">
        They come with each provider&apos;s key and change with its profile, so
        they are not part of the policy file.
      </Content>
    </ExpandableSection>
  );
};

export const AccessField: React.FC<FieldProps> = ({ workspace, form }) => {
  // The rule being added ('new') or changed (its name), shown in place.
  const [editing, setEditing] = useState<string | null>(null);
  const ruleEntries = Object.entries(form.rules);
  const editingRule =
    editing && editing !== 'new' ? form.rules[editing] : undefined;
  const isDisabled = !form.canEditPolicy;

  return (
    <>
      <ProvidersHosts workspace={workspace} form={form} />
      <FormGroup label="Other hosts" fieldId="sandbox-rules" role="group">
        {ruleEntries.length === 0 ? (
          <Content component="small" data-testid="sandbox-rules-empty">
            None. Add a host the sandbox may reach besides its providers&apos;:
            a package index, a repository, an internal service.
          </Content>
        ) : (
          <Table
            variant="compact"
            aria-label="Other hosts"
            data-testid="sandbox-rules-table"
          >
            <Thead>
              <Tr>
                <Th width={50}>Allows</Th>
                <Th>From programs</Th>
                <Th screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {ruleEntries.map(([name, rule]) => {
                const binaries = (rule.binaries ?? [])
                  .map((b) => b.path ?? '')
                  .filter(Boolean);
                const editable = isSimpleRule(rule);
                return (
                  <Tr key={name} data-testid={`sandbox-rule-${name}`}>
                    <Td dataLabel="Allows">
                      {(rule.endpoints ?? []).map((endpoint, index) => (
                        <div key={index}>{describeEndpoint(endpoint)}</div>
                      ))}
                    </Td>
                    <Td dataLabel="From programs">
                      {binaries.length > 0 ? (
                        <LabelGroup numLabels={2}>
                          {binaries.map((path) => (
                            <Label key={path} isCompact variant="outline">
                              {path}
                            </Label>
                          ))}
                        </LabelGroup>
                      ) : (
                        <HelperText>
                          <HelperTextItem
                            variant="warning"
                            data-testid={`sandbox-rule-no-binaries-${name}`}
                          >
                            None named, so no program can use it
                          </HelperTextItem>
                        </HelperText>
                      )}
                    </Td>
                    <Td isActionCell modifier="nowrap">
                      {editable ? (
                        <Button
                          variant="link"
                          isInline
                          onClick={() => setEditing(name)}
                          isDisabled={isDisabled || editing !== null}
                          data-testid={`sandbox-rule-edit-${name}`}
                        >
                          Edit
                        </Button>
                      ) : (
                        <Tooltip content="This rule says more than the form can show. Change it in the policy file.">
                          <Button
                            variant="link"
                            isInline
                            isAriaDisabled
                            data-testid={`sandbox-rule-edit-${name}`}
                          >
                            Edit
                          </Button>
                        </Tooltip>
                      )}{' '}
                      <Button
                        variant="link"
                        isInline
                        onClick={() => form.removeRule(name)}
                        isDisabled={isDisabled}
                        data-testid={`sandbox-rule-remove-${name}`}
                      >
                        Remove
                      </Button>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
        {editing ? (
          <Card isCompact className="pf-v6-u-mt-sm" data-testid="add-host-card">
            <CardTitle>
              {editing === 'new' ? 'Add a host' : 'Change what is allowed'}
            </CardTitle>
            <CardBody>
              <HostRuleForm
                key={editing}
                initialRule={editingRule}
                submitLabel={editing === 'new' ? 'Add' : 'Save'}
                onSubmit={(name, rule) => {
                  if (editing === 'new') form.addRule(name, rule);
                  else form.replaceRule(editing, rule);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            </CardBody>
          </Card>
        ) : (
          <div className="pf-v6-u-mt-sm">
            <Button
              variant="link"
              isInline
              icon={<PlusCircleIcon />}
              onClick={() => setEditing('new')}
              isDisabled={isDisabled}
              data-testid="sandbox-add-host"
            >
              Add a host
            </Button>
          </div>
        )}
      </FormGroup>
    </>
  );
};

const pathInvalidReason = (path: string): string | undefined =>
  path.startsWith('/') ? undefined : 'a path from /';

export const FilesField: React.FC<Pick<FieldProps, 'form'>> = ({ form }) => {
  const invalid = [...form.readWrite, ...form.readOnly].some((path) =>
    pathInvalidReason(path),
  );
  return (
    <>
      <FormGroup label="Read and write" fieldId="sandbox-fs-rw">
        <ListInput
          id="sandbox-fs-rw"
          data-testid="sandbox-fs-rw"
          aria-label="Paths to read and write"
          values={form.readWrite}
          onChange={(paths) => form.setPaths('readWrite', paths)}
          placeholder="/sandbox, then Enter"
          invalidReason={pathInvalidReason}
          isDisabled={!form.canEditPolicy}
          isClearable={false}
        />
      </FormGroup>
      <FormGroup label="Read only" fieldId="sandbox-fs-ro">
        <ListInput
          id="sandbox-fs-ro"
          data-testid="sandbox-fs-ro"
          aria-label="Paths to read"
          values={form.readOnly}
          onChange={(paths) => form.setPaths('readOnly', paths)}
          placeholder="/usr, then Enter"
          invalidReason={pathInvalidReason}
          isDisabled={!form.canEditPolicy}
          isClearable={false}
        />
        <FormHelperText>
          <HelperText>
            <HelperTextItem
              variant={invalid ? 'error' : 'default'}
              data-testid="sandbox-fs-help"
            >
              {invalid
                ? 'Each path starts with /.'
                : `Type a path and press Enter, or paste several. Click a path to change it. Anything not listed cannot be read.${form.policy.filesystem?.includeWorkdir ? ' The working directory is writable too.' : ''} None of this can change once the sandbox is created.`}
            </HelperTextItem>
          </HelperText>
        </FormHelperText>
      </FormGroup>
    </>
  );
};

// What the policy file sets that the form has no field for. The form keeps
// it as it is; this says so, so that nothing in what is sent is out of sight.
export const PolicyExtras: React.FC<{
  extras: string[];
  onShowFile: () => void;
}> = ({ extras, onShowFile }) =>
  extras.length === 0 ? null : (
    <Alert
      variant="info"
      isInline
      isPlain
      title={`The policy file also sets: ${extras.join('; ')}`}
      data-testid="sandbox-policy-extras"
      actionLinks={
        <Button variant="link" isInline onClick={onShowFile}>
          Show the file
        </Button>
      }
    >
      The form has no field for these, and keeps them as the file has them.
    </Alert>
  );
