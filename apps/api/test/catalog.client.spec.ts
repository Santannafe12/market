import { CatalogClient, MAX_COVER_BYTES } from '../src/catalog/catalog.client';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Open Library client', () => {
  it('fails when Open Library does not answer within 4 seconds', async () => {
    jest.useFakeTimers();
    try {
      const client = new CatalogClient((_input, init) => {
        return new Promise((_resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          const signal = init?.signal;
          if (!signal) {
            return;
          }
          if (signal.aborted) {
            abort();
            return;
          }
          signal.addEventListener('abort', abort, { once: true });
        });
      });
      const pending = client.search('hobbit');
      const assertion = expect(pending).rejects.toMatchObject({ reason: 'unavailable' });
      await jest.advanceTimersByTimeAsync(4_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats HTTP 500 as unavailable and does not cache the failure', async () => {
    const fetchMock = jest.fn(async () => new Response('down', { status: 500 }));
    const client = new CatalogClient(fetchMock);
    await expect(client.search('hobbit')).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(client.search('hobbit')).rejects.toMatchObject({ reason: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a missing edition as not found', async () => {
    const fetchMock = jest.fn(async () => new Response('missing', { status: 404 }));
    const client = new CatalogClient(fetchMock);
    await expect(client.edition('OL99M')).rejects.toMatchObject({ reason: 'not_found' });
    await expect(client.edition('not-an-id')).rejects.toMatchObject({ reason: 'not_found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads a work, caches the JSON and keeps the description as text', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get('user-agent')).toContain('CasaDeLeiloesEliteDev');
      if (url.includes('/search.json')) {
        return json({
          docs: [
            {
              key: '/works/OL10W',
              title: 'O Hobbit',
              author_name: ['J. R. R. Tolkien'],
              first_publish_year: 1937,
            },
          ],
        });
      }
      if (url.includes('/books/')) {
        return json({
          key: '/books/OL10M',
          title: 'O Hobbit',
          description: { value: '<p>Um <b>hobbit</b>.</p>' },
          authors: [{ key: '/authors/OL1A' }],
          publish_date: '1937',
          publishers: ['Allen & Unwin'],
          isbn_13: ['9780000000000'],
          languages: [{ key: '/languages/por' }],
          works: [{ key: '/works/OL10W' }],
          covers: [42, -1],
        });
      }
      if (url.includes('/authors/')) {
        return json({ name: 'Tolkien' });
      }
      return new Response('no', { status: 500 });
    });

    const client = new CatalogClient(fetchMock);
    const works = await client.search('hobbit');
    await client.search('hobbit');
    expect(works).toEqual([
      {
        workId: 'OL10W',
        title: 'O Hobbit',
        authors: ['J. R. R. Tolkien'],
        firstPublishYear: 1937,
      },
    ]);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('/search.json'))).toHaveLength(1);

    const detail = await client.edition('OL10M');
    expect(detail).toMatchObject({
      editionId: 'OL10M',
      workId: 'OL10W',
      title: 'O Hobbit',
      authors: ['Tolkien'],
      publisher: 'Allen & Unwin',
      publishedYear: 1937,
      isbn: '9780000000000',
      language: 'por',
      description: 'Um hobbit.',
      coverId: 42,
    });
  });

  it('keeps at most 100 catalog responses', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const query = new URL(String(input)).searchParams.get('q');
      return json({
        docs: [{ key: '/works/OL10W', title: query, author_name: [], first_publish_year: null }],
      });
    });
    const client = new CatalogClient(fetchMock);
    for (let index = 0; index < 101; index += 1) {
      await client.search(`livro ${index} x`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(101);
    await client.search('livro 0 x');
    expect(fetchMock).toHaveBeenCalledTimes(102);
    await client.search('livro 100 x');
    expect(fetchMock).toHaveBeenCalledTimes(102);
  });

  it('returns no bytes when the cover is missing or larger than 1.5 MB', async () => {
    const missing = new CatalogClient(async () => new Response('no', { status: 404 }));
    await expect(missing.downloadCover(15)).resolves.toBeNull();
    await expect(missing.downloadCover(null)).resolves.toBeNull();

    const oversized = new CatalogClient(
      async () =>
        new Response(Buffer.alloc(MAX_COVER_BYTES + 1), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    );
    await expect(oversized.downloadCover(15)).resolves.toBeNull();
  });
});

// Real call, off by default. Run with OPEN_LIBRARY_LIVE=1.
const live = process.env.OPEN_LIBRARY_LIVE === '1' ? describe : describe.skip;
live('Open Library live call', () => {
  it('searches a known work and reads one edition', async () => {
    const client = new CatalogClient(globalThis.fetch);
    const works = await client.search('fantastic mr fox');
    expect(works.length).toBeGreaterThan(0);
    expect(works[0].workId).toMatch(/^OL\d+W$/);
    const editions = await client.editions(works[0].workId);
    expect(editions.length).toBeGreaterThan(0);
    expect(editions.length).toBeLessThanOrEqual(20);
    const detail = await client.edition(editions[0].editionId);
    expect(detail.title.length).toBeGreaterThan(0);
  }, 20_000);
});
