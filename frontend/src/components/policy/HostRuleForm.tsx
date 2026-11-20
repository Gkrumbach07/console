import { useState } from 'react';
import {
  ActionGroup,
  Button,
  FormGroup,
  FormHelperText,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  Radio,
  TextInput,
} from '@patternfly/react-core';

import ListInput from '../ListInput';
import { generatedRuleName } from '../PolicyRuleEditor/utils';
import type { NetworkEndpoint, NetworkPolicyRule } from '../../types';

type Access = 'read-only' | 'read-write' | 'tcp';

type HostRuleFormProps = {
  // A rule to change rather than a new one: its one endpoint and its
  // programs fill the fields, and every other field of the endpoint and the
  // rule is kept as it was. Mount the form afresh (a `key`) for each rule.
  initialRule?: NetworkPolicyRule;
  submitLabel: string;
  onSubmit: (name: string, rule: NetworkPolicyRule) => void;
  onCancel: () => void;
};

// The gateway admits a connection only from a program a rule names, and it
// names the program by the binary the kernel ran (`/proc/<pid>/exe`), not by
// the command or a link to it. A guessed path misses: in the community base
// image `python3` is `/sandbox/.venv/bin/python3`, which runs
// `/sandbox/.uv/python/cpython-3.14.3-…/bin/python3.14`, so a rule for
// `/usr/bin/python3` admits nothing (measured on gateway 0.1.6). No list of
// "common programs" is offered for that reason: a blocked request becomes a
// proposal that names the exact binary, which is the reliable way to get it.

const accessOf = (endpoint?: NetworkEndpoint): Access =>
  !endpoint || endpoint.protocol === 'rest'
    ? endpoint?.access === 'NETWORK_ACCESS_PRESET_READ_WRITE'
      ? 'read-write'
      : 'read-only'
    : 'tcp';

export const programInvalidReason = (path: string): string | undefined =>
  path.startsWith('/') ? undefined : 'a program is a path from /';

