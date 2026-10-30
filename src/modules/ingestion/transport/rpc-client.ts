import { z } from 'zod';
import { RateLimiter } from './rate-limiter.js';
import { CircuitBreaker } from '../../observability/circuit-breaker.js';
import { logger } from '../../observability/logger.js';

export const JsonRpcErrorSchema = z.object({
  jsonrpc: z.literal('2.0'),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  id: z.union([z.string(), z.number(), z.null()]),
});

export const JsonRpcSuccessSchema = z.object({
  jsonrpc: z.literal('2.0'),
  result: z.unknown(),
  error: z.undefined(),
  id: z.union([z.string(), z.number()]),
});

export const JsonRpcResponseSchema = z.union([JsonRpcErrorSchema, JsonRpcSuccessSchema]);

export interface RpcClientOptions {
  httpUrl: string;
  apiKey?: string;
  maxRequestsPerSecond?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface RpcMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retriedRequests: number;
  lastLatencyMs: number;
}

export class SolanaRpcClient {
  private readonly httpUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private requestId = 0;
  private metrics: RpcMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    retriedRequests: 0,
    lastLatencyMs: 0,
  };

  constructor(options: RpcClientOptions) {
    this.httpUrl = this.buildUrl(options.httpUrl, options.apiKey);
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.maxRetries = options.maxRetries ?? 3;
    this.rateLimiter = new RateLimiter({
      maxRequestsPerSecond: options.maxRequestsPerSecond ?? 10,
    });
    this.circuitBreaker = new CircuitBreaker({
      name: 'solana-rpc',
      failureThreshold: 5,
      cooldownMs: 15000,
      successThreshold: 2,
    });
  }

  private buildUrl(baseUrl: string, apiKey?: string): string {
    if (!apiKey) return baseUrl;
    const url = new URL(baseUrl);
    if (!url.searchParams.has('api-key')) {
      url.searchParams.set('api-key', apiKey);
    }
    return url.toString();
  }

  public get sanitizedUrl(): string {
    try {
      const url = new URL(this.httpUrl);
      if (url.searchParams.has('api-key')) {
        url.searchParams.set('api-key', '[REDACTED]');
      }
      return decodeURIComponent(url.toString());
    } catch {
      return '[INVALID_URL]';
    }
  }

  public async call<T = unknown>(
    method: string,
    params: unknown[] = [],
    schema?: z.ZodType<T>,
  ): Promise<T> {
    return this.circuitBreaker.execute(async () => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        if (attempt > 0) {
          this.metrics.retriedRequests += 1;
          const backoffMs = Math.min(5000, Math.pow(2, attempt) * 200 + Math.random() * 100);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }

        await this.rateLimiter.acquire();
        this.metrics.totalRequests += 1;
        const startTime = Date.now();

        try {
          const id = ++this.requestId;
          const payload = {
            jsonrpc: '2.0',
            id,
            method,
            params,
          };

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), this.timeoutMs);

          const res = await fetch(this.httpUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          clearTimeout(timer);
          this.metrics.lastLatencyMs = Date.now() - startTime;

          if (res.status === 429) {
            const retryAfter = res.headers.get('retry-after');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
            logger.warn(
              { delay, sanitizedUrl: this.sanitizedUrl },
              '[SolanaRpcClient] HTTP 429 Rate limited. Backing off.',
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            throw new Error('Rate limit exceeded (HTTP 429)');
          }

          if (!res.ok) {
            throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
          }

          const rawJson: unknown = await res.json();
          const parsedRpc = JsonRpcResponseSchema.safeParse(rawJson);

          if (!parsedRpc.success) {
            throw new Error(
              `Invalid JSON-RPC response format: ${parsedRpc.error.issues.map((i) => i.message).join(', ')}`,
            );
          }

          if ('error' in parsedRpc.data && parsedRpc.data.error) {
            throw new Error(
              `RPC Error ${parsedRpc.data.error.code}: ${parsedRpc.data.error.message}`,
            );
          }

          const result = parsedRpc.data.result;
          if (schema) {
            const validatedResult = schema.safeParse(result);
            if (!validatedResult.success) {
              throw new Error(
                `Response data failed schema validation: ${validatedResult.error.issues.map((i) => i.message).join(', ')}`,
              );
            }
            this.metrics.successfulRequests += 1;
            return validatedResult.data;
          }

          this.metrics.successfulRequests += 1;
          return result as T;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          logger.debug(
            { attempt, maxRetries: this.maxRetries, method, err: lastError.message },
            '[SolanaRpcClient] RPC call failed',
          );
        }
      }

      this.metrics.failedRequests += 1;
      logger.error(
        { method, sanitizedUrl: this.sanitizedUrl, error: lastError?.message },
        '[SolanaRpcClient] RPC call exhausted all retries',
      );
      throw lastError ?? new Error(`RPC call failed for method ${method}`);
    });
  }

  public getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  public async getSlot(): Promise<number> {
    return this.call('getSlot', [{ commitment: 'confirmed' }], z.number());
  }

  public getMetrics(): Readonly<RpcMetrics> {
    return Object.freeze({ ...this.metrics });
  }
}
