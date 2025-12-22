// Shared TypeScript types

export type CredentialType =
  | 'http_basic'
  | 'github_token'
  | 'gitlab_token'
  | 'bitbucket_app_password'
  | 'bitbucket_api_token'
  | 'bitbucket_api_key'
  | 'bitbucket_server_pat'
  | 'bearer_token'
  | 'none';
// 'ssh_key' - DEFERRED: Workers cannot execute git clone operations

export type VcsType = 'git' | 'composer' | 'artifact';

export interface CredentialConfig {
  type: CredentialType;
  fields: Record<string, string>; // Dynamic fields based on type
}

export interface WorkerConfig {
  storage: 'r2' | 's3';
  s3Config?: S3Config;
  metadataTTL?: number; // seconds
}

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

