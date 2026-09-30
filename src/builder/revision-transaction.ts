import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { TimelineDataset, TimelineEvent, Period } from "../shared/timeline.js";
import type { RevisionChange, VerifiedRevisionProposal } from "../server/revision-proposal.js";
import { readDataset, writeDataset } from "./dataset-files.js";
import { serializeJsonLines } from "./jsonl.js";
import { prepareDatasetWrite } from "./validate-dataset.js";

export type RevisionTransactionErrorCode = "stale_version" | "lock_timeout" | "proposal_mismatch" | "audit_failed" | "write_failed" | "rollback_required";

export class RevisionTransactionError extends Error {
  constructor(readonly code: RevisionTransactionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RevisionTransactionError";
  }
}

interface Journal {
  transaction_id: string;
  target_directory: string;
  backup_directory: string;
  staging_directory: string;
  phase: "prepared" | "backed_up" | "replaced";
}

interface AuditRecord {
  transaction_id: string;
  recorded_at: string;
  status: "pending" | "committed" | "rolled_back";
  before_version: string;
  after_version: string;
  proposal_kind: VerifiedRevisionProposal["proposal_kind"];
  changes: Array<{ entity_type: RevisionChange["entity_type"]; operation: RevisionChange["operation"]; entity_id: string }>;
  error_code?: string;
}

export interface RevisionTransactionOptions {
  targetDirectory: string;
  backupDirectory: string;
  auditPath: string;
  lockPath: string;
  journalPath: string;
  now?: () => Date;
  transformDataset?: (dataset: TimelineDataset) => TimelineDataset;
  prepareStaging?: (dataset: TimelineDataset, stagingDirectory: string) => void;
  fault?: (point: "before_stage" | "before_audit" | "after_backup" | "after_replace" | "before_commit_audit") => void;
}

export class SimulatedProcessInterruption extends Error {}

function datasetVersion(dataset: TimelineDataset): string {
  const content = [
    serializeJsonLines(dataset.regions),
    serializeJsonLines(dataset.periods),
    serializeJsonLines(dataset.events),
    serializeJsonLines(dataset.placements),
  ].join("\u0000");
  return createHash("sha256").update(content).digest("hex");
}

function appendAudit(path: string, record: AuditRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}

function replaceEntity<T extends TimelineEvent | Period>(collection: T[], change: RevisionChange, id: (item: T) => string): void {
  const index = collection.findIndex((item) => id(item) === change.entity_id);
  if (change.operation === "add") {
    if (index >= 0 || change.before !== null) throw new RevisionTransactionError("proposal_mismatch", `Addition no longer matches current data: ${change.entity_id}`);
    collection.push(structuredClone(change.after) as T);
    return;
  }
  if (index < 0 || change.before === null || JSON.stringify(collection[index]) !== JSON.stringify(change.before)) throw new RevisionTransactionError("proposal_mismatch", `Replacement no longer matches current data: ${change.entity_id}`);
  collection[index] = structuredClone(change.after) as T;
}

export function applyProposalToDataset(dataset: TimelineDataset, proposal: VerifiedRevisionProposal, validate = true): TimelineDataset {
  const next = structuredClone(dataset);
  for (const change of proposal.changes) {
    if (change.entity_type === "event") replaceEntity(next.events, change, (item) => item.event_id);
    else replaceEntity(next.periods, change, (item) => item.period_id);
  }
  return validate ? prepareDatasetWrite(next) : next;
}

export function readDatasetVersion(directory: string): string {
  return datasetVersion(readDataset(directory));
}

export class RevisionTransaction {
  private readonly now: () => Date;

  constructor(private readonly options: RevisionTransactionOptions) {
    this.now = options.now ?? (() => new Date());
  }

