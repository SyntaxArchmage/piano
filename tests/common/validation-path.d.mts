/** Whether a path (or a prompt line naming one) is an invocation result file. */
export declare function isInvocationResultPath(path: string): boolean;

/** The validation result path a stage prompt tells its worker to write. */
export declare function validationResultPathFromPrompt(prompt: string): string | undefined;
