<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Shared learning journey — LFYs</title>
</svelte:head>

<main>
  <h1>{data.snapshot.goal}</h1>
  <p>{data.snapshot.studyDays} planned study sessions</p>
  {#each data.snapshot.sessions as session (session.index)}
    <article>
      <h2>Session {session.index}: {session.title}</h2>
      <p>{session.lesson}</p>
      <p>{session.activityMinutes} minutes</p>
      <h3>Sources</h3>
      <ul>
          {#each session.sources as source, index (`${source.id ?? source.url}-${index}`)}
          <li>{#if source.id}<span>[{source.id}]</span> {/if}<a href={source.url} rel="noreferrer">{source.name}</a> — {source.relationship}</li>
        {/each}
      </ul>
    </article>
  {/each}
</main>
