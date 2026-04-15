import { Client } from "ssh2";
import { logger } from "./logger";

export interface SshConnectionOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey?: string | null;
}

export interface SshResult {
  success: boolean;
  output: string;
  error: string | null;
}

export function runSshCommand(
  options: SshConnectionOptions,
  command: string,
  timeoutMs = 60000
): Promise<SshResult> {
  return new Promise((resolve) => {
    const conn = new Client();
    let output = "";
    let errorOutput = "";
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        conn.end();
        resolve({ success: false, output, error: "Command timed out" });
      }
    }, timeoutMs);

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          resolved = true;
          conn.end();
          resolve({ success: false, output: "", error: err.message });
          return;
        }

        stream.on("close", (code: number) => {
          clearTimeout(timer);
          resolved = true;
          conn.end();
          resolve({
            success: code === 0,
            output: output + errorOutput,
            error: code !== 0 ? `Exit code ${code}: ${errorOutput}` : null,
          });
        });

        stream.on("data", (data: Buffer) => {
          output += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          errorOutput += data.toString();
        });
      });
    });

    conn.on("error", (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve({ success: false, output: "", error: err.message });
      }
    });

    const connectOpts: Record<string, unknown> = {
      host: options.host,
      port: options.port,
      username: options.username,
      readyTimeout: 15000,
    };

    if (options.privateKey) {
      connectOpts.privateKey = options.privateKey;
    } else {
      connectOpts.password = options.password;
    }

    try {
      conn.connect(connectOpts as Parameters<typeof conn.connect>[0]);
    } catch (e: unknown) {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve({ success: false, output: "", error: (e as Error).message });
      }
    }
  });
}

export function runSshCommandStream(
  options: SshConnectionOptions,
  command: string,
  onData: (chunk: string) => void,
  timeoutMs = 120000
): Promise<SshResult> {
  return new Promise((resolve) => {
    const conn = new Client();
    let output = "";
    let errorOutput = "";
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        conn.end();
        resolve({ success: false, output, error: "Command timed out" });
      }
    }, timeoutMs);

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          resolved = true;
          conn.end();
          resolve({ success: false, output: "", error: err.message });
          return;
        }

        stream.on("close", (code: number) => {
          clearTimeout(timer);
          resolved = true;
          conn.end();
          resolve({
            success: code === 0,
            output: output + errorOutput,
            error: code !== 0 ? `Exit code ${code}: ${errorOutput}` : null,
          });
        });

        stream.on("data", (data: Buffer) => {
          const chunk = data.toString();
          output += chunk;
          onData(chunk);
        });

        stream.stderr.on("data", (data: Buffer) => {
          const chunk = data.toString();
          errorOutput += chunk;
          onData(chunk);
        });
      });
    });

    conn.on("error", (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve({ success: false, output: "", error: err.message });
      }
    });

    const connectOpts: Record<string, unknown> = {
      host: options.host,
      port: options.port,
      username: options.username,
      readyTimeout: 15000,
    };

    if (options.privateKey) {
      connectOpts.privateKey = options.privateKey;
    } else {
      connectOpts.password = options.password;
    }

    try {
      conn.connect(connectOpts as Parameters<typeof conn.connect>[0]);
    } catch (e: unknown) {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve({ success: false, output: "", error: (e as Error).message });
      }
    }
  });
}

export function testSshConnection(options: SshConnectionOptions): Promise<{ success: boolean; message: string; output: string | null }> {
  return new Promise((resolve) => {
    const conn = new Client();
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        conn.end();
        resolve({ success: false, message: "Connection timed out", output: null });
      }
    }, 15000);

    conn.on("ready", () => {
      conn.exec("echo 'ok' && uname -a", (err, stream) => {
        if (err) {
          clearTimeout(timer);
          resolved = true;
          conn.end();
          resolve({ success: true, message: "Connected successfully", output: null });
          return;
        }

        let out = "";
        stream.on("close", () => {
          clearTimeout(timer);
          resolved = true;
          conn.end();
          resolve({ success: true, message: "Connected successfully", output: out.trim() });
        });

        stream.on("data", (data: Buffer) => {
          out += data.toString();
        });
      });
    });

    conn.on("error", (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        logger.warn({ err }, "SSH connection failed");
        resolve({ success: false, message: `Connection failed: ${err.message}`, output: null });
      }
    });

    const connectOpts: Record<string, unknown> = {
      host: options.host,
      port: options.port,
      username: options.username,
      readyTimeout: 12000,
    };

    if (options.privateKey) {
      connectOpts.privateKey = options.privateKey;
    } else {
      connectOpts.password = options.password;
    }

    try {
      conn.connect(connectOpts as Parameters<typeof conn.connect>[0]);
    } catch (e: unknown) {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve({ success: false, message: (e as Error).message, output: null });
      }
    }
  });
}
