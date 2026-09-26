/** A message deliberately prepared for display, never an arbitrary runtime error. */
export class WorkflowViewError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkflowViewError";
	}
}

export function workflowErrorMessage(error: unknown): string {
	return error instanceof WorkflowViewError
		? error.message
		: "Check the development server and workflow file, then try again.";
}
