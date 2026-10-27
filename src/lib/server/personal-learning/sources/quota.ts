import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { learningJourney } from '../../db/schema/personal-learning';

export async function reserveLearningSourceSearch(journeyId: string): Promise<{ maxResults: number }> {
	return db.transaction(async (tx) => {
		const [journey] = await tx.select({ searchesUsed: learningJourney.searchesUsed, sourcePagesUsed: learningJourney.sourcePagesUsed })
			.from(learningJourney).where(eq(learningJourney.id, journeyId)).for('update');
		if (!journey || journey.searchesUsed >= 5 || journey.sourcePagesUsed >= 10) {
			throw new Error('Source search quota exhausted');
		}

		const maxResults = Math.min(3, 10 - journey.sourcePagesUsed);
		await tx.update(learningJourney).set({
			searchesUsed: journey.searchesUsed + 1,
			sourcePagesUsed: journey.sourcePagesUsed + maxResults
		}).where(eq(learningJourney.id, journeyId));
		return { maxResults };
	});
}

export async function releaseUnusedSourcePages(journeyId: string, reservedPages: number, usedPages: number): Promise<void> {
	const unused = reservedPages - usedPages;
	if (unused <= 0) return;
	await db.transaction(async (tx) => {
		const [journey] = await tx.select({ sourcePagesUsed: learningJourney.sourcePagesUsed })
			.from(learningJourney).where(eq(learningJourney.id, journeyId)).for('update');
		if (!journey || journey.sourcePagesUsed < unused) throw new Error('Source quota reservation unavailable');
		await tx.update(learningJourney).set({ sourcePagesUsed: journey.sourcePagesUsed - unused })
			.where(eq(learningJourney.id, journeyId));
	});
}
