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
  // Artifact 发布入口使用 sandbox iframe 内嵌工作台；不发送 X-Frame-Options 或 frame-ancestors，
  // 否则沙箱 iframe 的不透明来源会被浏览器拦截。应用没有本地会话，放开嵌入限制只影响展示层。
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
};

export const handleError: HandleServerError = ({ error }) => {
  console.error(error);
  return { message: '服务器内部错误' };
};
