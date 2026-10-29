const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
	const url = new URL(typeof input === 'string' ? input : input.url);

	if (url.href === 'https://s.jina.ai/search') {
		const { q } = JSON.parse(String(init?.body));
		return new Response(JSON.stringify({ data: q.includes('Trigger source failure') && !q.includes('site:example.org') ? [] : [{
			title: 'Battery reference',
			url: 'https://example.org/battery',
			content: 'A battery stores energy chemically and converts it to electrical energy.'
		}] }), { headers: { 'content-type': 'application/json' } });
	}

	if (url.origin === 'http://127.0.0.1:20128' && url.pathname === '/v1/chat/completions') {
		const body = JSON.parse(String(init?.body));
		const system = body.messages.find((message) => message.role === 'system')?.content ?? '';
		const content = system.includes('Create one concise source-based learning session')
			? JSON.stringify({
				title: 'Battery basics',
				lesson: 'A battery stores energy chemically. [source-1]',
				activityMinutes: 20,
				citations: [{ sourceId: 'source-1', relationship: 'Explains how batteries store energy.' }]
			})
			: 'A battery stores energy chemically.';
		return new Response(JSON.stringify({
			id: 'playwright-mock-completion',
			object: 'chat.completion',
			created: 1,
			model: 'playwright-test-model',
			choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
			usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 }
		}), { headers: { 'content-type': 'application/json' } });
	}

	return realFetch(input, init);
};
