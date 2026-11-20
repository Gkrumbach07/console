import { useState } from 'react';
import {
  ActionGroup,
  Alert,
  Button,
  Content,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Label,
  LabelGroup,
  List,
  ListItem,
  PageSection,
  ProgressStep,
  ProgressStepper,
  Radio,
  TextInput,
  Title,
} from '@patternfly/react-core';
import { CheckCircleIcon } from '@patternfly/react-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import {
  createProvider,
  importProviderProfiles,
  useProviderProfiles,
  useProviders,
} from '../api/providers';
import { runInSandbox } from '../api/sandboxRun';
import { createSandbox, getSandbox, uploadFile } from '../api/sandboxes';
import {
  AGENT_RECIPES,
  MODEL_SOURCE_LABELS,
  NAME_PATTERN,
  keyEnvVar,
  parseEndpoint,
  recipeFor,
  suggestedName,
  type AgentId,
  type QuickStartInput,
} from '../quickstart/recipes';
import {
  EMPTY_RUN,
  QuickStartError,
  STEP_TITLES,
  runQuickStart,
  stepsFor,
  type QuickStartApi,
  type RunState,
  type StepId,
} from '../quickstart/runRecipe';

type RunAgentPageProps = {
  workspace: string;
  // Opens the sandbox, on its terminal with the agent's command when one is
  // given.
  onOpenSandbox: (name: string, terminalCommand?: string[]) => void;
  onCancel: () => void;
};

const api: QuickStartApi = {
  importProfiles: importProviderProfiles,
  createProvider,
  createSandbox,
  getSandbox,
  runInSandbox,
  uploadFile,
};

type Failure = { step: StepId; message: string };

// What to try when a step fails, beside what the step itself said.
const failureAdvice = (failure: Failure): string | undefined => {
  switch (failure.step) {
    case 'profile':
      return 'A profile or a provider of this name may exist already: try again under another name.';
    case 'check':
      return 'Check the URL and the key. An endpoint on a private address, or one this gateway cannot resolve, is refused by the sandbox: its Logs tab says why. What was made so far is kept, so you can fix the provider and try again.';
    default:
      return undefined;
  }
};

