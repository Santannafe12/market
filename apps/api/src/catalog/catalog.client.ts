import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../common/domain-error';

export const CATALOG_FETCH = Symbol('CATALOG_FETCH');

const USER_AGENT = 'CasaDeLeiloesEliteDev/0.1 (educational; +https://openlibrary.org/dev/docs/api)';
const OPEN_LIBRARY = 'https://openlibrary.org';
const COVERS = 'https://covers.openlibrary.org';
const TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 100;
export const MAX_COVER_BYTES = 1_572_864;
const MAX_EDITIONS = 20;
const MAX_AUTHORS = 8;
const MAX_DESCRIPTION = 4_000;
const MAX_TITLE = 500;

const WORK_ID = /^OL\d+W$/;
const EDITION_ID = /^OL\d+M$/;
const AUTHOR_ID = /^OL\d+A$/;

export class CatalogRequestError extends Error {
  constructor(readonly reason: 'unavailable' | 'not_found' | 'invalid') {
    super(reason);
    this.name = 'CatalogRequestError';
  }
}

export function catalogHttpError(error: CatalogRequestError) {
  if (error.reason === 'invalid') {
    return new DomainError('VALIDATION_ERROR', 400, 'A busca precisa ter pelo menos 2 caracteres.');
  }
  if (error.reason === 'not_found') {
    return new DomainError('EDITION_NOT_FOUND', 422, 'Não encontramos esse registro na Open Library.');
  }
  return new DomainError(
    'CATALOG_UNAVAILABLE',
    503,
    'A Open Library está indisponível. Tente de novo em instantes.',
  );
}

export type WorkSummary = {
  workId: string;
  title: string;
  authors: string[];
  firstPublishYear: number | null;
};

export type EditionSummary = {
  editionId: string;
  title: string;
  publisher: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  isbn: string | null;
  language: string | null;
};

export type EditionDetail = EditionSummary & {
  workId: string;
  authors: string[];
  description: string | null;
  coverId: number | null;
};

type CacheEntry = { expiresAt: number; body: Record<string, unknown> };

@Injectable()
export class CatalogClient {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(@Inject(CATALOG_FETCH) private readonly fetchFn: typeof fetch) {}

  clearCache() {
    this.cache.clear();
  }

  async search(query: string): Promise<WorkSummary[]> {
    const q = query.trim();
    if (q.length < 2) {
      throw new CatalogRequestError('invalid');
    }
    const url = `${OPEN_LIBRARY}/search.json?q=${encodeURIComponent(q)}&limit=10&fields=key,title,author_name,first_publish_year`;
    const body = await this.getJson(url);
    return parseWorks(body);
  }

  async editions(workId: string): Promise<EditionSummary[]> {
    if (!WORK_ID.test(workId)) {
      throw new CatalogRequestError('not_found');
    }
    const url = `${OPEN_LIBRARY}/works/${workId}/editions.json?limit=${MAX_EDITIONS}`;
    const body = await this.getJson(url);
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const editions: EditionSummary[] = [];
    for (const entry of entries) {
      if (!isRecord(entry)) {
        continue;
      }
      const summary = parseEditionSummary(entry);
      if (summary) {
        editions.push(summary);
      }
      if (editions.length >= MAX_EDITIONS) {
        break;
      }
    }
    return editions;
  }

  async edition(editionId: string): Promise<EditionDetail> {
    if (!EDITION_ID.test(editionId)) {
      throw new CatalogRequestError('not_found');
    }
    const body = await this.getJson(`${OPEN_LIBRARY}/books/${editionId}.json`);
    const summary = parseEditionSummary(body);
    if (!summary) {
      throw new CatalogRequestError('not_found');
    }
    const authors = await this.resolveAuthors(body);
    return {
      ...summary,
      editionId: editionIdFrom(body, editionId),
      workId: workIdFrom(body.works),
      authors,
      description: plainText(body.description),
      coverId: coverIdOf(body.covers),
    };
  }

