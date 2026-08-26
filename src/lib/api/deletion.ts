import type { DeletionOutcome, EntityDeletion } from "../../types";

/**
 * Normalizes what a delete command returns.
 *
 * Every cascading delete in LMD removes database rows *and* files, and those two halves can fail
 * independently. The row can be gone while a file it owned is still on disk — because the
 * filesystem refused, or because the stored path could not be resolved safely. That is not a
 * failure of the delete, so the command succeeds; but it is also not a clean success, and an
 * interface that says only "Deleted" would be telling the user something untrue.
 *
 * So `cleanupFailures` is part of the result type rather than an optional extra, and it is always
 * an array: a caller cannot forget to check for it by forgetting that it might be missing.
 */
export function toEntityDeletion(value: unknown): EntityDeletion {
  const envelope = (value ?? {}) as Record<string, unknown>;
  const data = ((envelope.data as Record<string, unknown>) ?? envelope) as Record<string, unknown>;

  const cleanupFailures = Array.isArray(data.cleanupFailures)
    ? (data.cleanupFailures as unknown[]).map(String).filter((failure) => failure.length > 0)
    : [];
  const deleted = data.deleted === true;
  return {
    // A delete that left files behind still removed the row, so `success` follows the row.
    success: data.success === true || deleted,
    deleted,
    cleanupFailures
  };
}

/** True when the row is gone but the workspace was not fully cleaned. */
export function hasCleanupFailures(result: EntityDeletion): boolean {
  return result.cleanupFailures.length > 0;
}

/**
 * Normalizes what a *catalogue* delete returns.
 *
 * Deleting a base oil or an additive can end three ways, and an interface that cannot tell them
 * apart will eventually tell a user the wrong one:
 *
 *   * deleted — the row is gone;
 *   * blocked — formulations reference it, so nothing was touched, and `blockedBy` names them;
 *   * cascaded — the caller asked explicitly, and `removedComponents` says what that cost.
 *
 * A blocked delete is not an error. The user asked a reasonable question and the answer is "not
 * while these exist", which is information, not a failure.
 */
export function toDeletionOutcome(value: unknown): DeletionOutcome {
  const envelope = (value ?? {}) as Record<string, unknown>;
  const data = ((envelope.data as Record<string, unknown>) ?? envelope) as Record<string, unknown>;
  const blockedBy = Array.isArray(data.blockedBy)
    ? (data.blockedBy as Record<string, unknown>[]).map((item) => ({
        formulationId: String(item.formulationId ?? ""),
        formulationName: String(item.formulationName ?? ""),
        componentCount: Number(item.componentCount ?? 0),
        componentRoles: Array.isArray(item.componentRoles) ? item.componentRoles.map(String) : []
      }))
    : [];
  const deleted = data.deleted === true;
  return {
    id: String(data.id ?? ""),
    deleted,
    success: data.success === true || deleted,
    blocked: data.blocked === true,
    blockedBy,
    removedComponents: Number(data.removedComponents ?? 0),
    cleanupFailures: Array.isArray(data.cleanupFailures)
      ? (data.cleanupFailures as unknown[]).map(String).filter((failure) => failure.length > 0)
      : []
  };
}
