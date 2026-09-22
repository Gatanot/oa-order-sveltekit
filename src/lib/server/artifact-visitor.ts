import type { ArtifactVisitor } from '$lib/artifact-visitor';

const APP_ID_PATTERN = /^[a-z][a-z0-9_-]{0,47}$/;

type ForwardedCredentials = {
  cookie: string;
  authorization: string;
};

export async function getArtifactVisitor(credentials: ForwardedCredentials): Promise<ArtifactVisitor> {
  const appId = process.env.ARTIFACT_APP_ID?.trim() || '';
  if (!APP_ID_PATTERN.test(appId)) {
    return {
      status: 'unavailable',
      authenticated: false,
      viewer: null,
      topicId: null,
      reason: 'not_configured'
    };
  }

  try {
    const gatewayOrigin = process.env.ARTIFACT_GATEWAY_ORIGIN?.trim() || 'https://artifact.catsco.cc';
    const endpoint = new URL('/_gateway/me', gatewayOrigin);
    endpoint.searchParams.set('app', appId);
    const response = await fetch(endpoint, {
      headers: {
        cookie: credentials.cookie,
        authorization: credentials.authorization
      },
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) throw new Error(`Artifact gateway returned HTTP ${response.status}`);

    const raw: unknown = await response.json();
    if (!raw || typeof raw !== 'object') return invalidResponse();
    const payload = raw as Record<string, unknown>;
    const topicId = typeof payload.topic_id === 'string' ? payload.topic_id : null;
    if (payload.authenticated === false) {
      return { status: 'guest', authenticated: false, viewer: null, topicId };
    }

    const viewer = payload.viewer;
    if (payload.authenticated !== true || !viewer || typeof viewer !== 'object') return invalidResponse();
    const fields = viewer as Record<string, unknown>;
    if (typeof fields.id !== 'string' || typeof fields.username !== 'string' || typeof fields.uid !== 'number') {
      return invalidResponse();
    }

    return {
      status: 'authenticated',
      authenticated: true,
      viewer: { id: fields.id, uid: fields.uid, username: fields.username },
      topicId
    };
  } catch (reason) {
    console.error('Artifact visitor lookup failed', reason instanceof Error ? reason.message : reason);
    return {
      status: 'unavailable',
      authenticated: false,
      viewer: null,
      topicId: null,
      reason: 'gateway_error'
    };
  }
}

function invalidResponse(): ArtifactVisitor {
  return {
    status: 'unavailable',
    authenticated: false,
    viewer: null,
    topicId: null,
    reason: 'invalid_response'
  };
}