// One host the sandbox may reach, asked the way a person thinks of it: where,
// what it may do there, and which programs may do it. Everything else the
// policy can say about an endpoint is in the policy file. It renders no form
// element, so it can sit inside the form of a page.
const HostRuleForm: React.FC<HostRuleFormProps> = ({
  initialRule,
  submitLabel,
  onSubmit,
  onCancel,
}) => {
  const initialEndpoint = initialRule?.endpoints?.[0];
  const [host, setHost] = useState(initialEndpoint?.host ?? '');
  const [port, setPort] = useState(
    String(initialEndpoint?.ports?.[0] ?? initialEndpoint?.port ?? 443),
  );
  const [access, setAccess] = useState<Access>(
    initialRule ? accessOf(initialEndpoint) : 'read-only',
  );
  const [programs, setPrograms] = useState<string[]>(
    initialRule
      ? (initialRule.binaries ?? []).map((b) => b.path ?? '').filter(Boolean)
      : ['/usr/bin/curl'],
  );

  const trimmedHost = host.trim();
  const portNumber = Number(port);
  const portInvalid =
    !/^[0-9]+$/.test(port) || portNumber < 1 || portNumber > 65535;
  const hostInvalid =
    trimmedHost === '*' || trimmedHost === '**' || /\s/.test(trimmedHost);
  const programsInvalid = programs.some((path) => programInvalidReason(path));
  const isValid =
    trimmedHost !== '' && !hostInvalid && !portInvalid && !programsInvalid;

  const submit = () => {
    if (!isValid) return;
    // What the fields say, over whatever else the endpoint being changed
    // carries. The fields that say how traffic is inspected are dropped
    // with plain TCP, which inspects nothing.
    const rest: NetworkEndpoint = { ...initialEndpoint };
    const enforcement = rest.enforcement;
    delete rest.protocol;
    delete rest.access;
    delete rest.enforcement;
    const where = { host: trimmedHost, port: portNumber, ports: [portNumber] };
    const endpoint: NetworkEndpoint =
      access === 'tcp'
        ? { ...rest, ...where }
        : {
            ...rest,
            ...where,
            protocol: 'rest',
            enforcement: enforcement || 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
            access:
              access === 'read-only'
                ? 'NETWORK_ACCESS_PRESET_READ_ONLY'
                : 'NETWORK_ACCESS_PRESET_READ_WRITE',
          };
    onSubmit(generatedRuleName(trimmedHost, portNumber), {
      ...initialRule,
      name: initialRule?.name ?? trimmedHost,
      endpoints: [endpoint],
      binaries: programs.map((path) => ({ path })),
    });
  };

  return (
    <>
      <Grid hasGutter>
        <GridItem span={9}>
          <FormGroup label="Host" isRequired fieldId="add-host-host">
            <TextInput
              id="add-host-host"
              data-testid="add-host-host"
              value={host}
              onChange={(_event, value) => setHost(value)}
              placeholder="pypi.org"
              validated={hostInvalid ? 'error' : 'default'}
            />
          </FormGroup>
        </GridItem>
        <GridItem span={3}>
          <FormGroup label="Port" isRequired fieldId="add-host-port">
            <TextInput
              id="add-host-port"
              data-testid="add-host-port"
              value={port}
              onChange={(_event, value) => setPort(value)}
              validated={portInvalid ? 'error' : 'default'}
            />
          </FormGroup>
        </GridItem>
        <GridItem span={12}>
          <HelperText>
            <HelperTextItem variant={hostInvalid ? 'error' : 'default'}>
              {hostInvalid
                ? 'A host name, or *.example.com for its subdomains. A bare * is not accepted.'
                : '*.example.com matches one level of subdomain, **.example.com any depth.'}
            </HelperTextItem>
          </HelperText>
        </GridItem>
      </Grid>
      <FormGroup
        label="What it may do"
        role="radiogroup"
        fieldId="add-host-access"
        isStack
      >
        <Radio
          id="add-host-read-only"
          name="add-host-access"
          data-testid="add-host-read-only"
          label="Read: download, fetch, call GET APIs"
          description="HTTP GET, HEAD and OPTIONS. The gateway inspects each request."
          isChecked={access === 'read-only'}
          onChange={() => setAccess('read-only')}
        />
        <Radio
          id="add-host-read-write"
          name="add-host-access"
          data-testid="add-host-read-write"
          label="Read and write: also POST, PUT, PATCH"
          description="Uploads and API calls that change things. DELETE stays blocked."
          isChecked={access === 'read-write'}
          onChange={() => setAccess('read-write')}
        />
        <Radio
          id="add-host-tcp"
          name="add-host-access"
          data-testid="add-host-tcp"
          label="Any traffic, not inspected"
          description="For a database, SSH or anything else that is not HTTP. The gateway sees only the host and port."
          isChecked={access === 'tcp'}
          onChange={() => setAccess('tcp')}
        />
      </FormGroup>
      <FormGroup label="From programs" fieldId="add-host-programs">
        <ListInput
          id="add-host-programs"
          data-testid="add-host-programs"
          aria-label="Programs"
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
              data-testid="add-host-programs-help"
            >
              {programsInvalid
                ? 'Each program is a full path, starting with /.'
                : programs.length === 0
                  ? 'With no program named, nothing in the sandbox can reach this host.'
                  : 'The file that runs, not a link to it (readlink -f $(command -v python3) in the sandbox prints it). Unsure? Keep curl: a program that is blocked shows up under Proposals with its exact path, to allow there.'}
            </HelperTextItem>
          </HelperText>
        </FormHelperText>
      </FormGroup>
      <ActionGroup>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={!isValid}
          data-testid="add-host-submit"
        >
          {submitLabel}
        </Button>
        <Button variant="link" onClick={onCancel} data-testid="add-host-cancel">
          Cancel
        </Button>
      </ActionGroup>
    </>
  );
};

export default HostRuleForm;
