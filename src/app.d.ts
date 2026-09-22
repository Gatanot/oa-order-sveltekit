import type { ArtifactVisitor } from '$lib/artifact-visitor';

declare global {
  namespace App {
    interface Locals {
      getArtifactVisitor: () => Promise<ArtifactVisitor>;
    }
  }
}

export {};
