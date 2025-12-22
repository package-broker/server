// Queue message types

/**
 * Queue message types for async database updates
 */
export type QueueMessage =
  | {
      type: 'update_token_last_used';
      tokenId: string;
      timestamp: number;
    }
  | {
      type: 'update_artifact_download';
      artifactId: string;
      timestamp: number;
    }
  | {
      type: 'update_repository_sync';
      repoId: string;
      status: 'active' | 'error';
      errorMessage?: string;
      timestamp: number;
    };




