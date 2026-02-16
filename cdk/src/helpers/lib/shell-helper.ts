import {spawnSync} from 'child_process';
import * as process from 'process';
import * as fs from 'fs';

export interface BashExecutionProps {
  readonly script: string;
  readonly workingDirectory?: string;
  readonly environment?: {
    [key: string]: string;
  };
}

/**
 * Simple helper class for executing shell scripts and commands
 */
export class ShellHelper {
  static version(command: string, args: string[]): string | null {
    const res = spawnSync(command, args);
    if (res.status !== 0) {
      return null;
    }
    const match = String(res.stdout).match(/[\d\\.]+/);
    return match ? match.toString() : null;
  }

  static bashVersion(): string | null {
    return ShellHelper.version('bash', ['--version']);
  }

  static pythonVersion(): string | null {
    return ShellHelper.version('python', ['-V']);
  }

  static nodeVersion(): string | null {
    return ShellHelper.version('node', ['--version']);
  }

  static goVersion(): string | null {
    return ShellHelper.version('go', ['version']);
  }

  static dotnetVersion(): string | null {
    return ShellHelper.version('dotnet', ['--version']);
  }

  static checkDirectoryAccess(dir?: string) {
    if (dir !== undefined) {
      fs.accessSync(dir);
      if (!fs.lstatSync(dir).isDirectory()) {
        throw new Error(`${dir} is not a directory`);
      }
    }
  }

  static executeBash(props: BashExecutionProps): boolean {
    ShellHelper.checkDirectoryAccess(props.workingDirectory);
    const res = spawnSync('bash', {
      input: props.script,
      cwd: props.workingDirectory,
      stdio: ['pipe', process.stdout, process.stderr],
      env: {
        ...process.env,
        ...props.environment,
      },
    });
    if (res.error) {
      throw res.error;
    }
    return res.status === 0;
  }

  static executeBashScript(props: BashExecutionProps): boolean {
    ShellHelper.checkDirectoryAccess(props.workingDirectory);
    const res = spawnSync('bash', [props.script], {
      cwd: props.workingDirectory,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...props.environment,
      },
    });
    if (res.error) {
      throw res.error;
    }
    return res.status === 0;
  }
}
