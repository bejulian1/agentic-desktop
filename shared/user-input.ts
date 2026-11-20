// Structured questions are scoped to one live tool call, never delivered as queued messages.
export interface UserQuestion {
  id: string;
  header?: string;
  question: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}
export interface UserAnswer { questionId: string; selectedOptions: string[]; text: string }
export type UserInputResult = { cancelled: boolean; answers: UserAnswer[] };
export type UserInputCloseReason = "user" | "stopped" | "restart" | "scope-changed" | "steered";
