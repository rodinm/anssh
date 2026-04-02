import { spawn } from 'child_process';
import path from 'path';

export interface AnsibleRunRequest {
  cwd: string;
  playbookPath: string;
  inventoryPath: string;
  limit?: string;
  check: boolean;
  extraArgs?: string[];
}

export function runAnsiblePlaybook(req: AnsibleRunRequest): Promise<{ code: number; stdout: string; stderr: string }> {
  const args = [req.playbookPath, '-i', req.inventoryPath];
  if (req.limit?.trim()) {
    args.push('-l', req.limit.trim());
  }
  if (req.check) {
    args.push('--check');
  }
  if (req.extraArgs?.length) {
    args.push(...req.extraArgs);
  }

  return new Promise((resolve) => {
    const child = spawn('ansible-playbook', args, {
      cwd: req.cwd,
      env: process.env,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${err.message}` });
    });
  });
}

/** Raw ansible / ansible-playbook command split for power users */
export function runAnsibleRaw(cwd: string, argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const bin = argv[0] || 'ansible-playbook';
  const args = argv.slice(1);
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: process.env, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${err.message}` });
    });
  });
}

export function resolvePlaybookPath(cwd: string, playbook: string): string {
  return path.isAbsolute(playbook) ? playbook : path.join(cwd, playbook);
}
