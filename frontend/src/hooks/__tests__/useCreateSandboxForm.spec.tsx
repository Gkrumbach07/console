import { act, renderHook } from '@testing-library/react';

import { useCreateSandboxForm } from '../useCreateSandboxForm';

// The policy is held once, as the text of its file; the form's fields are
// views of it. These are the properties that make the two one policy.
describe('useCreateSandboxForm — the policy file', () => {
  it('starts on the default policy, as a YAML file', () => {
    const { result } = renderHook(() => useCreateSandboxForm());
    expect(result.current.policyText).toMatch(/^version: 1\n/);
    expect(result.current.readWrite).toEqual(['/sandbox', '/tmp', '/dev/null']);
    expect(result.current.extras).toEqual([]);
    expect(result.current.isValid).toBe(true);
  });

  it('writes a form change into the file and leaves the rest of it alone', () => {
    const { result } = renderHook(() => useCreateSandboxForm());
    act(() =>
      result.current.setPolicyText(
        result.current.policyText.replace(
          'include_workdir: true',
          'include_workdir: false',
        ),
      ),
    );
    act(() =>
      result.current.addRule('pypi', {
        name: 'pypi',
        endpoints: [{ host: 'pypi.org', port: 443 }],
        binaries: [{ path: '/usr/bin/curl' }],
      }),
    );

    expect(result.current.policyText).toContain('include_workdir: false');
    expect(result.current.policyText).toContain('host: pypi.org');
    expect(result.current.extras).toEqual([
      'the working directory is not writable',
    ]);
    expect(Object.keys(result.current.rules)).toEqual(['pypi']);
  });

  it('gives a second rule of the same name a name of its own', () => {
    const { result } = renderHook(() => useCreateSandboxForm());
    const rule = { endpoints: [{ host: 'a.example.com', port: 443 }] };
    act(() => result.current.addRule('a', rule));
    act(() => result.current.addRule('a', rule));
    expect(Object.keys(result.current.rules)).toEqual(['a', 'a_2']);
  });

  it('cannot change the policy while the file is not one, and cannot create', () => {
    const { result } = renderHook(() => useCreateSandboxForm());
    const before = result.current.readOnly;
    act(() => result.current.setPolicyText('version: 2\n'));
    expect(result.current.canEditPolicy).toBe(false);
    expect(result.current.policyError).toMatch(/unsupported policy version 2/);
    // The fields show the policy as it last read.
    expect(result.current.readOnly).toEqual(before);
    act(() => result.current.setPaths('readOnly', ['/opt']));
    expect(result.current.policyText).toBe('version: 2\n');
    expect(result.current.isValid).toBe(false);
    expect(result.current.buildPayload()).toBeNull();
  });

  it('asks for a policy when the file is emptied', () => {
    const { result } = renderHook(() => useCreateSandboxForm());
    act(() => result.current.setPolicyText('  '));
    expect(result.current.policyError).toMatch(/A policy is required/);
    expect(result.current.isValid).toBe(false);
  });

  it('goes back to the default policy on reset', () => {
    const { result } = renderHook(() => useCreateSandboxForm());
    const initial = result.current.policyText;
    act(() => result.current.setPaths('readWrite', ['/data']));
    act(() => result.current.reset());
    expect(result.current.policyText).toBe(initial);
  });
});

describe('useCreateSandboxForm — resources', () => {
  it('refuses a GPU count that is not a whole number', () => {
    const { result } = renderHook(() => useCreateSandboxForm());
    act(() => result.current.setGpuCount('one'));
    expect(result.current.gpuInvalid).toBe(true);
    expect(result.current.hasResourcesError).toBe(true);
    expect(result.current.isValid).toBe(false);
  });

  it('sends labels from their rows', () => {
    const { result } = renderHook(() => useCreateSandboxForm());
    act(() => {
      result.current.setName('agent-1');
      result.current.setLabelRows([{ key: 'team', value: 'ml' }]);
      result.current.setGpuCount('2');
    });
    expect(result.current.buildPayload()).toMatchObject({
      name: 'agent-1',
      labels: { team: 'ml' },
      gpuCount: 2,
    });
  });
});
