// The policy of a sandbox about to be created, and the parts of it the
// create form edits: the network rules the sandbox gets on top of its
// providers, and the paths it may read and write. The policy itself is the
// one thing the form holds (as the text of its file, useCreateSandboxForm):
// each field reads its part of it and writes that part back, and leaves
// everything else as it was. A field the form has no input for, set in the
// file, therefore stays set, and policyExtras names it so it is not hidden.
//
// The starting point is upstream's restrictive default (basePolicy), which
// the gateway would not otherwise apply: a sandbox created without a policy
// falls back to the policy its image ships, and the community base image's is
// refused by gateway 0.1.6.

import { basePolicy } from './policyTemplates';
import type {
  NetworkEndpoint,
  NetworkPolicyRule,
  ProviderProfile,
  SandboxPolicy,
} from '../../types';

export const initialPolicy = (): SandboxPolicy => ({
  ...structuredCloneSafe(basePolicy),
  networkPolicies: {},
});

// basePolicy is shared; a policy that is edited gets its own copy.
const structuredCloneSafe = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

export const rulesOf = (
  policy: SandboxPolicy,
): Record<string, NetworkPolicyRule> => policy.networkPolicies ?? {};

export const withRules = (
  policy: SandboxPolicy,
  rules: Record<string, NetworkPolicyRule>,
): SandboxPolicy => ({ ...policy, networkPolicies: rules });

// A name for a rule that no other rule of the policy has: `pypi_org`, then
// `pypi_org_2`.
export const freeRuleName = (
  rules: Record<string, NetworkPolicyRule>,
  name: string,
): string => {
  let key = name;
  for (let n = 2; rules[key]; n += 1) key = `${name}_${n}`;
  return key;
};

export type PathAccess = 'readOnly' | 'readWrite';

export const pathsOf = (policy: SandboxPolicy, access: PathAccess): string[] =>
  policy.filesystem?.[access] ?? [];

export const withPaths = (
  policy: SandboxPolicy,
  access: PathAccess,
  paths: string[],
): SandboxPolicy => ({
  ...policy,
  filesystem: { ...policy.filesystem, [access]: paths },
});

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The fields of a policy that the form edits, and those it shows as they
// are. Anything else at the top of a policy is named by its key.
const FORM_FIELDS = new Set(['networkPolicies', 'filesystem']);
const NAMED_FIELDS = new Set(['version', 'process', 'landlock']);

// What the policy sets that the form has no input for, in words: the things
// a person edited in the file, or a file they imported, which the form keeps
// as they are. Empty for a policy the form could have built.
export const policyExtras = (policy: SandboxPolicy): string[] => {
  const extras: string[] = [];
  if (policy.version !== undefined && policy.version !== basePolicy.version) {
    extras.push(`policy version ${policy.version}`);
  }
  if (!sameJson(policy.process, basePolicy.process)) {
    const user = policy.process?.runAsUser || 'the image default user';
    const group = policy.process?.runAsGroup;
    extras.push(`runs as ${user}${group ? ` (group ${group})` : ''}`);
  }
  if (!sameJson(policy.landlock, basePolicy.landlock)) {
    extras.push(`Landlock ${policy.landlock?.compatibility ?? 'not set'}`);
  }
  // A false include_workdir is the proto default, so it reads as absent.
  if (policy.filesystem && !policy.filesystem.includeWorkdir) {
    extras.push('the working directory is not writable');
  }
  Object.keys(policy).forEach((key) => {
    if (FORM_FIELDS.has(key) || NAMED_FIELDS.has(key)) return;
    const value = (policy as Record<string, unknown>)[key];
    if (value === undefined || value === null) return;
    if (typeof value === 'object' && Object.keys(value as object).length === 0)
      return;
    if (key === 'networkMiddlewares') {
      const count = Object.keys(value as object).length;
      extras.push(`${count} network middleware${count === 1 ? '' : 's'}`);
      return;
    }
    extras.push(key);
  });
  return extras;
};

export const profileRuleName = (profileId: string): string =>
  `profile_${profileId.replace(/[^\p{L}\p{N}_]/gu, '_')}`;

// The hosts and programs a provider profile names, as a rule of the sandbox's
// own policy: the access the profile allows, without its credential. For a
// service that needs a key, attaching a provider of the profile is the way:
// it adds the same access and the key.
export const ruleFromProfile = (
  profile: ProviderProfile,
): NetworkPolicyRule => ({
  name: profile.displayName || profile.id,
  endpoints: (profile.networkEndpoints ?? []).map(
    (endpoint) => ({ ...endpoint }) as NetworkEndpoint,
  ),
  binaries: (profile.binaries ?? []).map((binary) => ({ path: binary.path })),
});

const accessWords: Record<string, string> = {
  NETWORK_ACCESS_PRESET_READ_ONLY: 'read-only',
  NETWORK_ACCESS_PRESET_READ_WRITE: 'read-write',
  NETWORK_ACCESS_PRESET_FULL: 'full',
};

// One endpoint as a person reads it: `github.com:443, read-only`, or the
// methods its rules allow when it spells them out.
export const describeEndpoint = (endpoint: NetworkEndpoint): string => {
  const ports = endpoint.ports?.length
    ? endpoint.ports
    : endpoint.port
      ? [endpoint.port]
      : [];
  const where = `${endpoint.host ?? '?'}${ports.length ? `:${ports.join(',')}` : ''}${endpoint.path ?? ''}`;
  if (!endpoint.protocol || endpoint.protocol === 'tcp') {
    return `${where}, any traffic (not inspected)`;
  }
  if (endpoint.rules?.length) {
    // `GET, HEAD on any path; POST /**/git-upload-pack`.
    const anyPath: string[] = [];
    const scoped: string[] = [];
    endpoint.rules.forEach((rule) => {
      const method = rule.allow?.method ?? '*';
      const path = rule.allow?.path;
      if (!path || path === '**' || path === '/**') {
        anyPath.push(method);
      } else {
        scoped.push(`${method} ${path}`);
      }
    });
    const parts = [
      ...(anyPath.length ? [`${anyPath.join(', ')} on any path`] : []),
      ...scoped,
    ];
    return `${where}: ${parts.join('; ')}`;
  }
  const access = accessWords[String(endpoint.access ?? '')];
  return access ? `${where}, ${access}` : where;
};

export const pathLines = (text: string): string[] => [
  ...new Set(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  ),
];
