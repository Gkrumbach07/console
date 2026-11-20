// Client-side starter policy templates for the create-sandbox form.
//
// The gateway has NO server-side policy library — a sandbox carries its policy
// inline (SandboxSpec.policy), so reusable templates live here in the client.
// Structures follow openshell.sandbox.v1.SandboxPolicy (protojson camelCase
// field names).
//
// Every policy here is also in backend/test/compat/testdata/policy_presets.json,
// and policyTemplates.spec.ts fails when the two differ. The compat suite
// creates a sandbox from each policy in that file against a real gateway, which
// is the only thing that shows a template is one the gateway accepts: the
// gateway validates hosts, ports and wildcards, and its rules change between
// releases. There is no "any host" template because there is no such host
// pattern. Gateway 0.1.2 refuses `*` and `**` on their own and a wildcard
// directly under a top-level domain (`*.com`, `**.com`).

import type { SandboxPolicy } from '../../types';

export type PolicyTemplate = {
  id: string;
  name: string;
  description: string;
  // What an agent in a sandbox of this policy will find blocked, said before
  // it finds out from a denied connection.
  blocks: string;
  policy: SandboxPolicy;
};

// The filesystem of upstream's restrictive default (`restrictive_default_policy`
// in openshell-policy 0.1.6), plus /app. The gateway adds /dev/null,
// /dev/urandom and /var/log to a policy only when it has network rules, so a
// policy without them breaks `git` and every `> /dev/null` in a sandbox with
// no network rules of its own.
export const basePolicy: Pick<
  SandboxPolicy,
  'version' | 'filesystem' | 'landlock' | 'process'
> = {
  version: 1,
  filesystem: {
    includeWorkdir: true,
    readOnly: [
      '/bin',
      '/usr',
      '/lib',
      '/proc',
      '/dev/urandom',
      '/app',
      '/etc',
      '/var/log',
    ],
    readWrite: ['/sandbox', '/tmp', '/dev/null'],
  },
  landlock: { compatibility: 'best_effort' },
  process: { runAsUser: 'sandbox', runAsGroup: 'sandbox' },
};

export const policyTemplates: PolicyTemplate[] = [
  {
    id: 'locked-down',
    name: 'Locked down: attached providers only',
    description:
      'No network rules of its own. The sandbox reaches the endpoints of the providers you attach and nothing else. A good default for untrusted code.',
    blocks:
      'Blocks package installs (pip, npm), git clone and every other host until you approve a proposal for it.',
    policy: {
      ...basePolicy,
      networkPolicies: {},
    },
  },
  {
    id: 'anthropic-agent',
    name: 'Anthropic API agent',
    description:
      'Lets Claude Code, node and curl reach api.anthropic.com. Attaching an Anthropic provider does the same and also gives the sandbox its key.',
    blocks:
      'Blocks package installs, git and every other host. Other programs cannot reach the API either: the gateway matches the calling binary.',
    policy: {
      ...basePolicy,
      networkPolicies: {
        anthropic: {
          endpoints: [
            {
              host: 'api.anthropic.com',
              port: 443,
              protocol: 'rest',
              enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
              access: 'NETWORK_ACCESS_PRESET_READ_WRITE',
            },
          ],
          // Gateway 0.1.6 requires a binary match (require_binary_identity),
          // so a rule without binaries admits no process at all.
          binaries: [
            { path: '/usr/local/bin/claude' },
            { path: '/usr/bin/claude' },
            { path: '/usr/bin/node' },
            { path: '/usr/bin/curl' },
          ],
        },
      },
    },
  },
  {
    id: 'github-readonly',
    name: 'GitHub read-only',
    description:
      'git and gh can clone, fetch and read the GitHub API. Push stays denied.',
    blocks:
      'Blocks git push, package installs and every other host. Private repositories also need a GitHub provider for the token.',
    // The rules of upstream's providers/github.yaml: git smart HTTP needs a
    // POST to git-upload-pack for clone and fetch, which the read-only access
    // preset (GET, HEAD, OPTIONS) refuses.
    policy: {
      ...basePolicy,
      networkPolicies: {
        github: {
          endpoints: [
            {
              host: 'api.github.com',
              port: 443,
              protocol: 'rest',
              enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
              access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
            },
            {
              host: 'github.com',
              port: 443,
              protocol: 'rest',
              enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
              rules: [
                { allow: { method: 'GET', path: '**' } },
                { allow: { method: 'HEAD', path: '**' } },
                { allow: { method: 'OPTIONS', path: '**' } },
                { allow: { method: 'POST', path: '/**/git-upload-pack' } },
              ],
            },
          ],
          binaries: [
            { path: '/usr/bin/git' },
            { path: '/usr/local/bin/git' },
            { path: '/usr/bin/gh' },
            { path: '/usr/local/bin/gh' },
          ],
        },
      },
    },
  },
];
