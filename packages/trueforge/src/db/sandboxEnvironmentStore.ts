/**
 * DB-backed sandbox environments: parent row + immutable version rows.
 * Implementations: PostgresSandboxEnvironmentStore and SqliteSandboxEnvironmentStore.
 */
import type { CreatedBySubject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import type { ResourceName } from '../schemas/common';
import type {
  SandboxEnvironmentLifecycleStage,
  SandboxEnvironmentVersionInternalMetadata,
  SandboxEnvironmentVersionStatus,
  StoredSandboxEnvironmentManifest,
} from '../schemas/sandboxEnvironment';
import { StoredSandboxEnvironmentManifestSchema } from '../schemas/sandboxEnvironment';

export interface SandboxEnvironmentRecord {
  id: string;
  tenant_id: string;
  name: ResourceName;
  description: string;
  active_version: number;
  lifecycle_stage: SandboxEnvironmentLifecycleStage;
  created_by_subject: CreatedBySubject;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface SandboxEnvironmentVersionRecord {
  id: string;
  environment_id: string;
  version: number;
  manifest: StoredSandboxEnvironmentManifest;
  status: SandboxEnvironmentVersionStatus;
  status_reason: string | null;
  external_ref: string;
  internal_metadata: SandboxEnvironmentVersionInternalMetadata;
  created_by_subject: CreatedBySubject;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

/** Parent + its active version row (list/get join). */
export interface SandboxEnvironmentWithVersion {
  environment: SandboxEnvironmentRecord;
  version: SandboxEnvironmentVersionRecord;
}

export function parseStoredSandboxEnvironmentManifest(manifest: unknown): StoredSandboxEnvironmentManifest {
  return StoredSandboxEnvironmentManifestSchema.parse(manifest);
}

export interface ListSandboxEnvironmentsInput {
  tenant_id: string;
  /** Only environments created by this subject. */
  created_by_subject_id: string;
  limit: number | undefined;
  page_token: string | undefined;
}

export interface GetSandboxEnvironmentInput {
  tenant_id: string;
  name: string;
  /** Only return the environment if created by this subject. */
  created_by_subject_id: string;
}

/** Version columns written on create/update (store fills environment_id). */
export interface SandboxEnvironmentVersionWrite {
  version: number;
  manifest: StoredSandboxEnvironmentManifest;
  status: SandboxEnvironmentVersionStatus;
  status_reason: string | null;
  external_ref: string;
  internal_metadata: SandboxEnvironmentVersionInternalMetadata;
  created_by_subject: CreatedBySubject;
}

export interface CreateSandboxEnvironmentInput {
  tenant_id: string;
  name: ResourceName;
  description: string;
  created_by_subject: CreatedBySubject;
  /** Called to build the first version row; `needs_snapshot` is passed through on the create result. */
  buildVersion: () => SandboxEnvironmentVersionWrite & { needs_snapshot: boolean };
}

export interface UpdateSandboxEnvironmentInput {
  tenant_id: string;
  id: string;
  description: string;
  active_version: number;
  version: SandboxEnvironmentVersionWrite;
}

export interface MarkSandboxEnvironmentVersionFailedInput {
  environment_id: string;
  version: number;
  status_reason: string;
}

export interface DeleteSandboxEnvironmentInput {
  tenant_id: string;
  name: string;
  /** Soft-delete only if created by this subject. */
  created_by_subject_id: string;
}

/** Partial unique `(tenant_id, name) WHERE lifecycle_stage = 'active'` violation. */
export class SandboxEnvironmentNameConflictError extends Error {
  readonly tenant_id: string;
  readonly environment_name: string;

  constructor({ tenant_id, name }: { tenant_id: string; name: string }, options?: ErrorOptions) {
    super(`Sandbox environment name already exists: ${name}`, options);
    this.name = 'SandboxEnvironmentNameConflictError';
    this.tenant_id = tenant_id;
    this.environment_name = name;
  }
}

export interface ISandboxEnvironmentStore<TTransaction = never> {
  /** Active environments joined to the version pointed at by `active_version`. */
  listEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: TTransaction,
  ): Promise<{ data: SandboxEnvironmentWithVersion[]; pagination: TokenPagination }>;
  /** Active environment by name, joined to its active version. */
  getEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined>;
  /** Insert parent (`active_version=1`) + first version. */
  createEnvironment(
    input: CreateSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion & { needs_snapshot: boolean }>;
  /** Insert next version and bump parent `active_version` / `description`. */
  updateEnvironment(
    input: UpdateSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined>;
  markVersionFailed(
    input: MarkSandboxEnvironmentVersionFailedInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentVersionRecord | undefined>;
  /** Soft-delete: set lifecycle_stage = deleted. Idempotent if missing or already deleted. */
  deleteEnvironment(input: DeleteSandboxEnvironmentInput, transaction?: TTransaction): Promise<void>;
}
