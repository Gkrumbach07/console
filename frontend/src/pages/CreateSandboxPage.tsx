import { useState } from 'react';
import {
  ActionList,
  ActionListGroup,
  ActionListItem,
  Alert,
  Button,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Drawer,
  DrawerActions,
  DrawerCloseButton,
  DrawerContent,
  DrawerContentBody,
  DrawerHead,
  DrawerPanelBody,
  DrawerPanelContent,
  ExpandableSection,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  FormHelperText,
  FormSection,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  PageSection,
  TextArea,
  TextInput,
  Title,
  Wizard,
  WizardFooterWrapper,
  WizardStep,
  useWizardContext,
} from '@patternfly/react-core';
import { CodeIcon } from '@patternfly/react-icons';

import { useProviderProfiles, useProviders } from '../api/providers';
import { useApplyApprovalMode } from '../api/sandboxSettings';
import { useCreateSandbox } from '../api/sandboxes';
import { useAlerts } from '../app/AlertContext';
import KeyValueEditor from '../components/KeyValueEditor';
import PolicyDocumentInput from '../components/policy/PolicyDocumentInput';
import {
  AccessField,
  FilesField,
  PolicyExtras,
  PolicyFileBroken,
  ProvidersField,
} from '../components/policy/SandboxPolicyFields';
import { describeEndpoint } from '../components/policy/policyBuilder';
import ApprovalModeFailureAlert from '../components/sandbox/ApprovalModeFailureAlert';
import SandboxLaunchFields from '../components/sandbox/SandboxLaunchFields';
import {
  useCreateSandboxForm,
  type CreateSandboxForm,
} from '../hooks/useCreateSandboxForm';
import { useI18n } from '../i18n';
import { profileForProvider } from '../utils/providerProfiles';

type CreateSandboxPageProps = {
  workspace: string;
  // Where to go once the sandbox exists, and when the page is left without
  // creating one.
  onCreated: (name: string) => void;
  onCancel: () => void;
};

// The levels the sandbox supervisor logs at. Empty leaves the choice to the
// gateway.
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'];

// The footer of every step before the review. Everything after the first
// step has a default, so "Review and create" is the quick path from any of
// them, and Next walks through the rest.
const StepFooter: React.FC<{ isFirst?: boolean }> = ({ isFirst }) => {
  const { goToNextStep, goToPrevStep, goToStepById, close } =
    useWizardContext();
  return (
    <WizardFooterWrapper>
      <ActionList>
        <ActionListGroup>
          {!isFirst && (
            <ActionListItem>
              <Button variant="secondary" onClick={goToPrevStep}>
                Back
              </Button>
            </ActionListItem>
          )}
          <ActionListItem>
            <Button
              variant="primary"
              onClick={goToNextStep}
              data-testid="create-sandbox-next"
            >
              Next
            </Button>
          </ActionListItem>
          <ActionListItem>
            <Button
              variant="secondary"
              onClick={() => goToStepById('review')}
              data-testid="create-sandbox-review"
            >
              Review and create
            </Button>
          </ActionListItem>
        </ActionListGroup>
        <ActionListGroup>
          <ActionListItem>
            <Button variant="link" onClick={close}>
              Cancel
            </Button>
          </ActionListItem>
        </ActionListGroup>
      </ActionList>
    </WizardFooterWrapper>
  );
};

