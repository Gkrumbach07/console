import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';

import {
  createProvider,
  importProviderProfiles,
  useProviderProfiles,
  useProviders,
} from '../../api/providers';
import {
  NAME_PATTERN,
  RUN_PRESETS,
  keyEnvVar,
  parseEndpoint,
  profileForService,
  providerForService,
  suggestedName,
  type OwnServiceInput,
} from '../../sandboxPresets/presets';
import ListInput from '../ListInput';
import { programInvalidReason } from '../policy/HostRuleForm';

type OwnServiceProviderModalProps = {
  workspace: string;
  isOpen: boolean;
  onClose: () => void;
  // The provider that was made, by name.
  onCreated?: (name: string) => void;
  // The programs offered to start with, besides curl: those of what the
  // sandbox being created will run.
  defaultPrograms?: string[];
};

const CURL = '/usr/bin/curl';

// A provider for a service the gateway has no profile for, from the two
// things a person has: its URL and a key. A provider is made from a provider
// profile, so this writes the profile first (the host, how the key is sent,
// which programs may use it) and then the provider that holds the key. It is
// what the Create profile and Add provider forms do, in one step, for the
// common case of an HTTP service with a bearer key.
const OwnServiceProviderModal: React.FC<OwnServiceProviderModalProps> = ({
  workspace,
  isOpen,
  onClose,
  onCreated,
  defaultPrograms = [],
}) => {
  const queryClient = useQueryClient();
  const providers = useProviders(workspace);
  const profiles = useProviderProfiles(workspace);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [typedName, setTypedName] = useState<string | null>(null);
  const [isModelApi, setModelApi] = useState(true);
  const [programs, setPrograms] = useState<string[]>([
    ...new Set([...defaultPrograms, CURL]),
  ]);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The profile of a first try that got no further: it is not imported twice.
  const [importedProfile, setImportedProfile] = useState<string | null>(null);

  const parsed = parseEndpoint(baseUrl);
  const name =
    typedName ?? (parsed.endpoint ? suggestedName(parsed.endpoint.host) : '');
  const taken =
    importedProfile !== name &&
    ((providers.data ?? []).some((p) => p.metadata.name === name) ||
      (profiles.data ?? []).some(
        (p) => p.id === name && p.scope === 'workspace',
      ));
  const nameError = !name
    ? undefined
    : !NAME_PATTERN.test(name)
      ? 'Lowercase letters, digits and hyphens, starting and ending with a letter or digit.'
      : taken
        ? `This workspace already has a provider or a profile called ${name}.`
        : undefined;
  const urlError = baseUrl.trim() ? parsed.error : undefined;
  const programsInvalid = programs.some((path) => programInvalidReason(path));
  const canSave =
    !!parsed.endpoint &&
    !!name &&
    !nameError &&
    apiKey.trim() !== '' &&
    !programsInvalid &&
    !isSaving;

  const close = () => {
    setBaseUrl('');
    setApiKey('');
    setTypedName(null);
    setModelApi(true);
    setPrograms([...new Set([...defaultPrograms, CURL])]);
    setError(null);
    setImportedProfile(null);
    onClose();
  };

  const save = async () => {
    if (!parsed.endpoint) return;
    const input: OwnServiceInput = {
      name,
      baseUrl,
      apiKey,
      programs,
      isModelApi,
    };
    setSaving(true);
    setError(null);
    try {
      if (importedProfile !== name) {
        const answer = await importProviderProfiles(workspace, [
          profileForService(input, parsed.endpoint),
        ]);
        if (!answer.imported) {
          const why = (answer.diagnostics ?? [])
            .map((diagnostic) =>
              diagnostic.field
                ? `${diagnostic.field}: ${diagnostic.message}`
                : diagnostic.message,
            )
            .join('; ');
          throw new Error(why || 'The gateway did not take the profile.');
        }
        setImportedProfile(name);
      }
      await createProvider(
        workspace,
        providerForService(input, parsed.endpoint, workspace),
      );
      void queryClient.invalidateQueries();
      onCreated?.(name);
      close();
    } catch (failure) {
      setError((failure as Error).message);
      void queryClient.invalidateQueries();
    } finally {
      setSaving(false);
    }
  };

  const offered = RUN_PRESETS.filter(
    (preset) =>
      preset.programs.length > 0 &&
      !preset.programs.every((path) => programs.includes(path)),
  );

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={isSaving ? undefined : close}
      aria-label="Add a provider by URL and key"
    >
      <ModalHeader
        title="Add a provider by URL and key"
        description="For an HTTP service the gateway has no profile for, such as a model API you host. The key is sent as a bearer token, to this host only."
      />
      <ModalBody>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) void save();
          }}
        >
          <FormGroup label="URL" isRequired fieldId="own-service-url">
            <TextInput
              id="own-service-url"
              data-testid="own-service-url"
              value={baseUrl}
              onChange={(_event, value) => setBaseUrl(value)}
              placeholder="https://models.example.com/v1"
              validated={urlError ? 'error' : 'default'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={urlError ? 'error' : 'default'}>
                  {urlError ??
                    'Where the service is served, with its path. The sandbox may reach this host and port, and nothing else, with the key.'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="API key" isRequired fieldId="own-service-key">
            <TextInput
              id="own-service-key"
              data-testid="own-service-key"
              type="password"
              value={apiKey}
              onChange={(_event, value) => setApiKey(value)}
              autoComplete="off"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Stored by the gateway. A sandbox holds a placeholder in{' '}
                  <code>{name ? keyEnvVar(name) : '…_API_KEY'}</code>, which the
                  gateway&apos;s proxy swaps for the key on the way out.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Name" isRequired fieldId="own-service-name">
            <TextInput
              id="own-service-name"
              data-testid="own-service-name"
              value={name}
              onChange={(_event, value) => setTypedName(value)}
              placeholder="maas"
              validated={nameError ? 'error' : 'default'}
            />
            {nameError && (
              <FormHelperText>
                <HelperText>
                  <HelperTextItem
                    variant="error"
                    data-testid="own-service-name-help"
                  >
                    {nameError}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            )}
          </FormGroup>
          <FormGroup fieldId="own-service-model-api">
            <Checkbox
              id="own-service-model-api"
              data-testid="own-service-model-api"
              label="It is an OpenAI-compatible model API"
              description="With /models and /chat/completions under the URL. A sandbox that runs OpenCode is then configured for its models."
              isChecked={isModelApi}
              onChange={(_event, checked) => setModelApi(checked)}
            />
          </FormGroup>
          <FormGroup
            label="Programs that may use it"
            fieldId="own-service-programs"
          >
            <ListInput
              id="own-service-programs"
              data-testid="own-service-programs"
              aria-label="Programs that may use it"
              values={programs}
              onChange={setPrograms}
              placeholder="/usr/bin/curl, then Enter"
              invalidReason={programInvalidReason}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem
                  variant={
                    programsInvalid
                      ? 'error'
                      : programs.length === 0
                        ? 'warning'
                        : 'default'
                  }
                  data-testid="own-service-programs-help"
                >
                  {programsInvalid
                    ? 'Each program is a full path, starting with /.'
                    : programs.length === 0
                      ? 'With no program named, nothing in a sandbox can use this provider.'
                      : 'Only these may reach the service with the key, by the file that runs. Create sandbox adds the programs of what it runs when they are missing.'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
            {offered.map((preset) => (
              <Button
                key={preset.id}
                variant="link"
                isInline
                className="pf-v6-u-mr-md"
                onClick={() =>
                  setPrograms([...new Set([...programs, ...preset.programs])])
                }
                data-testid={`own-service-add-${preset.id}`}
              >
                + {preset.name}
              </Button>
            ))}
          </FormGroup>
          {error && (
            <Alert
              variant="danger"
              isInline
              title="The provider was not added"
              data-testid="own-service-error"
            >
              {error}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={() => void save()}
          isDisabled={!canSave}
          isLoading={isSaving}
          data-testid="own-service-submit"
        >
          Add provider
        </Button>
        <Button variant="link" onClick={close} isDisabled={isSaving}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default OwnServiceProviderModal;
