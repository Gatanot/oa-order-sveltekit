import type { ArtifactVisitor } from '$lib/artifact-visitor';
import type { CurrentIdentity } from '$lib/server/identity';

declare global {
  namespace App {
    interface Locals {
      getArtifactVisitor: () => Promise<ArtifactVisitor>;
      getCurrentIdentity: () => Promise<CurrentIdentity | null>;
    }
  }
}

export {};