  async downloadCover(coverId: number | null): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (!coverId || !Number.isInteger(coverId) || coverId <= 0) {
      return null;
    }
    try {
      const response = await this.fetchWithTimeout(`${COVERS}/b/id/${coverId}-L.jpg`, {
        Accept: 'image/*',
      });
      if (!response.ok) {
        return null;
      }
      const contentType = imageContentType(response.headers.get('content-type'));
      if (!contentType) {
        return null;
      }
      const advertised = Number(response.headers.get('content-length'));
      if (Number.isFinite(advertised) && advertised > MAX_COVER_BYTES) {
        await response.body?.cancel();
        return null;
      }
      return await readAtMost(response, contentType);
    } catch {
      return null;
    }
  }

  private async resolveAuthors(body: Record<string, unknown>) {
    const names: string[] = [];
    for (const id of authorIds(body.authors)) {
      const name = await this.authorName(id);
      if (name) {
        names.push(name);
      }
    }
    if (names.length > 0) {
      return names;
    }
    const statement = typeof body.by_statement === 'string' ? body.by_statement.trim() : '';
    return statement ? [statement.slice(0, 200)] : [];
  }

  private async authorName(id: string) {
    try {
      const body = await this.getJson(`${OPEN_LIBRARY}/authors/${id}.json`);
      return typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : null;
    } catch {
      return null;
    }
  }

  private async getJson(url: string) {
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(url);
      this.cache.set(url, cached);
      return cached.body;
    }
    if (cached) {
      this.cache.delete(url);
    }

    const response = await this.fetchWithTimeout(url, { Accept: 'application/json' });
    if (response.status === 404) {
      throw new CatalogRequestError('not_found');
    }
    if (!response.ok) {
      throw new CatalogRequestError('unavailable');
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new CatalogRequestError('unavailable');
    }
    if (!isRecord(parsed)) {
      throw new CatalogRequestError('unavailable');
    }

    this.cache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, body: parsed });
    while (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.cache.delete(oldest);
    }
    return parsed;
  }

  private async fetchWithTimeout(url: string, extraHeaders: Record<string, string>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await this.fetchFn(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          ...extraHeaders,
        },
      });
    } catch {
      throw new CatalogRequestError('unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseWorks(body: Record<string, unknown>): WorkSummary[] {
  if (!Array.isArray(body.docs)) {
    return [];
  }
  const works: WorkSummary[] = [];
  for (const doc of body.docs) {
    if (!isRecord(doc) || typeof doc.key !== 'string' || typeof doc.title !== 'string') {
      continue;
    }
    const workId = doc.key.split('/').pop() ?? '';
    const title = doc.title.trim();
    if (!WORK_ID.test(workId) || !title) {
      continue;
    }
    const authors = Array.isArray(doc.author_name)
      ? doc.author_name
          .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
          .map((name) => name.trim().slice(0, 200))
          .slice(0, MAX_AUTHORS)
      : [];
    const year =
      typeof doc.first_publish_year === 'number' && Number.isInteger(doc.first_publish_year)
        ? doc.first_publish_year
        : null;
    works.push({ workId, title: title.slice(0, MAX_TITLE), authors, firstPublishYear: year });
    if (works.length >= 10) {
      break;
    }
  }
  return works;
}

function parseEditionSummary(entry: Record<string, unknown>): EditionSummary | null {
  const editionId = editionIdFrom(entry, '');
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  if (!editionId || !title) {
    return null;
  }
  const publishedDate = firstString(entry.publish_date);
  return {
    editionId,
    title: title.slice(0, MAX_TITLE),
    publisher: firstString(entry.publishers),
    publishedDate,
    publishedYear: yearOf(publishedDate),
    isbn: firstString(entry.isbn_13) ?? firstString(entry.isbn_10),
    language: languageCode(entry.languages),
  };
}

function editionIdFrom(record: Record<string, unknown>, fallback: string) {
  if (typeof record.key === 'string') {
    const id = record.key.split('/').pop() ?? '';
    if (EDITION_ID.test(id)) {
      return id;
    }
  }
  return EDITION_ID.test(fallback) ? fallback : '';
}

function workIdFrom(value: unknown) {
  if (!Array.isArray(value) || !isRecord(value[0]) || typeof value[0].key !== 'string') {
    return '';
  }
  const id = value[0].key.split('/').pop() ?? '';
  return WORK_ID.test(id) ? id : '';
}

function authorIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: string[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const raw =
      typeof item.key === 'string'
        ? item.key
        : isRecord(item.author) && typeof item.author.key === 'string'
          ? item.author.key
          : '';
    const id = raw.split('/').pop() ?? '';
    if (AUTHOR_ID.test(id) && !ids.includes(id)) {
      ids.push(id);
    }
    if (ids.length >= MAX_AUTHORS) {
      break;
    }
  }
  return ids;
}

function coverIdOf(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    if (typeof item === 'number' && Number.isInteger(item) && item > 0) {
      return item;
    }
  }
  return null;
}

function firstString(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, 300);
  }
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      return item.trim().slice(0, 300);
    }
    if (isRecord(item) && typeof item.name === 'string' && item.name.trim()) {
      return item.name.trim().slice(0, 300);
    }
  }
  return null;
}

function languageCode(value: unknown) {
  if (!Array.isArray(value) || !isRecord(value[0]) || typeof value[0].key !== 'string') {
    return null;
  }
  const code = value[0].key.split('/').pop() ?? '';
  return code.slice(0, 16) || null;
}

function yearOf(value: string | null) {
  if (!value) {
    return null;
  }
  const match = value.match(/\d{4}/);
  if (!match) {
    return null;
  }
  const year = Number(match[0]);
  if (year < 1 || year > 3000) {
    return null;
  }
  return year;
}

function plainText(value: unknown) {
  const raw =
    typeof value === 'string'
      ? value
      : isRecord(value) && typeof value.value === 'string'
        ? value.value
        : '';
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
  return text ? text.slice(0, MAX_DESCRIPTION) : null;
}

async function readAtMost(response: Response, contentType: string) {
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      total += value.byteLength;
      if (total > MAX_COVER_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  if (total === 0) {
    return null;
  }
  return { bytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), contentType };
}

function imageContentType(header: string | null) {
  if (!header) {
    return null;
  }
  const type = header.split(';', 1)[0].trim().toLowerCase();
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/gif' || type === 'image/webp') {
    return type;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
