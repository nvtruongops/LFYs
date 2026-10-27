<script lang="ts">
  import { goto } from '$app/navigation';

  let mode: 'sign-in' | 'sign-up' = $state('sign-in');
  let errorMessage = $state('');
  let pending = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    errorMessage = '';
    pending = true;

    const form = new FormData(event.currentTarget as HTMLFormElement);
    const body = Object.fromEntries(form.entries());
    try {
      const response = await fetch(`/api/auth/${mode}/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error('Authentication failed');
      await goto('/learning');
    } catch {
      errorMessage = 'Could not authenticate with those details.';
    } finally {
      pending = false;
    }
  }
</script>

<svelte:head>
  <title>Sign in — LFYs</title>
</svelte:head>

<main>
  <h1>{mode === 'sign-in' ? 'Sign in' : 'Create your account'}</h1>
  <form onsubmit={submit}>
    {#if mode === 'sign-up'}
      <label>
        Name
        <input name="name" autocomplete="name" required />
      </label>
    {/if}
    <label>
      Email
      <input name="email" type="email" autocomplete="email" required />
    </label>
    <label>
      Password
      <input name="password" type="password" autocomplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required />
    </label>
    {#if errorMessage}
      <p role="alert">{errorMessage}</p>
    {/if}
    <button type="submit" disabled={pending}>{pending ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
  </form>
  <button type="button" onclick={() => (mode = mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
    {mode === 'sign-in' ? 'Create an account' : 'Already have an account? Sign in'}
  </button>
</main>