  apply(proposal: VerifiedRevisionProposal, expectedVersion: string): { transaction_id: string; before_version: string; after_version: string; backup_directory: string } {
    this.acquireLock();
    const transactionId = randomUUID();
    const staging = `${this.options.targetDirectory}.staging-${transactionId}`;
    const backup = join(this.options.backupDirectory, `${this.now().toISOString().replaceAll(":", "-")}-${transactionId}`);
    let journal: Journal | undefined;
    let beforeVersion = "";
    let afterVersion = "";
    try {
      const current = readDataset(this.options.targetDirectory);
      beforeVersion = datasetVersion(current);
      if (beforeVersion !== expectedVersion) throw new RevisionTransactionError("stale_version", "Source data changed after the proposal was reviewed");
      const proposalResult = applyProposalToDataset(current, proposal, !this.options.transformDataset);
      const next = prepareDatasetWrite(this.options.transformDataset ? this.options.transformDataset(proposalResult) : proposalResult);
      afterVersion = datasetVersion(next);
      this.options.fault?.("before_stage");
      writeDataset(next, staging);
      this.options.prepareStaging?.(next, staging);
      const pending = this.auditRecord(transactionId, "pending", beforeVersion, afterVersion, proposal);
      try {
        this.options.fault?.("before_audit");
        appendAudit(this.options.auditPath, pending);
      } catch (cause) {
        throw new RevisionTransactionError("audit_failed", "Could not record the pending revision audit", { cause });
      }
      mkdirSync(this.options.backupDirectory, { recursive: true });
      journal = { transaction_id: transactionId, target_directory: this.options.targetDirectory, backup_directory: backup, staging_directory: staging, phase: "prepared" };
      this.writeJournal(journal);
      renameSync(this.options.targetDirectory, backup);
      journal.phase = "backed_up";
      this.writeJournal(journal);
      this.options.fault?.("after_backup");
      renameSync(staging, this.options.targetDirectory);
      journal.phase = "replaced";
      this.writeJournal(journal);
      this.options.fault?.("after_replace");
      try {
        this.options.fault?.("before_commit_audit");
        appendAudit(this.options.auditPath, this.auditRecord(transactionId, "committed", beforeVersion, afterVersion, proposal));
      } catch (cause) {
        throw new RevisionTransactionError("audit_failed", "Could not record the committed revision audit", { cause });
      }
      rmSync(this.options.journalPath, { force: true });
      return { transaction_id: transactionId, before_version: beforeVersion, after_version: afterVersion, backup_directory: backup };
    } catch (reason) {
      if (reason instanceof SimulatedProcessInterruption) throw reason;
      try {
        if (journal && existsSync(journal.backup_directory)) {
          if (existsSync(journal.target_directory)) rmSync(journal.target_directory, { recursive: true, force: true });
          renameSync(journal.backup_directory, journal.target_directory);
          if (beforeVersion && afterVersion) appendAudit(this.options.auditPath, this.auditRecord(transactionId, "rolled_back", beforeVersion, afterVersion, proposal, reason));
        }
        rmSync(this.options.journalPath, { force: true });
      } catch (rollbackReason) {
        throw new RevisionTransactionError("rollback_required", "Automatic rollback failed; recovery is required", { cause: rollbackReason });
      }
      if (reason instanceof RevisionTransactionError) throw reason;
      throw new RevisionTransactionError("write_failed", "Revision transaction failed before commit", { cause: reason });
    } finally {
      rmSync(staging, { recursive: true, force: true });
      this.releaseLock();
    }
  }

  recover(): "nothing_to_recover" | "restored_backup" {
    this.acquireLock();
    try {
      if (!existsSync(this.options.journalPath)) return "nothing_to_recover";
      const journal = JSON.parse(readFileSync(this.options.journalPath, "utf8")) as Journal;
      if (!existsSync(journal.backup_directory)) throw new RevisionTransactionError("rollback_required", "Recovery backup is missing");
      if (existsSync(journal.target_directory)) rmSync(journal.target_directory, { recursive: true, force: true });
      renameSync(journal.backup_directory, journal.target_directory);
      rmSync(journal.staging_directory, { recursive: true, force: true });
      rmSync(this.options.journalPath, { force: true });
      return "restored_backup";
    } finally { this.releaseLock(); }
  }

  private acquireLock(): void {
    try { mkdirSync(this.options.lockPath); }
    catch (cause) { throw new RevisionTransactionError("lock_timeout", "Another revision transaction holds the serial lock", { cause }); }
  }

  private releaseLock(): void { rmSync(this.options.lockPath, { recursive: true, force: true }); }

  private writeJournal(journal: Journal): void {
    mkdirSync(dirname(this.options.journalPath), { recursive: true });
    writeFileSync(this.options.journalPath, JSON.stringify(journal), { encoding: "utf8" });
  }

  private auditRecord(transactionId: string, status: AuditRecord["status"], beforeVersion: string, afterVersion: string, proposal: VerifiedRevisionProposal, reason?: unknown): AuditRecord {
    return {
      transaction_id: transactionId,
      recorded_at: this.now().toISOString(),
      status,
      before_version: beforeVersion,
      after_version: afterVersion,
      proposal_kind: proposal.proposal_kind,
      changes: proposal.changes.map((change) => ({ entity_type: change.entity_type, operation: change.operation, entity_id: change.entity_id })),
      ...(reason instanceof RevisionTransactionError ? { error_code: reason.code } : {}),
    };
  }
}
