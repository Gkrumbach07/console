import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextArea,
  TextInput,
} from '@patternfly/react-core';

import { useImportProviderProfiles } from '../api/providers';
import type {
  ImportProfileRequest,
  ProfileCredentialInput,
  ProfileDiagnostic,
  ProfileNetworkEndpoint,
  ProviderProfileCategory,
} from '../types';
import UpstreamProfilesLink from './provider/UpstreamProfilesLink';

type CreateProfileModalProps = {
  workspace: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

// A credential as the form holds it. The environment variables are kept as
// the text that was typed and split when the profile is sent: split on every
// keystroke and joined again for display, a comma vanished as soon as it was
// typed, and a second variable could not be entered.
type CredentialRow = {
  name: string;
  envVarsText: string;
  required: boolean;
  // How the gateway's proxy puts the credential on a request. "none" leaves
  // it to the program in the sandbox, which then sees only the placeholder.
  authStyle: AuthStyle;
  headerName: string;
  queryParam: string;
};

type AuthStyle = 'bearer' | 'header' | 'query' | 'none';

const AUTH_STYLES: { value: AuthStyle; label: string }[] = [
  { value: 'bearer', label: 'Bearer token (Authorization header)' },
  { value: 'header', label: 'API key in a header' },
  { value: 'query', label: 'Query parameter' },
  { value: 'none', label: 'Not injected by the proxy' },
];

const newCredential = (): CredentialRow => ({
  name: '',
  envVarsText: '',
  // Every example profile upstream publishes marks its credentials required.
  required: true,
  authStyle: 'bearer',
  headerName: '',
  queryParam: '',
});

// An endpoint as the form holds it. "rest" is what lets the gateway inspect
// the traffic (and so inject a credential and apply access); "" is TCP only.
type EndpointRow = {
  host: string;
  port?: number;
  protocol: 'rest' | '';
  access: string;
  enforcement: string;
  allowUninspectedCredentials: boolean;
};

const newEndpoint = (): EndpointRow => ({
  host: '',
  protocol: 'rest',
  access: 'NETWORK_ACCESS_PRESET_READ_WRITE',
  enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
  allowUninspectedCredentials: false,
});

const ACCESS_PRESETS = [
  { value: 'NETWORK_ACCESS_PRESET_READ_ONLY', label: 'Read only (GET, HEAD)' },
  { value: 'NETWORK_ACCESS_PRESET_READ_WRITE', label: 'Read and write' },
  { value: 'NETWORK_ACCESS_PRESET_FULL', label: 'Full' },
];

const ENFORCEMENT_MODES = [
  { value: 'NETWORK_ENFORCEMENT_MODE_ENFORCE', label: 'Enforce' },
  { value: 'NETWORK_ENFORCEMENT_MODE_AUDIT', label: 'Audit (log only)' },
];

const endpointOf = (
  row: EndpointRow,
  hasCredentials: boolean,
): ProfileNetworkEndpoint => ({
  host: row.host.trim(),
  ...(row.port ? { port: row.port } : {}),
  ...(row.protocol === 'rest' ? { protocol: 'rest', access: row.access } : {}),
  enforcement: row.enforcement,
  ...(row.protocol === '' && hasCredentials && row.allowUninspectedCredentials
    ? { allowUninspectedCredentials: true }
    : {}),
});

const pathsOf = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

// A diagnostic's field as the form calls it: "endpoints[0].tls" is the first
// endpoint row.
const diagnosticField = (diagnostic: ProfileDiagnostic): string => {
  if (!diagnostic.field) return '';
  const endpoint = /^endpoints\[(\d+)\]/.exec(diagnostic.field);
  if (endpoint) return `Endpoint ${Number(endpoint[1]) + 1}: `;
  if (diagnostic.field.startsWith('credentials')) return 'Credentials: ';
  if (diagnostic.field.startsWith('binaries')) return 'Programs: ';
  return `${diagnostic.field}: `;
};

// The environment variables a row names: what stands between the commas,
// without the space around it and without what is empty.
const envVarsOf = (text: string): string[] =>
  text
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

// The credential a row describes. One that names no environment variable
// declares none, and is stored under its own name.
const credentialOf = (row: CredentialRow): ProfileCredentialInput => {
  const envVars = envVarsOf(row.envVarsText);
  return {
    name: row.name,
    required: row.required,
    ...(envVars.length > 0 ? { envVars } : {}),
    ...(row.authStyle === 'bearer'
      ? { authStyle: 'bearer', headerName: 'authorization' }
      : {}),
    ...(row.authStyle === 'header'
      ? { authStyle: 'header', headerName: row.headerName.trim() }
      : {}),
    ...(row.authStyle === 'query'
      ? { authStyle: 'query', queryParam: row.queryParam.trim() }
      : {}),
  };
};

const CATEGORIES: { value: ProviderProfileCategory; label: string }[] = [
  { value: 'INFERENCE', label: 'Inference' },
  { value: 'AGENT', label: 'Agent' },
  { value: 'SOURCE_CONTROL', label: 'Source control' },
  { value: 'MESSAGING', label: 'Messaging' },
  { value: 'DATA', label: 'Data' },
  { value: 'KNOWLEDGE', label: 'Knowledge' },
  { value: 'OTHER', label: 'Other' },
];

const CreateProfileModal: React.FC<CreateProfileModalProps> = ({
  workspace,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ProviderProfileCategory>('OTHER');
  const [inferenceCapable, setInferenceCapable] = useState(false);
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
  const [binariesText, setBinariesText] = useState('');
  const importProfiles = useImportProviderProfiles(workspace);

  const close = () => {
    setId('');
    setDisplayName('');
    setDescription('');
    setCategory('OTHER');
    setInferenceCapable(false);
    setCredentials([]);
    setEndpoints([]);
    setBinariesText('');
    importProfiles.reset();
    onClose();
  };

  const binaries = pathsOf(binariesText);
  const updateCredential = (index: number, change: Partial<CredentialRow>) =>
    setCredentials((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...change } : r)),
    );
  const updateEndpoint = (index: number, change: Partial<EndpointRow>) =>
    setEndpoints((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...change } : r)),
    );

  const submit = () => {
    const hasCredentials = credentials.length > 0;
    const profile: ImportProfileRequest = {
      id,
      displayName,
      description: description || undefined,
      category,
      inferenceCapable,
      credentials: hasCredentials ? credentials.map(credentialOf) : undefined,
      networkEndpoints:
        endpoints.length > 0
          ? endpoints.map((row) => endpointOf(row, hasCredentials))
          : undefined,
      binaries:
        binaries.length > 0 ? binaries.map((path) => ({ path })) : undefined,
    };
    importProfiles.mutate([profile], {
      onSuccess: (resp) => {
        if (resp.imported) {
          onSuccess?.();
          close();
        }
      },
    });
  };

  const diagnostics = importProfiles.data?.diagnostics ?? [];
  // The gateway answers a refused import with success and imported: false,
  // and says why in the diagnostics.
  const refused =
    importProfiles.data !== undefined && !importProfiles.data.imported;

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={close}
      aria-label="Create provider profile"
    >
      <ModalHeader title="Create provider profile" />
      <ModalBody>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Alert
            variant="info"
            isInline
            isPlain
            title="For one HTTP or TCP service"
            data-testid="profile-form-scope"
          >
            A profile says which credentials a provider of this type holds,
            which endpoints a sandbox may reach with them, and which programs
            may connect. For L7 rules, MCP or token grants, start from{' '}
            <UpstreamProfilesLink /> and use Import from files.
          </Alert>
          <FormGroup label="Profile ID" isRequired fieldId="profile-id">
            <TextInput
              id="profile-id"
              data-testid="profile-id-input"
              isRequired
              value={id}
              onChange={(_event, value) => setId(value)}
              placeholder="e.g. my-custom-llm"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Lowercase slug used as the provider type when creating
                  providers
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup
            label="Display name"
            isRequired
            fieldId="profile-display-name"
          >
            <TextInput
              id="profile-display-name"
              data-testid="profile-display-name-input"
              isRequired
              value={displayName}
              onChange={(_event, value) => setDisplayName(value)}
            />
          </FormGroup>
          <FormGroup label="Description" fieldId="profile-description">
            <TextArea
              id="profile-description"
              data-testid="profile-description-input"
              value={description}
              onChange={(_event, value) => setDescription(value)}
              rows={2}
            />
          </FormGroup>
          <FormGroup label="Category" isRequired fieldId="profile-category">
            <FormSelect
              id="profile-category"
              data-testid="profile-category-select"
              value={category}
              onChange={(_event, value) =>
                setCategory(value as ProviderProfileCategory)
              }
            >
              {CATEGORIES.map((cat) => (
                <FormSelectOption
                  key={cat.value}
                  value={cat.value}
                  label={cat.label}
                />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup fieldId="profile-inference">
            <Checkbox
              id="profile-inference"
              data-testid="profile-inference-checkbox"
              label="Inference capable"
              isChecked={inferenceCapable}
              onChange={(_event, checked) => setInferenceCapable(checked)}
            />
          </FormGroup>
          <FormGroup
            label="Credentials"
            fieldId="profile-credentials"
            role="group"
          >
            {credentials.map((cred, index) => (
              <Grid hasGutter key={index} className="pf-v6-u-mb-md">
                <GridItem span={4}>
                  <TextInput
                    id={`cred-name-${index}`}
                    data-testid={`cred-name-${index}`}
                    value={cred.name}
                    onChange={(_event, value) =>
                      updateCredential(index, { name: value })
                    }
                    placeholder="Credential name (e.g. api_key)"
                    aria-label="Credential name"
                  />
                </GridItem>
                <GridItem span={6}>
                  <TextInput
                    id={`cred-env-${index}`}
                    data-testid={`cred-env-${index}`}
                    value={cred.envVarsText}
                    onChange={(_event, value) =>
                      updateCredential(index, { envVarsText: value })
                    }
                    placeholder="Env vars in the sandbox (e.g. ACME_API_KEY)"
                    aria-label="Environment variables"
                  />
                </GridItem>
                <GridItem span={2}>
                  <Checkbox
                    id={`cred-required-${index}`}
                    data-testid={`cred-required-${index}`}
                    label="Required"
                    isChecked={cred.required}
                    onChange={(_event, checked) =>
                      updateCredential(index, { required: checked })
                    }
                  />
                </GridItem>

                <GridItem span={4}>
                  <FormSelect
                    id={`cred-auth-${index}`}
                    data-testid={`cred-auth-${index}`}
                    value={cred.authStyle}
                    onChange={(_event, value) =>
                      updateCredential(index, {
                        authStyle: value as AuthStyle,
                      })
                    }
                    aria-label="How the proxy sends it"
                  >
                    {AUTH_STYLES.map((style) => (
                      <FormSelectOption
                        key={style.value}
                        value={style.value}
                        label={style.label}
                      />
                    ))}
                  </FormSelect>
                </GridItem>
                <GridItem span={6}>
                  {cred.authStyle === 'header' && (
                    <TextInput
                      id={`cred-header-${index}`}
                      data-testid={`cred-header-${index}`}
                      value={cred.headerName}
                      onChange={(_event, value) =>
                        updateCredential(index, { headerName: value })
                      }
                      placeholder="Header name (e.g. x-api-key)"
                      aria-label="Header name"
                    />
                  )}
                  {cred.authStyle === 'query' && (
                    <TextInput
                      id={`cred-query-${index}`}
                      data-testid={`cred-query-${index}`}
                      value={cred.queryParam}
                      onChange={(_event, value) =>
                        updateCredential(index, { queryParam: value })
                      }
                      placeholder="Query parameter (e.g. key)"
                      aria-label="Query parameter"
                    />
                  )}
                </GridItem>
                <GridItem span={2}>
                  <Button
                    variant="link"
                    onClick={() =>
                      setCredentials((rows) =>
                        rows.filter((_, i) => i !== index),
                      )
                    }
                    data-testid={`cred-remove-${index}`}
                  >
                    Remove
                  </Button>
                </GridItem>
              </Grid>
            ))}
            <Button
              variant="link"
              isInline
              onClick={() =>
                setCredentials((rows) => [...rows, newCredential()])
              }
              data-testid="cred-add"
            >
              Add credential
            </Button>
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  The secrets a provider of this type holds. A sandbox sees each
                  one as a placeholder in its env vars, and the gateway&apos;s
                  proxy swaps in the real value on requests to the endpoints
                  below.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup
            label="Network endpoints"
            fieldId="profile-endpoints"
            role="group"
          >
            {endpoints.map((ep, index) => (
              <Grid hasGutter key={index} className="pf-v6-u-mb-md">
                <GridItem span={6}>
                  <TextInput
                    id={`endpoint-host-${index}`}
                    data-testid={`endpoint-host-${index}`}
                    value={ep.host}
                    onChange={(_event, value) =>
                      updateEndpoint(index, { host: value })
                    }
                    placeholder="Host (e.g. api.example.com)"
                    aria-label="Endpoint host"
                  />
                </GridItem>
                <GridItem span={2}>
                  <TextInput
                    id={`endpoint-port-${index}`}
                    data-testid={`endpoint-port-${index}`}
                    type="number"
                    value={ep.port ?? ''}
                    onChange={(_event, value) =>
                      updateEndpoint(index, {
                        port: value ? Number(value) : undefined,
                      })
                    }
                    placeholder="Port"
                    aria-label="Endpoint port"
                  />
                </GridItem>
                <GridItem span={4}>
                  <FormSelect
                    id={`endpoint-protocol-${index}`}
                    data-testid={`endpoint-protocol-${index}`}
                    value={ep.protocol}
                    onChange={(_event, value) =>
                      updateEndpoint(index, {
                        protocol: value as EndpointRow['protocol'],
                      })
                    }
                    aria-label="Protocol"
                  >
                    <FormSelectOption value="rest" label="HTTP, inspected" />
                    <FormSelectOption value="" label="TCP only" />
                  </FormSelect>
                </GridItem>

                <GridItem span={4}>
                  {ep.protocol === 'rest' && (
                    <FormSelect
                      id={`endpoint-access-${index}`}
                      data-testid={`endpoint-access-${index}`}
                      value={ep.access}
                      onChange={(_event, value) =>
                        updateEndpoint(index, { access: value })
                      }
                      aria-label="Access"
                    >
                      {ACCESS_PRESETS.map((preset) => (
                        <FormSelectOption
                          key={preset.value}
                          value={preset.value}
                          label={preset.label}
                        />
                      ))}
                    </FormSelect>
                  )}
                </GridItem>
                <GridItem span={4}>
                  <FormSelect
                    id={`endpoint-enforcement-${index}`}
                    data-testid={`endpoint-enforcement-${index}`}
                    value={ep.enforcement}
                    onChange={(_event, value) =>
                      updateEndpoint(index, { enforcement: value })
                    }
                    aria-label="Enforcement"
                  >
                    {ENFORCEMENT_MODES.map((mode) => (
                      <FormSelectOption
                        key={mode.value}
                        value={mode.value}
                        label={mode.label}
                      />
                    ))}
                  </FormSelect>
                </GridItem>
                <GridItem span={4}>
                  <Button
                    variant="link"
                    onClick={() =>
                      setEndpoints((rows) => rows.filter((_, i) => i !== index))
                    }
                    data-testid={`endpoint-remove-${index}`}
                  >
                    Remove
                  </Button>
                </GridItem>

                {ep.protocol === '' && credentials.length > 0 && (
                  <GridItem span={12}>
                    <Checkbox
                      id={`endpoint-uninspected-${index}`}
                      data-testid={`endpoint-uninspected-${index}`}
                      label="Let credentials through uninspected"
                      description="The gateway refuses credentials on a TCP-only endpoint unless you allow it here. The proxy cannot inject them, so the program must send the value itself."
                      isChecked={ep.allowUninspectedCredentials}
                      onChange={(_event, checked) =>
                        updateEndpoint(index, {
                          allowUninspectedCredentials: checked,
                        })
                      }
                    />
                  </GridItem>
                )}
              </Grid>
            ))}
            <Button
              variant="link"
              isInline
              onClick={() => setEndpoints((rows) => [...rows, newEndpoint()])}
              data-testid="endpoint-add"
            >
              Add endpoint
            </Button>
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  What a sandbox with this provider attached may reach. HTTP
                  endpoints are inspected, so the proxy can add the credential
                  and hold requests to the access you choose.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup
            label="Programs allowed to connect"
            fieldId="profile-binaries"
          >
            <TextArea
              id="profile-binaries"
              data-testid="profile-binaries-input"
              value={binariesText}
              onChange={(_event, value) => setBinariesText(value)}
              rows={3}
              placeholder={'/usr/local/bin/claude\n/usr/bin/curl'}
              aria-label="Programs allowed to connect"
            />
            <FormHelperText>
              <HelperText>
                {endpoints.length > 0 && binaries.length === 0 ? (
                  <HelperTextItem
                    variant="warning"
                    data-testid="profile-binaries-warning"
                  >
                    No program is named, so no process in a sandbox can reach
                    these endpoints: the gateway matches the calling binary.
                  </HelperTextItem>
                ) : (
                  <HelperTextItem>
                    One path per line, as installed in your sandbox image. A
                    glob such as /usr/lib/node_modules/** is allowed.
                  </HelperTextItem>
                )}
              </HelperText>
            </FormHelperText>
          </FormGroup>
          {importProfiles.isError && (
            <Alert variant="danger" isInline title="Import failed">
              {(importProfiles.error as Error).message}
            </Alert>
          )}
          {diagnostics.length > 0 && (
            <Alert
              variant={refused ? 'danger' : 'warning'}
              isInline
              title={
                refused
                  ? 'The gateway did not create the profile'
                  : 'The gateway created the profile with warnings'
              }
              data-testid="profile-diagnostics"
            >
              <ul>
                {diagnostics.map((d, i) => (
                  <li key={i}>
                    {diagnosticField(d)}
                    {d.message}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={!id || !displayName || importProfiles.isPending}
          isLoading={importProfiles.isPending}
          data-testid="create-profile-submit"
        >
          Create profile
        </Button>
        <Button variant="link" onClick={close}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CreateProfileModal;