// The policy file beside the form: the one copy of the policy, which the
// form's fields read and write. Edits here show in the form at once. The
// editor loads a file from disk itself (its upload button).
const PolicyFilePanel: React.FC<{
  form: CreateSandboxForm;
  onClose: () => void;
}> = ({ form, onClose }) => {
  const reasons = form.policyError?.split('\n') ?? [];

  return (
    <DrawerPanelContent
      isResizable
      defaultSize="45%"
      minSize="360px"
      data-testid="sandbox-policy-panel"
    >
      <DrawerHead>
        <Title headingLevel="h2" size="lg">
          Policy file
        </Title>
        <Content component="small">
          The same policy as the form: a change to either shows in the other.
        </Content>
        <DrawerActions>
          <DrawerCloseButton onClick={onClose} />
        </DrawerActions>
      </DrawerHead>
      <DrawerPanelBody>
        <PolicyDocumentInput
          text={form.policyText}
          onChange={form.setPolicyText}
          reading={form.policyReading}
          height="calc(100vh - 26rem)"
          data-testid="sandbox-policy-input"
        />
        {reasons.length > 0 && (
          <Alert
            variant="danger"
            isInline
            className="pf-v6-u-mt-sm"
            title="This is not a policy yet"
            data-testid="sandbox-policy-error"
          >
            {reasons.map((reason) => (
              <div key={reason}>{reason}</div>
            ))}
          </Alert>
        )}
        <Button
          variant="link"
          isInline
          className="pf-v6-u-mt-sm"
          onClick={form.resetPolicy}
          data-testid="sandbox-policy-reset"
        >
          Start over from the default policy
        </Button>
      </DrawerPanelBody>
    </DrawerPanelContent>
  );
};

// What the sandbox will be, in words.
const ReviewSummary: React.FC<{
  workspace: string;
  form: CreateSandboxForm;
}> = ({ workspace, form }) => {
  const profiles = useProviderProfiles(workspace);
  const providers = useProviders(workspace);
  const providerHosts = form.selectedProviders.flatMap((name) => {
    const provider = (providers.data ?? []).find(
      (candidate) => candidate.metadata.name === name,
    );
    return provider
      ? (profileForProvider(profiles.data ?? [], provider)?.endpoints ?? [])
      : [];
  });
  const rules = Object.values(form.rules);
  const resources = [
    form.cpu && `CPU ${form.cpu}`,
    form.memory && `memory ${form.memory}`,
    form.gpuCount && `${form.gpuCount} GPU`,
  ].filter(Boolean);

  return (
    <DescriptionList isHorizontal isCompact data-testid="sandbox-review">
      <DescriptionListGroup>
        <DescriptionListTerm>Name</DescriptionListTerm>
        <DescriptionListDescription>
          {form.name || 'Generated'}
        </DescriptionListDescription>
      </DescriptionListGroup>
      <DescriptionListGroup>
        <DescriptionListTerm>Image</DescriptionListTerm>
        <DescriptionListDescription>
          {form.resolvedImage || "The gateway's default image"}
        </DescriptionListDescription>
      </DescriptionListGroup>
      <DescriptionListGroup>
        <DescriptionListTerm>Providers</DescriptionListTerm>
        <DescriptionListDescription>
          {form.selectedProviders.length > 0
            ? form.selectedProviders.join(', ')
            : 'None'}
        </DescriptionListDescription>
      </DescriptionListGroup>
      <DescriptionListGroup>
        <DescriptionListTerm>Network</DescriptionListTerm>
        <DescriptionListDescription data-testid="review-network">
          {rules.length === 0 && providerHosts.length === 0 ? (
            <>
              Nothing yet. Every connection the sandbox tries becomes a proposal
              to approve.
            </>
          ) : (
            <>
              {providerHosts.length > 0 && (
                <div>{`From the providers: ${providerHosts.join(', ')}`}</div>
              )}
              {rules.flatMap((rule) =>
                (rule.endpoints ?? []).map((endpoint, index) => (
                  <div key={`${rule.name}-${index}`}>
                    {describeEndpoint(endpoint)}
                  </div>
                )),
              )}
              <div>Anything else becomes a proposal to approve.</div>
            </>
          )}
        </DescriptionListDescription>
      </DescriptionListGroup>
      <DescriptionListGroup>
        <DescriptionListTerm>Files</DescriptionListTerm>
        <DescriptionListDescription>
          {`Writes ${form.readWrite.join(', ') || 'only its working directory'}; reads ${form.readOnly.length} other path${form.readOnly.length === 1 ? '' : 's'}.`}
        </DescriptionListDescription>
      </DescriptionListGroup>
      {form.extras.length > 0 && (
        <DescriptionListGroup>
          <DescriptionListTerm>Also in the policy</DescriptionListTerm>
          <DescriptionListDescription data-testid="review-extras">
            {form.extras.join('; ')}
          </DescriptionListDescription>
        </DescriptionListGroup>
      )}
      <DescriptionListGroup>
        <DescriptionListTerm>Command</DescriptionListTerm>
        <DescriptionListDescription>
          {form.launch.command.length > 0
            ? form.launch.command.join(' ')
            : "The image's login shell"}
        </DescriptionListDescription>
      </DescriptionListGroup>
      <DescriptionListGroup>
        <DescriptionListTerm>Resources</DescriptionListTerm>
        <DescriptionListDescription>
          {resources.length > 0
            ? resources.join(', ')
            : "The compute driver's defaults"}
        </DescriptionListDescription>
      </DescriptionListGroup>
    </DescriptionList>
  );
};

