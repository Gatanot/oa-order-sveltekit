import type { ArtifactVisitor } from '$lib/artifact-visitor';
import type { CurrentIdentity } from '$lib/server/identity';
import type { AiServiceIdentity } from '$lib/server/ai-service';

declare global {
  namespace App {
    interface Locals {
      getAiIdentity: () => Promise<AiServiceIdentity | null>;
      getArtifactVisitor: () => Promise<ArtifactVisitor>;
      getCurrentIdentity: () => Promise<CurrentIdentity | null>;
      getAdminIdentity: () => Promise<CurrentIdentity | null>;
    }
  }
}

export {};
