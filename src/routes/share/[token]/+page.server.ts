import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readSharedSnapshot } from '#lib/server/personal-learning/sharing/index.js';

export const load: PageServerLoad = async ({ params }) => {
  const snapshot = await readSharedSnapshot(params.token);
  if (!snapshot) error(404, 'This learning snapshot is unavailable.');
  return { snapshot };
};