const CreateSandboxPage: React.FC<CreateSandboxPageProps> = ({
  workspace,
  onCreated,
  onCancel,
}) => {
  const { t } = useI18n('sandboxes');
  const form = useCreateSandboxForm();
  const createSandbox = useCreateSandbox(workspace);
  const approvalMode = useApplyApprovalMode(workspace);
  const { addSuccess } = useAlerts();
  const [isFileOpen, setFileOpen] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const showFile = () => setFileOpen(true);

  const submit = () => {
    const payload = form.buildPayload();
    if (!payload) return;
    const mode = form.launch.approvalMode;
    createSandbox.mutate(payload, {
      onSuccess: async (sandbox) => {
        setCreated(sandbox.metadata.name);
        // The approval mode is a setting of the sandbox, written once the
        // sandbox exists. If that fails the sandbox stays and the page says
        // so instead of moving on.
        if (await approvalMode.apply(sandbox, mode)) {
          addSuccess('Sandbox created');
          onCreated(sandbox.metadata.name);
        }
      },
    });
  };

  // While the create is in flight the page cannot be left from the wizard:
  // what follows a create that succeeds (the approval mode, written once the
  // sandbox exists) would otherwise never run.
  const isBusy = createSandbox.isPending || approvalMode.isApplying;
  const cancel = isBusy ? () => undefined : onCancel;

  const header = (
    <PageSection>
      <Flex
        justifyContent={{ default: 'justifyContentSpaceBetween' }}
        alignItems={{ default: 'alignItemsFlexStart' }}
        flexWrap={{ default: 'nowrap' }}
      >
        <FlexItem>
          <Title headingLevel="h1">Create sandbox</Title>
          <Content component="p">
            A secure environment for an agent in {workspace}. It can be stopped
            and started, and runs until deleted.
          </Content>
        </FlexItem>
        <FlexItem>
          <Button
            variant={isFileOpen ? 'primary' : 'secondary'}
            icon={<CodeIcon />}
            onClick={() => setFileOpen((open) => !open)}
            aria-pressed={isFileOpen}
            data-testid="sandbox-policy-toggle"
          >
            Policy file
          </Button>
        </FlexItem>
      </Flex>
    </PageSection>
  );

  if (approvalMode.failure) {
    return (
      <>
        {header}
        <PageSection>
          <ApprovalModeFailureAlert failure={approvalMode.failure} />
          <Button
            className="pf-v6-u-mt-md"
            onClick={() => (created ? onCreated(created) : onCancel())}
            data-testid="create-sandbox-done"
          >
            Go to the sandbox
          </Button>
        </PageSection>
      </>
    );
  }

  const policyNotice = form.canEditPolicy ? (
    <PolicyExtras extras={form.extras} onShowFile={showFile} />
  ) : (
    <PolicyFileBroken onShowFile={showFile} />
  );

  return (
    <>
      {header}
      <PageSection
        type="wizard"
        isFilled
        aria-label="Create sandbox steps"
        padding={{ default: 'noPadding' }}
      >
        <Drawer isExpanded={isFileOpen} isInline position="end">
          <DrawerContent
            // Only while open: a closed inline panel keeps its width beside
            // the form, which then scrolls sideways when a field takes focus.
            panelContent={
              isFileOpen ? (
                <PolicyFilePanel
                  form={form}
                  onClose={() => setFileOpen(false)}
                />
              ) : null
            }
          >
            <DrawerContentBody>
              <Wizard onClose={cancel} onSave={submit} isVisitRequired={false}>
                <WizardStep
                  name="Basics"
                  id="basics"
                  footer={<StepFooter isFirst />}
                >
                  <Form onSubmit={(event) => event.preventDefault()}>
                    <FormGroup label="Name" fieldId="sandbox-name">
                      <TextInput
                        id="sandbox-name"
                        data-testid="sandbox-name-input"
                        value={form.name}
                        onChange={(_event, value) => form.setName(value)}
                        placeholder="Leave empty for a generated name"
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t('create.nameHelper')}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                    <FormGroup label="Image" fieldId="sandbox-image">
                      <TextInput
                        id="sandbox-image"
                        data-testid="sandbox-image-input"
                        value={form.image}
                        onChange={(_event, value) => form.setImage(value)}
                        placeholder="Leave empty for the gateway's default image"
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem data-testid="sandbox-image-help">
                            {form.isResolved
                              ? `Community image — resolves to ${form.resolvedImage}`
                              : 'A community sandbox name (base, python, ollama, …) or a fully-qualified OCI image reference.'}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                    <ProvidersField workspace={workspace} form={form} />
                  </Form>
                </WizardStep>

                <WizardStep
                  name="Network access"
                  id="network"
                  footer={<StepFooter />}
                >
                  <Form onSubmit={(event) => event.preventDefault()}>
                    <Content component="p" data-testid="sandbox-network-intro">
                      A sandbox starts with no network access. It reaches its
                      providers&apos; hosts and the hosts you add here, and only
                      from the programs you name. Anything else it tries is
                      blocked and shows up as a proposal on its Policy tab, to
                      approve there, so it is safe to start small.
                    </Content>
                    {policyNotice}
                    <AccessField workspace={workspace} form={form} />
                  </Form>
                </WizardStep>

                <WizardStep name="Files" id="files" footer={<StepFooter />}>
                  <Form onSubmit={(event) => event.preventDefault()}>
                    <Content component="p">
                      The paths the sandbox may read and write, as the user
                      sandbox. The defaults are OpenShell&apos;s own: it writes
                      /sandbox and /tmp, and reads the system.
                    </Content>
                    {policyNotice}
                    <FilesField form={form} />
                  </Form>
                </WizardStep>

                <WizardStep
                  name="Run"
                  id="run"
                  status={form.hasRunError ? 'error' : 'default'}
                  footer={<StepFooter />}
                >
                  <Form onSubmit={(event) => event.preventDefault()}>
                    <SandboxLaunchFields
                      workspace={workspace}
                      options={form.launch}
                      idPrefix="sandbox"
                    />
                    <FormGroup
                      label="Environment variables"
                      fieldId="sandbox-env"
                      role="group"
                    >
                      <KeyValueEditor
                        rows={form.envRows}
                        onChange={form.setEnvRows}
                        keyPlaceholder="NAME"
                        valuePlaceholder="value"
                        testIdPrefix="sandbox-env"
                        itemLabel="Environment variable"
                        addLabel="Add variable"
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem
                            variant={form.envError ? 'error' : 'default'}
                            data-testid="sandbox-env-help"
                          >
                            {form.envError ??
                              'Set in the sandbox and shown on its page. Not for API keys or tokens: attach a provider for those.'}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                  </Form>
                </WizardStep>

                <WizardStep
                  name="Resources"
                  id="resources"
                  status={form.hasResourcesError ? 'error' : 'default'}
                  footer={<StepFooter />}
                >
                  <Form onSubmit={(event) => event.preventDefault()}>
                    <Content component="p">
                      Left empty, each is the compute driver&apos;s default.
                    </Content>
                    <Grid hasGutter>
                      <GridItem md={4}>
                        <FormGroup label="CPU" fieldId="sandbox-cpu">
                          <TextInput
                            id="sandbox-cpu"
                            data-testid="sandbox-cpu-input"
                            value={form.cpu}
                            onChange={(_event, value) => form.setCpu(value)}
                            placeholder="2 or 500m"
                          />
                        </FormGroup>
                      </GridItem>
                      <GridItem md={4}>
                        <FormGroup label="Memory" fieldId="sandbox-memory">
                          <TextInput
                            id="sandbox-memory"
                            data-testid="sandbox-memory-input"
                            value={form.memory}
                            onChange={(_event, value) => form.setMemory(value)}
                            placeholder="4Gi"
                          />
                        </FormGroup>
                      </GridItem>
                      <GridItem md={4}>
                        <FormGroup label="GPUs" fieldId="sandbox-gpu">
                          <TextInput
                            id="sandbox-gpu"
                            data-testid="sandbox-gpu-input"
                            value={form.gpuCount}
                            onChange={(_event, value) =>
                              form.setGpuCount(value)
                            }
                            placeholder="1"
                            validated={form.gpuInvalid ? 'error' : 'default'}
                          />
                        </FormGroup>
                      </GridItem>
                    </Grid>
                    <HelperText>
                      <HelperTextItem
                        variant={form.gpuInvalid ? 'error' : 'default'}
                      >
                        {form.gpuInvalid
                          ? 'GPUs must be a whole number.'
                          : 'CPU and memory use Kubernetes quantities and apply as limits.'}
                      </HelperTextItem>
                    </HelperText>
                    <ExpandableSection
                      toggleText="Labels, annotations and platform options"
                      isExpanded={
                        form.isAdvancedExpanded || form.hasAdvancedError
                      }
                      onToggle={(_event, expanded) =>
                        form.setAdvancedExpanded(expanded)
                      }
                      data-testid="sandbox-advanced"
                    >
                      <FormSection>
                        <FormGroup
                          label="Labels"
                          fieldId="sandbox-labels"
                          role="group"
                        >
                          <KeyValueEditor
                            rows={form.labelRows}
                            onChange={form.setLabelRows}
                            keyPlaceholder="team"
                            valuePlaceholder="ml"
                            testIdPrefix="sandbox-label"
                            itemLabel="Label"
                            addLabel="Add label"
                          />
                          <FormHelperText>
                            <HelperText>
                              <HelperTextItem
                                variant={form.labelsError ? 'error' : 'default'}
                              >
                                {form.labelsError ??
                                  'Used to filter the sandbox list.'}
                              </HelperTextItem>
                            </HelperText>
                          </FormHelperText>
                        </FormGroup>
                        <FormGroup
                          label="Annotations"
                          fieldId="sandbox-annotations"
                          role="group"
                        >
                          <KeyValueEditor
                            rows={form.annotationRows}
                            onChange={form.setAnnotationRows}
                            testIdPrefix="sandbox-annotation"
                            itemLabel="Annotation"
                            addLabel="Add annotation"
                          />
                          <FormHelperText>
                            <HelperText>
                              <HelperTextItem
                                variant={
                                  form.annotationsError ? 'error' : 'default'
                                }
                                data-testid="sandbox-annotations-help"
                              >
                                {form.annotationsError ??
                                  'Metadata kept with the sandbox. Unlike labels, annotations cannot be filtered on.'}
                              </HelperTextItem>
                            </HelperText>
                          </FormHelperText>
                        </FormGroup>
                        <FormGroup
                          label="Log level"
                          fieldId="sandbox-log-level"
                        >
                          <FormSelect
                            id="sandbox-log-level"
                            data-testid="sandbox-log-level-select"
                            value={form.logLevel}
                            onChange={(_event, value) =>
                              form.setLogLevel(value)
                            }
                          >
                            <FormSelectOption
                              value=""
                              label="Gateway default"
                            />
                            {LOG_LEVELS.map((level) => (
                              <FormSelectOption
                                key={level}
                                value={level}
                                label={level}
                              />
                            ))}
                          </FormSelect>
                        </FormGroup>
                        <FormGroup
                          label="Runtime class"
                          fieldId="sandbox-runtime-class"
                        >
                          <TextInput
                            id="sandbox-runtime-class"
                            data-testid="sandbox-runtime-class-input"
                            value={form.runtimeClassName}
                            onChange={(_event, value) =>
                              form.setRuntimeClassName(value)
                            }
                            placeholder="Leave empty for the platform default"
                          />
                          <FormHelperText>
                            <HelperText>
                              <HelperTextItem>
                                A Kubernetes RuntimeClass, for example kata. The
                                Docker and VM compute drivers refuse a sandbox
                                that names one.
                              </HelperTextItem>
                            </HelperText>
                          </FormHelperText>
                        </FormGroup>
                        <FormGroup
                          label="Driver config"
                          fieldId="sandbox-driver-config"
                        >
                          <TextArea
                            id="sandbox-driver-config"
                            data-testid="sandbox-driver-config-input"
                            value={form.driverConfigText}
                            onChange={(_event, value) =>
                              form.setDriverConfigText(value)
                            }
                            rows={3}
                            resizeOrientation="vertical"
                            className="pf-v6-u-font-family-monospace"
                            placeholder='{"kubernetes": {"pod": {"node_selector": {"pool": "gpu"}}}}'
                            validated={
                              form.driverConfigError ? 'error' : 'default'
                            }
                          />
                          <FormHelperText>
                            <HelperText>
                              <HelperTextItem
                                variant={
                                  form.driverConfigError ? 'error' : 'default'
                                }
                                data-testid="sandbox-driver-config-help"
                              >
                                {form.driverConfigError ??
                                  'A JSON object keyed by compute driver name. The gateway refuses it unless its administrator has enabled allow_driver_config.'}
                              </HelperTextItem>
                            </HelperText>
                          </FormHelperText>
                        </FormGroup>
                      </FormSection>
                    </ExpandableSection>
                  </Form>
                </WizardStep>

                <WizardStep
                  name="Review"
                  id="review"
                  footer={{
                    nextButtonText: 'Create',
                    isNextDisabled: !form.isValid || isBusy,
                    isBackDisabled: isBusy,
                    isCancelHidden: isBusy,
                    nextButtonProps: {
                      isLoading: isBusy,
                      // @ts-expect-error data attributes pass through to the button
                      'data-testid': 'create-sandbox-submit',
                    },
                  }}
                >
                  <ReviewSummary workspace={workspace} form={form} />
                  {!form.canEditPolicy && (
                    <Alert
                      variant="danger"
                      isInline
                      className="pf-v6-u-mt-md"
                      title="The policy file has an error"
                      actionLinks={
                        <Button variant="link" isInline onClick={showFile}>
                          Show the file
                        </Button>
                      }
                    />
                  )}
                  {form.hasRunError && (
                    <Alert
                      variant="danger"
                      isInline
                      className="pf-v6-u-mt-md"
                      title="Run has a field to correct"
                    />
                  )}
                  {form.hasResourcesError && (
                    <Alert
                      variant="danger"
                      isInline
                      className="pf-v6-u-mt-md"
                      title="Resources has a field to correct"
                    />
                  )}
                  {createSandbox.isError && (
                    <Alert
                      variant="danger"
                      isInline
                      className="pf-v6-u-mt-md"
                      title="Create failed"
                    >
                      {(createSandbox.error as Error).message}
                    </Alert>
                  )}
                </WizardStep>
              </Wizard>
            </DrawerContentBody>
          </DrawerContent>
        </Drawer>
      </PageSection>
    </>
  );
};

export default CreateSandboxPage;
