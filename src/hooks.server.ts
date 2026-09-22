import type { Handle, HandleServerError } from '@sveltejs/kit';
import { getArtifactVisitor } from '$lib/server/artifact-visitor';

export const handle: Handle = async ({ event, resolve }) => {
  let visitor: ReturnType<typeof getArtifactVisitor> | undefined;
  event.locals.getArtifactVisitor = () => {
    visitor ??= getArtifactVisitor({
      cookie: event.request.headers.get('cookie') || '',
      authorization: event.request.headers.get('authorization') || ''
    });
    return visitor;
  };

  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
};

export const handleError: HandleServerError = ({ error }) => {
  console.error(error);
  return { message: '服务器内部错误' };
};
