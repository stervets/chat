import {request} from 'node:http';

type WgAdminErrorCode =
  | 'timeout'
  | 'network'
  | 'bad_status'
  | 'invalid_json'
  | 'invalid_response';

export class WgAdminClientError extends Error {
  constructor(
    readonly code: WgAdminErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WgAdminClientError';
  }
}

type WgAdminArtifacts = {
  link: string;
  configText: string;
  qrText: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;

export class WgAdminClient {
  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async createOrGetUser(userName: string): Promise<WgAdminArtifacts> {
    const name = String(userName || '').trim();
    if (!name) {
      throw new WgAdminClientError('invalid_response', 'wg-admin username is empty');
    }

    const payload = JSON.stringify({name});

    return new Promise<WgAdminArtifacts>((resolve, reject) => {
      let settled = false;

      const fail = (err: WgAdminClientError) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const done = (artifacts: WgAdminArtifacts) => {
        if (settled) return;
        settled = true;
        resolve(artifacts);
      };

      const req = request({
        socketPath: this.socketPath,
        method: 'POST',
        path: '/users/create',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      }, (res) => {
        const chunks: string[] = [];
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          chunks.push(chunk);
        });

        res.on('error', (err) => {
          fail(new WgAdminClientError('network', 'wg-admin response stream failed', {
            message: err?.message || 'unknown stream error',
          }));
        });

        res.on('end', () => {
          const rawBody = chunks.join('');
          const statusCode = res.statusCode || 0;

          if (statusCode < 200 || statusCode >= 300) {
            fail(new WgAdminClientError('bad_status', 'wg-admin returned non-2xx status', {
              statusCode,
              body: rawBody.slice(0, 800),
            }));
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(rawBody);
          } catch {
            fail(new WgAdminClientError('invalid_json', 'wg-admin returned invalid JSON', {
              body: rawBody.slice(0, 800),
            }));
            return;
          }

          const artifacts = this.parseArtifacts(parsed);
          if (!artifacts) {
            fail(new WgAdminClientError('invalid_response', 'wg-admin response has invalid shape', {
              statusCode,
            }));
            return;
          }

          done(artifacts);
        });
      });

      req.setTimeout(this.timeoutMs, () => {
        req.destroy();
        fail(new WgAdminClientError('timeout', 'wg-admin request timeout', {
          timeoutMs: this.timeoutMs,
        }));
      });

      req.on('error', (err) => {
        fail(new WgAdminClientError('network', 'wg-admin socket request failed', {
          message: err?.message || 'unknown request error',
          code: (err as any)?.code || null,
        }));
      });

      req.write(payload);
      req.end();
    });
  }

  private parseArtifacts(payload: unknown): WgAdminArtifacts | null {
    if (!payload || typeof payload !== 'object') return null;

    const response = payload as {
      ok?: unknown;
      artifacts?: {
        link?: unknown;
        configText?: unknown;
        qrText?: unknown;
      };
    };

    if (response.ok !== true || !response.artifacts) return null;

    const {link, configText, qrText} = response.artifacts;
    if (typeof link !== 'string') return null;
    if (typeof configText !== 'string') return null;
    if (typeof qrText !== 'string') return null;

    return {link, configText, qrText};
  }
}