// From nothing to an agent talking to a model: the person says which agent,
// where its model is and the key, and this sets up the profile, the provider
// and the sandbox the forms would otherwise ask for one by one
// (quickstart/recipes.ts).
const RunAgentPage: React.FC<RunAgentPageProps> = ({
  workspace,
  onOpenSandbox,
  onCancel,
}) => {
  const queryClient = useQueryClient();
  const providers = useProviders(workspace);
  const profiles = useProviderProfiles(workspace);

  const [agent, setAgent] = useState<AgentId>('opencode');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  // The name as typed; until it is, the one suggested for the endpoint.
  const [typedName, setTypedName] = useState<string | null>(null);

  const [run, setRun] = useState<RunState | null>(null);
  const [running, setRunning] = useState<StepId | undefined>();
  const [failure, setFailure] = useState<Failure | null>(null);

  const recipe = recipeFor(agent);
  const source = recipe.sources[0];
  const isOwnEndpoint = source === 'own-endpoint';
  const parsed = isOwnEndpoint ? parseEndpoint(baseUrl) : {};
  const name =
    typedName ??
    (isOwnEndpoint
      ? parsed.endpoint
        ? suggestedName(parsed.endpoint.host)
        : ''
      : recipe.id);

  const input: QuickStartInput = {
    agent,
    source,
    name,
    baseUrl,
    apiKey,
    model,
  };

  const taken =
    (providers.data ?? []).some((p) => p.metadata.name === name) ||
    (profiles.data ?? []).some((p) => p.id === name && p.scope === 'workspace');
  const nameError = !name
    ? undefined
    : !NAME_PATTERN.test(name)
      ? 'Lowercase letters, digits and hyphens, starting and ending with a letter or digit.'
      : taken
        ? `This workspace already has a provider or a profile called ${name}.`
        : undefined;
  const urlError = isOwnEndpoint && baseUrl.trim() ? parsed.error : undefined;
  const canRun =
    !!name &&
    !nameError &&
    apiKey.trim() !== '' &&
    (!isOwnEndpoint || !!parsed.endpoint);

  const start = async (from: RunState) => {
    setFailure(null);
    setRun(from);
    try {
      const finished = await runQuickStart(
        workspace,
        input,
        api,
        from,
        (state, step) => {
          setRun(state);
          setRunning(step);
          // The key is held only until the provider has it.
          if (state.done.includes('provider')) setApiKey('');
        },
      );
      setRun(finished);
    } catch (error) {
      const failed =
        error instanceof QuickStartError
          ? { step: error.step, message: error.message }
          : { step: 'profile' as StepId, message: (error as Error).message };
      setFailure(failed);
    } finally {
      setRunning(undefined);
      void queryClient.invalidateQueries();
    }
  };

  const header = (
    <PageSection>
      <Title headingLevel="h1">Run an agent</Title>
      <Content component="p">
        Pick an agent and say where its model is. The dashboard sets up what it
        needs in {workspace}: the service&apos;s profile, a provider holding
        your key, and a sandbox with the agent installed.
      </Content>
    </PageSection>
  );

  if (run) {
    const steps = stepsFor(input);
    const isReady = !failure && !running && run.done.length === steps.length;
    return (
      <>
        {header}
        <PageSection>
          {isReady && run.sandboxName ? (
            <EmptyState
              headingLevel="h2"
              titleText={`${recipe.name} is ready in ${run.sandboxName}`}
              icon={CheckCircleIcon}
              status="success"
              data-testid="run-agent-ready"
            >
              <EmptyStateBody>
                {run.model && (
                  <Content component="p">
                    It starts on <strong>{run.model}</strong>, through the
                    provider <strong>{name}</strong>. The key stays with the
                    gateway: the sandbox holds a placeholder for it.
                  </Content>
                )}
                {run.models && run.models.length > 1 && (
                  <LabelGroup
                    categoryName="Models the endpoint lists"
                    numLabels={8}
                  >
                    {run.models.map((id) => (
                      <Label key={id} isCompact variant="outline">
                        {id}
                      </Label>
                    ))}
                  </LabelGroup>
                )}
                <Content component="p">
                  The sandbox reaches only what its provider allows. Anything
                  else the agent tries is blocked and shows up on the
                  sandbox&apos;s Proposals tab, to allow there; an approval
                  takes effect in a few seconds, with no restart.
                  {recipe.alsoTries.length > 0 &&
                    ` ${recipe.name} tries ${recipe.alsoTries.join(', ')} when it starts and works without them.`}
                </Content>
              </EmptyStateBody>
              <EmptyStateFooter>
                <EmptyStateActions>
                  <Button
                    variant="primary"
                    onClick={() =>
                      onOpenSandbox(run.sandboxName ?? '', recipe.command)
                    }
                    data-testid="run-agent-open-terminal"
                  >
                    Open the terminal with {recipe.name}
                  </Button>
                </EmptyStateActions>
                <EmptyStateActions>
                  <Button
                    variant="link"
                    onClick={() => onOpenSandbox(run.sandboxName ?? '')}
                    data-testid="run-agent-open-sandbox"
                  >
                    Go to the sandbox
                  </Button>
                </EmptyStateActions>
              </EmptyStateFooter>
            </EmptyState>
          ) : (
            <>
              <ProgressStepper
                isVertical
                aria-label="Setting up the agent"
                data-testid="run-agent-progress"
              >
                {steps.map((id) => {
                  const isDone = run.done.includes(id);
                  const isFailed = failure?.step === id;
                  const isRunning = running === id;
                  return (
                    <ProgressStep
                      key={id}
                      id={`run-agent-step-${id}`}
                      titleId={`run-agent-step-${id}-title`}
                      variant={
                        isDone
                          ? 'success'
                          : isFailed
                            ? 'danger'
                            : isRunning
                              ? 'info'
                              : 'pending'
                      }
                      isCurrent={isRunning || isFailed}
                      description={
                        id === 'sandbox' && run.sandboxName
                          ? run.sandboxName
                          : id === 'check' && run.models
                            ? `${run.models.length} model${run.models.length === 1 ? '' : 's'} listed`
                            : undefined
                      }
                      data-testid={`run-agent-step-${id}`}
                    >
                      {STEP_TITLES[id]}
                    </ProgressStep>
                  );
                })}
              </ProgressStepper>
              {failure && (
                <Alert
                  variant="danger"
                  isInline
                  className="pf-v6-u-mt-md"
                  title={`${STEP_TITLES[failure.step]} failed`}
                  data-testid="run-agent-failure"
                  actionLinks={
                    <>
                      <Button
                        variant="link"
                        isInline
                        onClick={() => start(run)}
                        data-testid="run-agent-retry"
                      >
                        Try again
                      </Button>
                      {run.sandboxName && (
                        <Link
                          className="pf-v6-u-ml-md"
                          to={`/workspaces/${workspace}/sandboxes/${run.sandboxName}?tab=logs`}
                        >
                          Open the sandbox&apos;s logs
                        </Link>
                      )}
                      {run.done.length === 0 && (
                        <Button
                          variant="link"
                          isInline
                          className="pf-v6-u-ml-md"
                          onClick={() => {
                            setRun(null);
                            setFailure(null);
                          }}
                          data-testid="run-agent-back"
                        >
                          Back to the form
                        </Button>
                      )}
                    </>
                  }
                >
                  <Content component="p">{failure.message}</Content>
                  {failureAdvice(failure) && (
                    <Content component="small">
                      {failureAdvice(failure)}
                    </Content>
                  )}
                </Alert>
              )}
            </>
          )}
        </PageSection>
      </>
    );
  }

  return (
    <>
      {header}
      <PageSection>
        <Form
          isWidthLimited
          onSubmit={(event) => {
            event.preventDefault();
            if (canRun) void start(EMPTY_RUN);
          }}
        >
          <FormGroup
            label="Agent"
            role="radiogroup"
            fieldId="run-agent-agent"
            isStack
          >
            {AGENT_RECIPES.map((option) => (
              <Radio
                key={option.id}
                id={`run-agent-agent-${option.id}`}
                name="run-agent-agent"
                data-testid={`run-agent-agent-${option.id}`}
                label={option.name}
                description={option.description}
                isChecked={agent === option.id}
                onChange={() => {
                  setAgent(option.id);
                  setTypedName(null);
                }}
              />
            ))}
          </FormGroup>

          <FormGroup label="Model" fieldId="run-agent-source">
            <Content component="small">{MODEL_SOURCE_LABELS[source]}</Content>
          </FormGroup>
          {isOwnEndpoint && (
            <FormGroup label="URL" isRequired fieldId="run-agent-url">
              <TextInput
                id="run-agent-url"
                data-testid="run-agent-url"
                value={baseUrl}
                onChange={(_event, value) => setBaseUrl(value)}
                placeholder="https://models.example.com/v1"
                validated={urlError ? 'error' : 'default'}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem variant={urlError ? 'error' : 'default'}>
                    {urlError ??
                      'Where the OpenAI-compatible API is served, with its path: the address /models and /chat/completions are under.'}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          )}
          <FormGroup label="API key" isRequired fieldId="run-agent-key">
            <TextInput
              id="run-agent-key"
              data-testid="run-agent-key"
              type="password"
              value={apiKey}
              onChange={(_event, value) => setApiKey(value)}
              autoComplete="off"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Stored by the gateway and sent only to this service. The
                  sandbox never holds it.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          {isOwnEndpoint && (
            <FormGroup label="Model to start with" fieldId="run-agent-model">
              <TextInput
                id="run-agent-model"
                data-testid="run-agent-model"
                value={model}
                onChange={(_event, value) => setModel(value)}
                placeholder="Leave empty for the first model the endpoint lists"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    The endpoint is asked for its models once the sandbox is up,
                    so you do not need to know the ID.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          )}
          <FormGroup label="Name" isRequired fieldId="run-agent-name">
            <TextInput
              id="run-agent-name"
              data-testid="run-agent-name"
              value={name}
              onChange={(_event, value) => setTypedName(value)}
              placeholder="maas"
              validated={nameError ? 'error' : 'default'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem
                  variant={nameError ? 'error' : 'default'}
                  data-testid="run-agent-name-help"
                >
                  {nameError ??
                    'The provider is saved under this name, to attach to other sandboxes later.'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>

          <FormGroup label="What this sets up" fieldId="run-agent-summary">
            <List data-testid="run-agent-summary">
              <ListItem>
                A provider profile and a provider called{' '}
                <strong>{name || '…'}</strong>
                {isOwnEndpoint && parsed.endpoint
                  ? `, which let ${recipe.name} reach ${parsed.endpoint.host}:${parsed.endpoint.port} with your key`
                  : `, which let ${recipe.name} reach its service with your key`}
                .
              </ListItem>
              <ListItem>
                A sandbox from the community base image, which has {recipe.name}{' '}
                installed.
              </ListItem>
              {isOwnEndpoint && (
                <ListItem>
                  {recipe.name}&apos;s configuration in the sandbox, pointing it
                  at your endpoint and its models. The key is read from{' '}
                  <code>{name ? keyEnvVar(name) : '…'}</code>.
                </ListItem>
              )}
            </List>
          </FormGroup>

          <ActionGroup>
            <Button
              variant="primary"
              type="submit"
              isDisabled={!canRun}
              data-testid="run-agent-submit"
            >
              Run {recipe.name}
            </Button>
            <Button variant="link" onClick={onCancel}>
              Cancel
            </Button>
          </ActionGroup>
        </Form>
      </PageSection>
    </>
  );
};

export default RunAgentPage;
