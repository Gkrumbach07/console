import { getApiBasePath } from './client';

export type SandboxRunResult = {
  // What the command wrote, as a terminal received it: lines end in CR LF.
  output: string;
  exitCode: number;
};

// Runs one command in a sandbox and answers with what it wrote. The BFF has
// one way to run a command, the terminal's WebSocket (ExecSandboxInteractive
// behind it), so this opens a session whose first frame names the command,
// collects the output and closes with the exit code, the way the Terminal tab
// does for a command of its own.
export const runInSandbox = (
  workspace: string,
  sandboxName: string,
  command: string[],
  timeoutMs = 45_000,
): Promise<SandboxRunResult> =>
  new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}${getApiBasePath()}/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(sandboxName)}/terminal?cols=200&rows=50&start=message`;
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const decoder = new TextDecoder();
    let output = '';
    let settled = false;

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    const timer = setTimeout(() => {
      settle(() =>
        reject(new Error('The command did not finish in time in the sandbox.')),
      );
      socket.close();
    }, timeoutMs);

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'start', command }));
    };
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        output += decoder.decode(event.data, { stream: true });
      }
    };
    socket.onerror = () => {
      settle(() =>
        reject(new Error('The connection to the sandbox could not be opened.')),
      );
    };
    socket.onclose = (event) => {
      settle(() => {
        // A session that ran closes with its exit code as the reason; one
        // that was refused closes with why.
        if (/^-?\d+$/.test(event.reason)) {
          resolve({ output, exitCode: parseInt(event.reason, 10) });
        } else {
          reject(
            new Error(
              event.reason || 'The connection to the sandbox was cut off.',
            ),
          );
        }
      });
    };
  });
