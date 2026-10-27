import { isIP } from 'node:net';

export type LearningSource = {
	id: string;
	title: string;
	url: string;
	content: string;
	retrievedAt: string;
};

const jinaSearchUrl = 'https://s.jina.ai/search';
const maxResponseBytes = 256_000;
const maxContentLength = 40_000;

function isPublicWebUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase();
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
		if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') || !hostname.includes('.')) return null;
		// Literal addresses are unnecessary for source discovery and cannot be safely allowlisted here.
		if (isIP(hostname)) return null;
		return url;
	} catch {
		return null;
	}
}

export function validateLearningSourceUrl(value: string): string | null {
	return isPublicWebUrl(value)?.toString() ?? null;
}

async function readBoundedBody(response: Response): Promise<string> {
	if (!response.body) throw new Error('Source search unavailable');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxResponseBytes) {
			await reader.cancel();
			throw new Error('Source search unavailable');
		}
		chunks.push(value);
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

export async function searchLearningSources(
	input: { query: string; sourceUrl?: string },
	options: { apiKey: string; fetchImpl?: typeof fetch; maxResults?: number }
): Promise<LearningSource[]> {
	if (!options.apiKey.trim()) throw new Error('Source search unavailable');
	if (input.sourceUrl && !isPublicWebUrl(input.sourceUrl)) throw new Error('Invalid source URL');
	const maxResults = options.maxResults ?? 3;
	if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 3) throw new Error('Source search unavailable');

	const query = input.sourceUrl
		? `site:${new URL(input.sourceUrl).hostname} ${input.query}`
		: input.query;
	try {
		const response = await (options.fetchImpl ?? fetch)(jinaSearchUrl, {
			method: 'POST',
			redirect: 'error',
			headers: {
				Authorization: `Bearer ${options.apiKey}`,
				Accept: 'application/json',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ q: query, num: maxResults }),
			signal: AbortSignal.timeout(20_000)
		});
		if (!response.ok) throw new Error('Source search unavailable');
		const payload: unknown = JSON.parse(await readBoundedBody(response));
		if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) {
			throw new Error('Source search unavailable');
		}

		const data = (payload as { data: unknown[] }).data.slice(0, maxResults);
		const retrievedAt = new Date().toISOString();
		const sources = data.map((item, index): LearningSource | null => {
			if (!item || typeof item !== 'object') return null;
			const result = item as { title?: unknown; url?: unknown; content?: unknown; description?: unknown };
			if (typeof result.title !== 'string' || !result.title.trim() || typeof result.url !== 'string') return null;
			const url = isPublicWebUrl(result.url);
			const content = typeof result.content === 'string' ? result.content : result.description;
			if (!url || typeof content !== 'string' || !content.trim()) return null;
			if (input.sourceUrl && url.hostname.toLowerCase() !== new URL(input.sourceUrl).hostname.toLowerCase()) return null;
			return {
				id: `source-${index + 1}`,
				title: result.title.trim().slice(0, 500),
				url: url.toString(),
				content: content.trim().slice(0, maxContentLength),
				retrievedAt
			};
		});
		if (!sources.length || sources.some((source) => source === null)) throw new Error('Source search unavailable');
		return sources as LearningSource[];
	} catch {
		throw new Error('Source search unavailable');
	}
}
