import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export function parseQuery(search: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  if (!search) return result;
  for (const pair of search.replace(/^\?/, '').split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
    const rawValue = eq >= 0 ? pair.slice(eq + 1) : '';
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    const existing = result[key];
    if (existing === undefined) result[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else result[key] = [existing, value];
  }
  return result;
}

export function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  const type = String(req.headers['content-type'] ?? '');
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return raw;
}

export function createVercelRequest(req: IncomingMessage, body: unknown): VercelRequest {
  const url = new URL(req.url ?? '/', 'http://localhost');
  return {
    method: req.method ?? 'GET',
    url: req.url ?? '/',
    query: parseQuery(url.search.slice(1)),
    headers: req.headers,
    cookies: parseCookies(String(req.headers.cookie ?? '')),
    body,
    socket: req.socket,
  } as unknown as VercelRequest;
}

export function createVercelResponse(res: ServerResponse): VercelResponse {
  const state = { statusCode: 200 };
  const wrapper = {
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(value: number) {
      state.statusCode = value;
    },
    status(code: number) {
      state.statusCode = code;
      return wrapper;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      res.setHeader(name, value);
      return wrapper;
    },
    getHeader(name: string) {
      return res.getHeader(name);
    },
    json(payload: unknown) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = state.statusCode;
      res.end(JSON.stringify(payload));
      return wrapper;
    },
    send(payload: unknown) {
      if (Buffer.isBuffer(payload)) {
        res.statusCode = state.statusCode;
        res.end(payload);
        return wrapper;
      }
      if (typeof payload === 'object' && payload !== null) {
        return wrapper.json(payload);
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.statusCode = state.statusCode;
      res.end(String(payload ?? ''));
      return wrapper;
    },
    end(data?: unknown) {
      res.statusCode = state.statusCode;
      res.end(data as string | Buffer | undefined);
      return wrapper;
    },
    redirect(url: string) {
      res.statusCode = 302;
      res.setHeader('Location', String(url));
      res.end();
      return wrapper;
    },
  };
  return wrapper as unknown as VercelResponse;
}
