/**
 * Paperless 3.0 reworked the task serializer: statuses became lowercase
 * (`SUCCESS` -> `success`) and several fields were renamed (`related_document`
 * -> `related_document_ids`, `result` -> `result_data`, `task_name` ->
 * `task_type`). These helpers read either shape so the tools keep working
 * against both 2.x and 3.x servers.
 */

const TERMINAL_TASK_STATES = new Set(["success", "failure", "revoked"]);

export function isTerminalTaskStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_TASK_STATES.has(status.toLowerCase());
}

export function taskStatusIs(
  status: string | undefined,
  expected: string
): boolean {
  return status !== undefined && status.toLowerCase() === expected.toLowerCase();
}

export interface TaskDocumentRefs {
  related_document?: number | string | null;
  related_document_ids?: (number | string)[] | null;
}

export function relatedDocumentId(
  task: TaskDocumentRefs
): number | undefined {
  const value = task.related_document_ids?.[0] ?? task.related_document;
  if (value == null) return undefined;
  const id = Number(value);
  return Number.isFinite(id) ? id : undefined;
}

export function taskResult(task: {
  result?: unknown;
  result_data?: unknown;
}): unknown {
  return task.result ?? task.result_data;
}
