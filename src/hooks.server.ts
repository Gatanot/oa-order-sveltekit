import { json, type Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
};

export function handleError({ error }: { error: unknown }) {
  console.error(error);
  return { message: '服务器内部错误' };
}
