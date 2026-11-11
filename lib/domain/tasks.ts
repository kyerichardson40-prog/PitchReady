/** Practice tasks a manager sets ("Do the price objection 3 times by Friday"). DECISIONS D44. */
export interface TaskAssignee { userId: string; name: string; done: number; canPractise: boolean }
export interface PracticeTask {
  id: string; scenarioKey: string; scenarioTitle: string; note: string | null; target: number;
  dueAt: string | null; createdAt: string; archived: boolean; everyone: boolean; createdBy: string;
  /** Managers see every rep on the task; a rep sees only themselves. */
  assignees: TaskAssignee[];
}
export interface NewTask { scenarioKey: string; target: number; dueAt?: string | null; note?: string; repIds?: string[] | null }

export const TASK_MAX_TARGET = 20;
export const TASK_NOTE_MAX = 300;

export type TaskState = 'done' | 'overdue' | 'due_soon' | 'open';
/** One rep's state on a task. "Due soon" means within the next 24 hours. */
export function taskState(t: Pick<PracticeTask, 'target' | 'dueAt'>, done: number, now = new Date()): TaskState {
  if (done >= t.target) return 'done';
  if (!t.dueAt) return 'open';
  const ms = new Date(t.dueAt).getTime() - now.getTime();
  if (ms < 0) return 'overdue';
  return ms <= 86400_000 ? 'due_soon' : 'open';
}
/** Plain words for a due date: "Due today, 5pm", "Due tomorrow", "Due Fri 14 Nov", "Was due Mon 10 Nov". */
export function dueText(dueAt: string | null, now = new Date()): string {
  if (!dueAt) return 'No due date';
  const d = new Date(dueAt);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400_000);
  const time = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '').replace(/\s/g, '').toLowerCase();
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  if (d.getTime() < now.getTime()) return diff === 0 ? `Was due today, ${time}` : diff === -1 ? 'Was due yesterday' : `Was due ${date}`;
  if (diff === 0) return `Due today, ${time}`;
  if (diff === 1) return 'Due tomorrow';
  return `Due ${date}`;
}
/** Team-level summary for a manager: how many reps have finished. */
export function taskProgress(t: PracticeTask): { finished: number; total: number; overdue: number } {
  const now = new Date();
  return {
    finished: t.assignees.filter((a) => a.done >= t.target).length,
    total: t.assignees.length,
    overdue: t.assignees.filter((a) => taskState(t, a.done, now) === 'overdue').length,
  };
}
