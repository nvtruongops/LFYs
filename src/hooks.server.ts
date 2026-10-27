import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { auth } from '#lib/server/auth/index.js';
import { startLearningWorker } from '#lib/server/jobs/index.js';

export const init: ServerInit = async () => {
  if (!building) await startLearningWorker();
};

export const handle: Handle = async ({ event, resolve }) => {
  if (event.request.headers.has('cookie')) {
    const session = await auth.api.getSession({ headers: event.request.headers });
    event.locals.session = session?.session ?? null;
    event.locals.user = session?.user ?? null;
  } else {
    event.locals.session = null;
    event.locals.user = null;
  }

  return svelteKitHandler({ event, resolve, auth, building });
};
