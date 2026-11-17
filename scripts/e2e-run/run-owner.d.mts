export type RunOwnerEnv = Record<string, string | undefined>;

export type RunOwnerProbeResult = {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
};

export declare const RUN_LOCK_RESOURCE: string;
export declare const RUN_LOCK_OWNER_ENV: string;
export declare function isGitHubHostedRunner(env?: RunOwnerEnv): boolean;
export declare function assertSerializedRunOwner(options?: {
  env?: RunOwnerEnv;
  parentPid?: number;
  probe?: (observer: string, env: RunOwnerEnv) => RunOwnerProbeResult;
}): void;
