import {
  allowSentence,
  isSimpleRule,
  proposalChanges,
  proposalHeadline,
} from '../proposalWords';
import type { PolicyChunk } from '../../../types';

const base: PolicyChunk = {
  id: 'c1',
  status: 'pending',
  confidence: 0.65,
  createdAtMs: 0,
  hitCount: 1,
};

// The chunk gateway 0.1.6 wrote for `curl https://pypi.org/` from a sandbox
// that had no rule for it (2026-11-16), less the policies around it.
const pypi: PolicyChunk = {
  ...base,
  ruleName: 'allow_pypi_org_443',
  binary: '/sandbox/.uv/python/cpython-3.14.3-linux-aarch64-gnu/bin/python3.14',
  proposedRule: {
    name: 'allow_pypi_org_443',
    endpoints: [
      { host: 'pypi.org', port: 443, ports: [443], advisorProposed: true },
    ],
    binaries: [
      {
        path: '/sandbox/.uv/python/cpython-3.14.3-linux-aarch64-gnu/bin/python3.14',
      },
    ],
  },
};

describe('proposalHeadline', () => {
  it('names the program by its file name and the host with its port', () => {
    expect(proposalHeadline(pypi)).toEqual({
      program: 'python3.14',
      programPath:
        '/sandbox/.uv/python/cpython-3.14.3-linux-aarch64-gnu/bin/python3.14',
      target: 'pypi.org:443',
      wasBlocked: true,
    });
  });

  it('counts the endpoints it does not name', () => {
    const rule = {
      endpoints: [
        { host: 'a.example.com', port: 443 },
        { host: 'b.example.com', port: 443 },
      ],
    };
    expect(
      proposalHeadline({ ...base, hitCount: 0, proposedRule: rule }),
    ).toMatchObject({
      target: 'a.example.com:443 and 1 more',
      wasBlocked: false,
    });
  });
});

describe('allowSentence', () => {
  it('warns that a rule naming no program lets nothing through', () => {
    expect(
      allowSentence({
        ...pypi,
        proposedRule: { ...pypi.proposedRule, binaries: [] },
      }),
    ).toMatch(/lets nothing through/);
  });
});

describe('proposalChanges', () => {
  it('lists what the candidate policy adds, changes and removes', () => {
    const changes = proposalChanges({
      ...pypi,
      currentEffectivePolicy: {
        networkPolicies: {
          kept: { name: 'kept', endpoints: [{ host: 'k.example.com' }] },
          widened: {
            name: 'widened',
            endpoints: [{ host: 'w.example.com', port: 443 }],
            binaries: [{ path: '/usr/bin/curl' }],
          },
          dropped: { name: 'dropped', endpoints: [{ host: 'd.example.com' }] },
        },
      },
      candidateEffectivePolicy: {
        networkPolicies: {
          kept: { name: 'kept', endpoints: [{ host: 'k.example.com' }] },
          widened: {
            name: 'widened',
            endpoints: [{ host: 'w.example.com', port: 443 }],
            binaries: [{ path: '/usr/bin/curl' }, { path: '/usr/bin/git' }],
          },
          allow_pypi_org_443: pypi.proposedRule!,
        },
      },
    });
    expect(changes.map((c) => [c.kind, c.name])).toEqual([
      ['changes', 'widened'],
      ['adds', 'allow_pypi_org_443'],
      ['removes', 'dropped'],
    ]);
    expect(changes[1].endpoints).toEqual([
      'pypi.org:443, any traffic (not inspected)',
    ]);
  });

  it('falls back to the proposed rule when the gateway sends no policies', () => {
    expect(proposalChanges(pypi).map((c) => c.kind)).toEqual(['adds']);
  });
});

describe('isSimpleRule', () => {
  it('takes one plain or preset endpoint, and nothing more specific', () => {
    expect(isSimpleRule(pypi.proposedRule)).toBe(true);
    expect(
      isSimpleRule({
        endpoints: [
          {
            host: 'pypi.org',
            protocol: 'rest',
            access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
          },
        ],
      }),
    ).toBe(true);
    expect(
      isSimpleRule({
        endpoints: [
          {
            host: 'github.com',
            protocol: 'rest',
            rules: [{ allow: { method: 'POST', path: '/**/git-upload-pack' } }],
          },
        ],
      }),
    ).toBe(false);
    expect(
      isSimpleRule({
        endpoints: [
          {
            host: 'x.example.com',
            protocol: 'rest',
            access: 'NETWORK_ACCESS_PRESET_FULL',
          },
        ],
      }),
    ).toBe(false);
    expect(
      isSimpleRule({
        endpoints: [{ host: 'a.example.com' }, { host: 'b.example.com' }],
      }),
    ).toBe(false);
  });
});
