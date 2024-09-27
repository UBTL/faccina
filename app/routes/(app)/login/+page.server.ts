import { loginSchema } from '$lib/schemas';
import { lucia } from '$lib/server/auth';
import { error, fail, redirect } from '@sveltejs/kit';
import config from '~shared/config';
import db from '~shared/db';
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!config.site.enableUsers) {
		error(404, { message: 'Not Found' });
	}

	if (locals.user) {
		redirect(302, '/');
	}

	return {
		form: await superValidate(zod(loginSchema)),
	};
};

export const actions: Actions = {
	default: async (event) => {
		const form = await superValidate(event, zod(loginSchema));

		if (!config.site.enableUsers) {
			return fail(400, {
				message: 'Users are disabled',
				form,
			});
		}

		if (!form.valid) {
			return fail(400, {
				form,
			});
		}

		const username = form.data.username;
		const password = form.data.password;

		const user = await db
			.selectFrom('users')
			.select(['id', 'password_hash'])
			.where('username', '=', username)
			.executeTakeFirst();

		if (!user) {
			return fail(400, {
				message: 'Incorrect username or password',
				form,
			});
		}

		const validPassword = await Bun.password.verify(password, user.password_hash, 'argon2id');

		if (!validPassword) {
			return fail(400, {
				message: 'Incorrect username or password',
				form,
			});
		}

		const session = await lucia().createSession(user.id, {});
		const sessionCookie = lucia().createSessionCookie(session.id);

		event.cookies.set(sessionCookie.name, sessionCookie.value, {
			path: '.',
			...sessionCookie.attributes,
		});

		const redirectTo = event.url.searchParams.get('to');

		if (redirectTo) {
			redirect(302, redirectTo);
		}

		return {
			form,
		};
	},
};