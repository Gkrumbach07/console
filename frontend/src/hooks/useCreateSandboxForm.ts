import { useCallback, useMemo, useRef, useState } from 'react';

import { COMMUNITY_REGISTRY } from '../constants';
import { usePolicyText } from './usePolicyText';
import { useSandboxLaunchOptions } from './useSandboxLaunchOptions';
import {
  freeRuleName,
  initialPolicy,
  pathsOf,
  policyExtras,
  rulesOf,
  withPaths,
  withRules,
  type PathAccess,
} from '../components/policy/policyBuilder';
import {
  PRESET_LABEL,
  presetFor,
  type PresetId,
} from '../sandboxPresets/presets';
import { policyToText } from '../utils/policyFile';
import {
  parseDriverConfig,
  rowsToRecord,
  type KeyValueRow,
} from '../utils/sandboxOptions';
import type {
  CreateSandboxRequest,
  NetworkPolicyRule,
  SandboxPolicy,
} from '../types';

export const resolveImage = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed && !trimmed.includes('/') && !trimmed.includes(':')) {
    return `${COMMUNITY_REGISTRY}/${trimmed}:latest`;
  }
  return trimmed;
};

// Why a form whose policy file was emptied cannot be sent. A policy is the one
// thing a sandbox cannot be created without, and an empty text, or one that
// is only space, is not one.
export const POLICY_REQUIRED =
  'A policy is required. Write one in the policy file, or load one from a file.';

// Labels written as `team=ml, kind=agent`, as the template forms take them.
export const parseLabels = (raw: string): Record<string, string> | null => {
  const labels: Record<string, string> = {};
  const trimmed = raw.trim();
  if (!trimmed) {
    return labels;
  }
  for (const pair of trimmed.split(',')) {
    const [key, ...rest] = pair.split('=');
    if (!key?.trim() || rest.length === 0 || !rest.join('=').trim()) {
      return null;
    }
    labels[key.trim()] = rest.join('=').trim();
  }
  return labels;
};

// The policy as the file shows it to start with: the YAML a person would
// pass to `openshell sandbox create --policy`.
const initialPolicyText = (): string =>
  policyToText(initialPolicy(), 'yaml').text ?? '';

