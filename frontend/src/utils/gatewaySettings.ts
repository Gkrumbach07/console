// What each setting the gateway registers does, its default and the values
// it takes. The gateway's API lists the keys but not what they mean (the CLI
// and TUI link the registry in), so this is read from upstream's registry,
// REGISTERED_SETTINGS in crates/openshell-core/src/settings.rs, at v0.1.6.
// A key not listed here is shown as it is.

export type KnownSetting = {
  description: string;
  // What the gateway does while the key is unset.
  unsetMeans: string;
  // The values a string key accepts; the gateway refuses any other.
  allowedValues?: string[];
};

export const KNOWN_SETTINGS: Record<string, KnownSetting> = {
  ocsf_json_enabled: {
    description:
      'Writes each sandbox event as an OCSF JSON record to stderr and to /var/log/openshell-ocsf*.jsonl, beside the usual log lines.',
    unsetMeans: 'false: plain log lines only',
  },
  ocsf_schema_version: {
    description:
      'The OCSF schema version the JSON records are downgraded to, for a consumer that reads an older schema.',
    unsetMeans: 'no downgrade',
    allowedValues: ['1.1', '1.3'],
  },
  agent_policy_proposals_enabled: {
    description:
      'Lets the agent in a sandbox propose policy changes itself, through the policy_advisor skill and the policy.local API. Proposals made from denied connections do not depend on it.',
    unsetMeans: 'false: only denied connections make proposals',
  },
  proposal_approval_mode: {
    description:
      'auto approves a proposal the prover finds no risk in; anything with a finding still waits for a person. manual sends every proposal to review.',
    unsetMeans: 'manual',
    allowedValues: ['manual', 'auto'],
  },
};
