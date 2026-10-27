<script lang="ts">
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Personal Learning — LFYs</title>
</svelte:head>

<main>
  <h1>Personal Learning</h1>
  <p>Hi {data.learnerName}. Ask a question and get an answer before deciding whether to start a learning journey.</p>

  <form method="POST" action="?/ask">
    <label>
      Your question
      <textarea name="question" maxlength="2000" required></textarea>
    </label>
    <label>
      What would you like to learn?
      <input name="goal" maxlength="500" required />
    </label>
    <label>
      Answer language
      <input name="language" value="English" maxlength="80" required />
    </label>
    <label>
      What do you already know? (optional)
      <textarea name="priorKnowledge" maxlength="1000"></textarea>
    </label>
    <button type="submit">Answer my question</button>
  </form>

  {#if form?.error}
    <p role="alert">{form.error}</p>
  {/if}

  {#if form?.answer}
    <section aria-labelledby="answer-heading" aria-live="polite">
      <h2 id="answer-heading">Your answer</h2>
      <p>{form.answer}</p>
      <p><strong>AI-generated; sources have not been verified.</strong></p>

      {#if form.offer}
        <section aria-labelledby="offer-heading">
          <h3 id="offer-heading">Want to explore this further?</h3>
          <p>A learning journey creates one first session only after you accept. Study days are learning sessions, not calendar deadlines.</p>
          <form method="POST" action="?/accept">
            <input type="hidden" name="conversationId" value={form.conversationId} />
            <label>
              Learning goal
              <input name="goal" value={form.goal} maxlength="500" required />
            </label>
            <label>
              Study sessions
              <select name="studyDays">
                <option value="1">1 session</option>
                <option value="7" selected>7 sessions</option>
                <option value="30">30 sessions</option>
              </select>
            </label>
            <label>
              Activity time per session
              <select name="dailyMinutes">
                <option value="30" selected>30 minutes</option>
                <option value="60">60 minutes</option>
                <option value="120">120 minutes</option>
              </select>
            </label>
            <button type="submit">Accept and create journey</button>
          </form>
          <form method="POST" action="?/dismiss">
            <input type="hidden" name="conversationId" value={form.conversationId} />
            <button type="submit">Not now</button>
          </form>
        </section>
      {/if}
    </section>
  {/if}

  {#if form?.accepted}
    <p role="status">Journey created. Session 1 is queued for source-backed lesson generation.</p>
  {/if}
  {#if form?.retried}
    <p role="status">Session 1 has been queued for another attempt.</p>
  {/if}
  {#if form?.dismissed}
    <p role="status">No journey was created.</p>
  {/if}

  {#each data.journeys as journey (journey.sessionId)}
    <section aria-label={`Learning journey: ${journey.goal}`}>
      <h2>{journey.goal}</h2>
      <p role="status">Session {journey.sessionIndex} status: {journey.sessionStatus}</p>
      {#if journey.sessionStatus === 'ready'}
        <article>
          <h3>{journey.title}</h3>
          <p>{journey.lesson}</p>
          <p>Activity: {journey.activityMinutes} minutes</p>
          <h4>Sources</h4>
          <ul>
            {#each journey.sourceManifest as source, index (`${source.id ?? source.url}-${index}`)}
              <li>{#if source.id}<span>[{source.id}]</span> {/if}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a> — {source.relationship}</li>
            {/each}
          </ul>
          <p><strong>AI-generated lesson; source links are provided, but claims have not been independently fact-checked.</strong></p>
        </article>
      {:else if journey.sessionStatus === 'failed' && journey.sessionIndex === 1}
        <p role="alert">We could not generate this lesson from available sources. You can retry or provide a public source URL.</p>
        <form method="POST" action="?/retry">
          <input type="hidden" name="sessionId" value={journey.sessionId} />
          <label>
            Optional public source URL
            <input name="sourceUrl" type="url" maxlength="2048" />
          </label>
          <button type="submit">Retry session 1</button>
        </form>
      {/if}
    </section>
  {/each}
</main>