export const useCreateSandboxForm = () => {
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [gpuCount, setGpuCount] = useState('');
  const [cpu, setCpu] = useState('');
  const [memory, setMemory] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  // What the sandbox is for: a shell, or one of the agents its image holds.
  // It does not change the sandbox's main process, which stays the image's
  // login shell so that the sandbox outlives a session: it is what the
  // terminal starts, and a label on the sandbox says so.
  const [presetId, setPresetId] = useState<PresetId>('shell');
  const preset = presetFor(presetId);

  // The policy is held once, as the text of its file. The form's fields are
  // views of parts of it: each reads its part from the policy the text reads
  // as, and writes the policy back as text with that part changed. A field
  // the form does not have is never touched, so an edit made in the file
  // stays whatever the form does afterwards, and the form and the file can
  // never disagree.
  const [policyText, setPolicyText] = useState(initialPolicyText);
  const reading = usePolicyText(policyText);
  // While the file does not read as a policy (it is being typed), the form
  // shows the last policy it did read as, and cannot change it.
  const lastPolicy = useRef<SandboxPolicy>(reading.parsed ?? initialPolicy());
  if (reading.parsed) {
    lastPolicy.current = reading.parsed;
  }
  const policy = reading.parsed ?? lastPolicy.current;
  const policyError = policyText.trim() ? reading.error : POLICY_REQUIRED;
  const canEditPolicy = reading.parsed !== null;
  const policyFormat = reading.format;

  const editPolicy = useCallback(
    (change: (current: SandboxPolicy) => SandboxPolicy) => {
      if (!reading.parsed) return;
      const next = change(reading.parsed);
      // In the format the file is in. A policy the YAML file cannot say
      // (the gateway's own marks on an endpoint) is written as JSON.
      const text =
        policyToText(next, policyFormat).text ??
        policyToText(next, 'json').text;
      if (text !== undefined) setPolicyText(text);
    },
    [reading.parsed, policyFormat],
  );

  const rules = rulesOf(policy);
  const readOnly = pathsOf(policy, 'readOnly');
  const readWrite = pathsOf(policy, 'readWrite');
  const extras = useMemo(() => policyExtras(policy), [policy]);

  const addRule = useCallback(
    (ruleName: string, rule: NetworkPolicyRule) =>
      editPolicy((current) => {
        const existing = rulesOf(current);
        return withRules(current, {
          ...existing,
          [freeRuleName(existing, ruleName)]: rule,
        });
      }),
    [editPolicy],
  );

  const replaceRule = useCallback(
    (ruleName: string, rule: NetworkPolicyRule) =>
      editPolicy((current) =>
        withRules(current, { ...rulesOf(current), [ruleName]: rule }),
      ),
    [editPolicy],
  );

  const removeRule = useCallback(
    (ruleName: string) =>
      editPolicy((current) => {
        const next = { ...rulesOf(current) };
        delete next[ruleName];
        return withRules(current, next);
      }),
    [editPolicy],
  );

  const setPaths = useCallback(
    (access: PathAccess, paths: string[]) =>
      editPolicy((current) => withPaths(current, access, paths)),
    [editPolicy],
  );

  const resetPolicy = useCallback(() => setPolicyText(initialPolicyText()), []);

  // Run and resources. All of them are optional, and a form that leaves them
  // alone sends the request it always sent.
  const [envRows, setEnvRows] = useState<KeyValueRow[]>([]);
  const [labelRows, setLabelRows] = useState<KeyValueRow[]>([]);
  const [annotationRows, setAnnotationRows] = useState<KeyValueRow[]>([]);
  const [logLevel, setLogLevel] = useState('');
  const [runtimeClassName, setRuntimeClassName] = useState('');
  const [driverConfigText, setDriverConfigText] = useState('');
  const [isAdvancedExpanded, setAdvancedExpanded] = useState(false);
  const launch = useSandboxLaunchOptions();

  const gpuInvalid = gpuCount !== '' && !/^[0-9]+$/.test(gpuCount);
  const resolvedImage = image ? resolveImage(image) : '';
  const isResolved = image && resolvedImage !== image.trim();

  const { record: environment, error: envError } = useMemo(
    () => rowsToRecord(envRows),
    [envRows],
  );
  const { record: labels, error: labelsError } = useMemo(
    () => rowsToRecord(labelRows),
    [labelRows],
  );
  const { record: annotations, error: annotationsError } = useMemo(
    () => rowsToRecord(annotationRows),
    [annotationRows],
  );
  const { value: driverConfig, error: driverConfigError } = useMemo(
    () => parseDriverConfig(driverConfigText),
    [driverConfigText],
  );

  // Which step holds a field to correct, so the wizard can mark it and the
  // review can say where to go.
  const hasRunError = Boolean(envError) || !launch.isValid;
  const hasAdvancedError = Boolean(
    labelsError || annotationsError || driverConfigError,
  );
  const hasResourcesError = gpuInvalid || hasAdvancedError;

  // The image is not required: without one the gateway runs its default.
  const isValid =
    !policyError && canEditPolicy && !hasRunError && !hasResourcesError;

  const toggleProvider = useCallback(
    (providerName: string, checked: boolean) => {
      setSelectedProviders((current) =>
        checked
          ? current.includes(providerName)
            ? current
            : [...current, providerName]
          : current.filter((item) => item !== providerName),
      );
    },
    [],
  );

  const resetLaunch = launch.reset;
  const reset = useCallback(() => {
    setName('');
    setImage('');
    setGpuCount('');
    setCpu('');
    setMemory('');
    setSelectedProviders([]);
    setPresetId('shell');
    setEnvRows([]);
    setLabelRows([]);
    setAnnotationRows([]);
    setLogLevel('');
    setRuntimeClassName('');
    setDriverConfigText('');
    setAdvancedExpanded(false);
    resetLaunch();
    resetPolicy();
  }, [resetPolicy, resetLaunch]);

  // A label a person gave is theirs: the preset's is added only beside it.
  const sandboxLabels = useMemo(
    () =>
      presetId === 'shell' || PRESET_LABEL in labels
        ? labels
        : { ...labels, [PRESET_LABEL]: presetId },
    [labels, presetId],
  );
  const launchPayload = launch.payload;
  const parsedPolicy = reading.parsed;
  const buildPayload = useCallback((): CreateSandboxRequest | null => {
    if (!isValid || !parsedPolicy) {
      return null;
    }
    return {
      name: name || undefined,
      image: resolveImage(image) || undefined,
      policy: parsedPolicy,
      labels: Object.keys(sandboxLabels).length > 0 ? sandboxLabels : undefined,
      providers: selectedProviders.length > 0 ? selectedProviders : undefined,
      gpuCount: gpuCount ? Number(gpuCount) : undefined,
      cpu: cpu || undefined,
      memory: memory || undefined,
      environment:
        Object.keys(environment).length > 0 ? environment : undefined,
      annotations:
        Object.keys(annotations).length > 0 ? annotations : undefined,
      logLevel: logLevel || undefined,
      runtimeClassName: runtimeClassName.trim() || undefined,
      driverConfig,
      ...launchPayload,
    };
  }, [
    isValid,
    parsedPolicy,
    sandboxLabels,
    name,
    image,
    selectedProviders,
    gpuCount,
    cpu,
    memory,
    environment,
    annotations,
    logLevel,
    runtimeClassName,
    driverConfig,
    launchPayload,
  ]);

  return {
    name,
    setName,
    image,
    setImage,
    resolvedImage,
    isResolved,
    selectedProviders,
    setSelectedProviders,
    toggleProvider,
    preset,
    setPresetId,
    // The policy, its file and the views of it.
    policy,
    policyText,
    setPolicyText,
    policyReading: reading,
    policyError,
    canEditPolicy,
    extras,
    rules,
    addRule,
    replaceRule,
    removeRule,
    readOnly,
    readWrite,
    setPaths,
    resetPolicy,
    // Run.
    launch,
    envRows,
    setEnvRows,
    envError,
    hasRunError,
    // Resources.
    gpuCount,
    setGpuCount,
    gpuInvalid,
    cpu,
    setCpu,
    memory,
    setMemory,
    labelRows,
    setLabelRows,
    labelsError,
    annotationRows,
    setAnnotationRows,
    annotationsError,
    logLevel,
    setLogLevel,
    runtimeClassName,
    setRuntimeClassName,
    driverConfigText,
    setDriverConfigText,
    driverConfigError,
    isAdvancedExpanded,
    setAdvancedExpanded,
    hasAdvancedError,
    hasResourcesError,
    isValid,
    reset,
    buildPayload,
  };
};

export type CreateSandboxForm = ReturnType<typeof useCreateSandboxForm>;
