/**
 * The name this CLI was invoked as.
 *
 * One entry file can be installed under more than one command name — `piano`
 * from a release checkout, `piano-paper` from a working branch — so a usage
 * string that hardcodes either one is wrong half the time. That matters more
 * than cosmetics when the two commands are on `PATH` together: the whole point
 * of the second name is knowing which build answered, and help text that names
 * the other one defeats it.
 *
 * Node keeps the path as invoked in `argv[1]`, and does not resolve it through
 * a symlink on the way, which is what lets `piano-paper --help` name itself.
 *
 * Anything that is not a piano command falls back to the canonical name: the
 * test runner, `tsx packages/cli/src/main.ts`, and `node -e` all reach this code
 * with their own `argv[1]`, and none of them should leak into a usage string.
 */

export const DEFAULT_PROGRAM_NAME = "piano";

const PIANO_COMMAND = /^piano(-[a-z0-9]+)*$/;
const SCRIPT_EXTENSION = /\.(mjs|js|cjs|ts)$/;

/** The command name to print in usage text, from the invoked path. */
export function programName(argv1: string | undefined = process.argv[1]): string {
  if (argv1 === undefined || argv1.length === 0) return DEFAULT_PROGRAM_NAME;
  const base = argv1.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(SCRIPT_EXTENSION, "");
  return PIANO_COMMAND.test(stem) ? stem : DEFAULT_PROGRAM_NAME;
}
