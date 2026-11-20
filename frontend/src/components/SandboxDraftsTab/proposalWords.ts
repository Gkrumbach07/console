import { describeEndpoint } from '../policy/policyBuilder';
import type {
  NetworkEndpoint,
  NetworkPolicyRule,
  PolicyChunk,
  SandboxPolicy,
} from '../../types';

// A proposal as the person whose agent was blocked reads it: which program
// was stopped from reaching where, and what allowing it would let through.
// Everything here is read from the structured chunk the gateway returns
// (`binary`, `proposed_rule`, the current and candidate effective policies),
// never from the text of a log line, whose wording is not an interface.

const programName = (path: string): string =>
  path.split('/').filter(Boolean).pop() ?? path;

const endpointTarget = (endpoint: NetworkEndpoint): string => {
  const ports = endpoint.ports?.length
    ? endpoint.ports
    : endpoint.port
      ? [endpoint.port]
      : [];
  return `${endpoint.host ?? '?'}${ports.length ? `:${ports.join(',')}` : ''}`;
};

export type ProposalHeadline = {
  // `curl`, or undefined when the proposal names no program.
  program?: string;
  // The full path, for the line under the headline.
  programPath?: string;
  // `pypi.org:443`, or `pypi.org:443 and 2 more`.
  target?: string;
  // The gateway saw the request denied (it counted hits), as opposed to a
  // proposal an agent in the sandbox submitted on its own.
  wasBlocked: boolean;
};

export const proposalHeadline = (chunk: PolicyChunk): ProposalHeadline => {
  const rule = chunk.proposedRule;
  const programPath =
    chunk.binary || (rule?.binaries ?? []).find((b) => b.path)?.path;
  const endpoints = (rule?.endpoints ?? []).filter((e) => e.host);
  const target =
    endpoints.length === 0
      ? undefined
      : endpoints.length === 1
        ? endpointTarget(endpoints[0])
        : `${endpointTarget(endpoints[0])} and ${endpoints.length - 1} more`;
  return {
    program: programPath ? programName(programPath) : undefined,
    programPath,
    target,
    wasBlocked: chunk.hitCount > 0,
  };
};

// What approving lets through, in one sentence.
export const allowSentence = (chunk: PolicyChunk): string | undefined => {
  const rule = chunk.proposedRule;
  const endpoints = rule?.endpoints ?? [];
  const programs = (rule?.binaries ?? []).map((b) => b.path).filter(Boolean);
  if (endpoints.length === 0) return undefined;
  const where = endpoints.map(describeEndpoint).join('; ');
  if (programs.length === 0) {
    return `It names no program, so allowing it lets nothing through: the gateway admits a connection only from a program a rule names. Change it to add one.`;
  }
  return `Allows ${programs.join(', ')} to reach ${where}. Other programs stay blocked.`;
};

export type PolicyChange = {
  kind: 'adds' | 'changes' | 'removes';
  name: string;
  endpoints: string[];
  programs: string[];
};

const ruleSummary = (
  kind: PolicyChange['kind'],
  name: string,
  rule: NetworkPolicyRule,
): PolicyChange => ({
  kind,
  name: rule.name || name,
  endpoints: (rule.endpoints ?? []).map(describeEndpoint),
  programs: (rule.binaries ?? []).map((b) => b.path ?? '').filter(Boolean),
});

// The difference between what the sandbox enforces now and what it would
// enforce once the proposal is approved, rule by rule. The gateway sends
// both whole policies with each chunk; when it does not, the proposed rule
// is all that can be said.
export const proposalChanges = (chunk: PolicyChunk): PolicyChange[] => {
  const current: SandboxPolicy['networkPolicies'] =
    chunk.currentEffectivePolicy?.networkPolicies ?? {};
  const candidate = chunk.candidateEffectivePolicy?.networkPolicies;
  if (!candidate) {
    return chunk.proposedRule
      ? [ruleSummary('adds', chunk.ruleName ?? '', chunk.proposedRule)]
      : [];
  }
  const changes: PolicyChange[] = [];
  Object.entries(candidate).forEach(([name, rule]) => {
    const before = current?.[name];
    if (!before) changes.push(ruleSummary('adds', name, rule));
    else if (JSON.stringify(before) !== JSON.stringify(rule))
      changes.push(ruleSummary('changes', name, rule));
  });
  Object.entries(current ?? {}).forEach(([name, rule]) => {
    if (!candidate[name]) changes.push(ruleSummary('removes', name, rule));
  });
  return changes;
};

// Whether the add-host dialog can show this rule and save it back without
// losing anything: one endpoint, given as plain TCP or as REST with a
// read-only or read-write preset and nothing more specific. Anything else
// is edited as JSON.
export const isSimpleRule = (rule?: NetworkPolicyRule): boolean => {
  const endpoints = rule?.endpoints ?? [];
  if (endpoints.length !== 1) return false;
  const [endpoint] = endpoints;
  if (endpoint.rules?.length || endpoint.denyRules?.length) return false;
  if (!endpoint.protocol || endpoint.protocol === 'tcp') return true;
  return (
    endpoint.protocol === 'rest' &&
    (endpoint.access === 'NETWORK_ACCESS_PRESET_READ_ONLY' ||
      endpoint.access === 'NETWORK_ACCESS_PRESET_READ_WRITE')
  );
};
