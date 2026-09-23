import { PaperlessAPI } from "../../api/PaperlessAPI";
import { PaginatedResponse } from "./paginate";

const TERMINAL_TASK_STATES = new Set(["success", "failure", "revoked"]);

export function isTerminalTaskStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_TASK_STATES.has(status);
}

export interface ConsumeTask {
  task_id: string;
  status: string;
  result_data?: unknown;
  related_document_ids?: number[] | null;
  [key: string]: unknown;
}

const POLL_INTERVAL_MS = 1500;

/**
 * Polls `/tasks/?task_id=<uuid>` until the task reaches a terminal state
 * (success / failure / revoked) or `timeoutMs` elapses. Returns the matching
 * task, or the last-seen still-running task (or null) if it never finished in
 * time. The deadline is checked before sleeping, so `timeoutMs=0` polls exactly
 * once and returns immediately without waiting.
 */
export async function pollConsumeTask(
  api: PaperlessAPI,
  taskUuid: string,
  timeoutMs: number
): Promise<ConsumeTask | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const tasks = await api.request<PaginatedResponse<ConsumeTask>>(
      `/tasks/?task_id=${encodeURIComponent(taskUuid)}`
    );
    const task = tasks.results.find((t) => t.task_id === taskUuid);
    if (task && isTerminalTaskStatus(task.status)) {
      return task;
    }
    if (Date.now() >= deadline) {
      return task ?? null;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
