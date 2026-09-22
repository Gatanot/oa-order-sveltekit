export type ArtifactViewer = {
  id: string;
  uid: number;
  username: string;
};

export type ArtifactVisitor =
  | {
      status: 'authenticated';
      authenticated: true;
      viewer: ArtifactViewer;
      topicId: string | null;
    }
  | {
      status: 'guest';
      authenticated: false;
      viewer: null;
      topicId: string | null;
    }
  | {
      status: 'unavailable';
      authenticated: false;
      viewer: null;
      topicId: null;
      reason: 'not_configured' | 'gateway_error' | 'invalid_response';
    };

export type PublicArtifactVisitor =
  | {
      status: 'authenticated';
      authenticated: true;
      id: string;
      uid: number;
      username: string;
    }
  | {
      status: 'guest' | 'unavailable';
      authenticated: false;
      username: null;
    };

export function toPublicArtifactVisitor(visitor: ArtifactVisitor): PublicArtifactVisitor {
  if (visitor.status === 'authenticated') {
    return {
      status: visitor.status,
      authenticated: true,
      id: visitor.viewer.id,
      uid: visitor.viewer.uid,
      username: visitor.viewer.username
    };
  }

  return { status: visitor.status, authenticated: false, username: null };
}
