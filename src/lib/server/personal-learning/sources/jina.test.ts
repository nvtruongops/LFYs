import { describe, expect, it, vi } from 'vitest';
import { searchLearningSources } from './jina';

const jinaResponse = (data: unknown) => new Response(JSON.stringify({ data }), {
	status: 200,
	headers: { 'content-type': 'application/json' }
});

describe('Jina learning source search', () => {
	it('uses the fixed authenticated JSON endpoint and returns at most three bounded sources', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jinaResponse(Array.from({ length: 4 }, (_, index) => ({
			title: `Source ${index}`,
			url: `https://example${index}.org/page`,
			content: 'Evidence '.repeat(6000)
		}))));

		const sources = await searchLearningSources({ query: 'learn biology' }, { apiKey: 'secret', fetchImpl });

		expect(fetchImpl).toHaveBeenCalledOnce();
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('https://s.jina.ai/search');
		expect(init.headers).toMatchObject({ Authorization: 'Bearer secret', Accept: 'application/json' });
		expect(init.redirect).toBe('error');
		expect(JSON.parse(init.body)).toMatchObject({ q: 'learn biology', num: 3 });
		expect(sources).toHaveLength(3);
		expect(sources[0]).toMatchObject({ id: 'source-1', title: 'Source 0', url: 'https://example0.org/page' });
		expect(sources[0].content).toHaveLength(40_000);
		expect(sources[0].retrievedAt).toEqual(expect.any(String));
	});

	it('restricts an optional learner URL to its host without fetching that URL', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jinaResponse([{ title: 'Docs', url: 'https://docs.example.org/a', content: 'Text' }]));

		await searchLearningSources({ query: 'specific topic', sourceUrl: 'https://docs.example.org/start' }, { apiKey: 'secret', fetchImpl });

		expect(JSON.parse(fetchImpl.mock.calls[0][1].body).q).toBe('site:docs.example.org specific topic');
		expect(fetchImpl.mock.calls[0][0]).toBe('https://s.jina.ai/search');
	});

	it('never accepts more results than the reserved page quota', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jinaResponse(Array.from({ length: 3 }, (_, index) => ({
			title: `Source ${index}`, url: `https://example${index}.org/page`, content: 'Evidence'
		}))));

		const sources = await searchLearningSources({ query: 'topic' }, { apiKey: 'secret', maxResults: 1, fetchImpl });

		expect(sources).toHaveLength(1);
		expect(JSON.parse(fetchImpl.mock.calls[0][1].body).num).toBe(1);
	});

	it('fails closed for missing credentials, unsuccessful responses, malformed JSON, invalid URLs, and no results', async () => {
		await expect(searchLearningSources({ query: 'topic' }, { apiKey: '' })).rejects.toThrow('Source search unavailable');
		await expect(searchLearningSources({ query: 'topic' }, { apiKey: 'secret', fetchImpl: vi.fn().mockResolvedValue(new Response('sensitive provider body', { status: 401 })) })).rejects.toThrow('Source search unavailable');
		await expect(searchLearningSources({ query: 'topic' }, { apiKey: 'secret', fetchImpl: vi.fn().mockResolvedValue(new Response('{', { status: 200 })) })).rejects.toThrow('Source search unavailable');
		await expect(searchLearningSources({ query: 'topic' }, { apiKey: 'secret', fetchImpl: vi.fn().mockResolvedValue(new Response('x'.repeat(256_001), { status: 200 })) })).rejects.toThrow('Source search unavailable');
		await expect(searchLearningSources({ query: 'topic' }, { apiKey: 'secret', fetchImpl: vi.fn().mockResolvedValue(jinaResponse([{ title: 'Local', url: 'http://127.0.0.1/admin', content: 'private' }])) })).rejects.toThrow('Source search unavailable');
		await expect(searchLearningSources({ query: 'topic' }, { apiKey: 'secret', fetchImpl: vi.fn().mockResolvedValue(jinaResponse([])) })).rejects.toThrow('Source search unavailable');
	});

	it('rejects learner URLs with credentials or a private literal host before making a request', async () => {
		const fetchImpl = vi.fn();
		await expect(searchLearningSources({ query: 'topic', sourceUrl: 'https://user:pass@example.org' }, { apiKey: 'secret', fetchImpl })).rejects.toThrow('Invalid source URL');
		await expect(searchLearningSources({ query: 'topic', sourceUrl: 'http://192.168.1.2/docs' }, { apiKey: 'secret', fetchImpl })).rejects.toThrow('Invalid source URL');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
