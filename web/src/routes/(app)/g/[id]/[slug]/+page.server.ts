import { env } from '$env/dynamic/public';
import type { Archive } from '$lib/models';
import { error, isHttpError, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, fetch }) => {
	let archive: Archive;

	try {
		const res = await fetch(`${env.SERVER_URL}/archive/${params.id}/data`);

		if (res.status === 404) {
			return error(404, {
				status: 404,
				statusText: 'Not found',
				message: `The requested gallery wasn't found`,
			});
		}

		archive = await res.json();
	} catch (e) {
		console.error(e);

		if (isHttpError(e)) {
			throw e;
		}

		return error(500, {
			status: 500,
			statusText: 'Internal error',
			message: 'Failed to communicate with the server',
		});
	}

	if (parseInt(params.id) !== archive.id || params.slug !== archive.slug) {
		redirect(301, `/g/${archive.id}/${archive.slug}${url.search}`);
	} else {
		return { archive };
	}
};
