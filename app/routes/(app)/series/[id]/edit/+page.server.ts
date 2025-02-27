import { error } from '@sveltejs/kit';
import { fail, message, setError, superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { sortArchiveTags } from '$lib/server/utils.js';
import { createSeriesSchema } from '$lib/schemas';
import db from '~shared/db';
import { jsonArrayFrom, now } from '~shared/db/helpers';

export const load = async ({ params, locals }) => {
	if (!locals.user?.admin) {
		error(403, { message: 'Not allowed', status: 403 });
	}

	const id = parseInt(params.id);

	if (isNaN(id)) {
		throw error(400, { message: 'Invalid ID', status: 400 });
	}

	const series = await db
		.selectFrom('series')
		.select((eb) => [
			'id',
			'title',
			jsonArrayFrom(
				eb
					.selectFrom('seriesArchive')
					.innerJoin('archives', 'archives.id', 'archiveId')
					.select((eb) => [
						'archives.id',
						'archives.hash',
						'archives.title',
						'archives.pages',
						'archives.thumbnail',
						'archives.deletedAt',
						jsonArrayFrom(
							eb
								.selectFrom('archiveTags')
								.innerJoin('tags', 'tags.id', 'tagId')
								.select(['tags.namespace', 'tags.name'])
								.whereRef('archives.id', '=', 'archiveId')
								.orderBy('archiveTags.createdAt asc')
						).as('tags'),
					])
					.orderBy('order asc')
					.whereRef('seriesId', '=', 'series.id')
			).as('chapters'),
		])
		.where('id', '=', id)
		.executeTakeFirst();

	if (!series) {
		error(404, { message: 'Series not found' });
	}

	series.chapters = series.chapters.map(sortArchiveTags);

	return {
		series,
		form: await superValidate(
			{
				title: series.title,
				chapters: series.chapters.map((chapter) => chapter.id),
			},
			zod(createSeriesSchema)
		),
	};
};

export const actions = {
	default: async (event) => {
		const form = await superValidate(event, zod(createSeriesSchema));

		if (!event.locals.user?.admin) {
			return message(form, 'You are not allowed to perform this action', { status: 403 });
		}

		if (!form.valid) {
			return fail(400, { form });
		}

		const series = await db
			.selectFrom('series')
			.select('id')
			.where('id', '=', parseInt(event.params.id) || 0)
			.executeTakeFirst();

		if (!series) {
			return fail(404, { message: 'This series does not exists' });
		}

		const { title, chapters } = form.data;

		const existant = await db
			.selectFrom('series')
			.select('id')
			.where('title', '=', title)
			.where('id', '!=', series.id)
			.limit(1)
			.executeTakeFirst();

		if (existant) {
			return setError(form, 'title', 'A series with the same title already exists');
		}

		await db.transaction().execute(async (trx) => {
			await trx
				.updateTable('series')
				.set({ title, updatedAt: now() })
				.where('id', '=', series.id)
				.execute();

			const seriesArchive = await trx
				.selectFrom('seriesArchive')
				.select('archiveId')
				.where('seriesId', '=', series.id)
				.execute();

			const relationsDelete = seriesArchive.filter(
				(relation) => !chapters.some((id) => id === relation.archiveId)
			);

			if (relationsDelete.length) {
				await trx
					.deleteFrom('seriesArchive')
					.where(
						'archiveId',
						'in',
						relationsDelete.map((relation) => relation.archiveId)
					)
					.where('seriesId', '=', series.id)
					.execute();
			}

			if (chapters.length) {
				await trx
					.insertInto('seriesArchive')
					.values(
						chapters.map((id, i) => ({
							archiveId: id,
							seriesId: series.id,
							order: i,
							updatedAt: now(),
						}))
					)
					.onConflict((oc) =>
						oc.columns(['seriesId', 'archiveId']).doUpdateSet((eb) => ({
							order: eb.ref('excluded.order'),
						}))
					)
					.execute();
			}
		});

		return { form };
	},
};
