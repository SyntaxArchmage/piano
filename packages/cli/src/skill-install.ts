/**
 * `piano install-skill` — copy the packaged `/piano` Agent Skill into the
 * coding-agent homes the user already has.
 *
 * This is the one deliberate exception to "Piano never writes native agent
 * config": only `<home>/skills/piano/SKILL.md` is touched, a missing home is
 * never created, and an existing `piano` skill is never overwritten. The
 * template lives at the repository root in `skills/piano/SKILL.md`.
 */
import { io } from "@piano/base";
import { Effect } from "effect";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentHome, unusableHome } from "./agent-home.js";
import { CliArgumentError, SkillInstallError } from "./errors.js";
import { programName } from "./program-name.js";

const TEMPLATE_PATH = fileURLToPath(new URL("../../../skills/piano/SKILL.md", import.meta.url));

type TargetName = "claude" | "dsh";

const usage = `usage: ${programName()} install-skill [--target <claude|dsh|all>] [--dry-run]`;

function parseArgs(args: readonly string[]): Effect.Effect<
  { readonly targets: readonly TargetName[]; readonly dryRun: boolean },
  CliArgumentError
> {
  const names: TargetName[] = [];
  let dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    const value = arg === "--target" ? args[index + 1] : arg?.startsWith("--target=") ? arg.slice(9) : undefined;
    if (arg === "--target") index += 1;
    if (value === undefined) return Effect.fail(new CliArgumentError({ message: `unknown option: ${String(arg)}\n${usage}` }));
    if (value === "all") names.push("claude", "dsh");
    else if (value === "claude" || value === "dsh") names.push(value);
    else return Effect.fail(new CliArgumentError({ message: `unknown target: ${value}\n${usage}` }));
  }
  if (names.length === 0) names.push("claude", "dsh");
  return Effect.succeed({ targets: [...new Set(names)], dryRun });
}

function report(line: string): Effect.Effect<void> {
  return Effect.sync(() => console.log(line));
}

const failed = (path: string, cause: unknown): SkillInstallError => new SkillInstallError({
  operation: "install-skill",
  path,
  message: cause instanceof Error ? cause.message : String(cause),
});

function installOne(name: TargetName, home: string, template: string, dryRun: boolean): Effect.Effect<void, SkillInstallError> {
  return Effect.gen(function* () {
    const unusable = yield* unusableHome(home);
    if (unusable !== undefined) {
      yield* report(`[WARN] ${name}: skipped (${unusable === "missing" ? "home not found" : "home is not a directory"}: ${home})`);
      return;
    }

    const skills = join(home, "skills");
    const piano = join(skills, "piano");
    const destination = join(piano, "SKILL.md");
    const existing = yield* Effect.either(io.lstat(destination));
    if (existing._tag === "Right") {
      if (existing.right.isSymbolicLink() || !existing.right.isFile()) {
        yield* report(`[WARN] ${name}: conflict (${destination} is not a regular file); left untouched`);
        return;
      }
      const current = yield* Effect.either(io.readText(destination));
      if (current._tag === "Right" && current.right === template) {
        yield* report(`[PASS] ${name}: up-to-date (${destination})`);
      } else {
        yield* report(`[WARN] ${name}: conflict (${destination} exists with different content); left untouched`);
      }
      return;
    }

    const pianoStats = yield* Effect.either(io.lstat(piano));
    if (pianoStats._tag === "Right") {
      if (pianoStats.right.isSymbolicLink() || !pianoStats.right.isDirectory()) {
        yield* report(`[WARN] ${name}: conflict (${piano} is not a directory); left untouched`);
      } else {
        yield* report(`[WARN] ${name}: conflict (${piano} exists without SKILL.md); left untouched`);
      }
      return;
    }
    const flat = join(skills, "piano.md");
    // lstat, not stat: a dangling symlink still occupies the name.
    if ((yield* Effect.either(io.lstat(flat)))._tag === "Right") {
      yield* report(`[WARN] ${name}: conflict (${flat} exists); left untouched`);
      return;
    }
    const skillsStats = yield* Effect.either(io.lstat(skills));
    if (skillsStats._tag === "Right" && (skillsStats.right.isSymbolicLink() || !skillsStats.right.isDirectory())) {
      yield* report(`[WARN] ${name}: conflict (${skills} is not a directory); left untouched`);
      return;
    }

    if (dryRun) {
      yield* report(`[INFO] ${name}: would install ${destination}`);
      return;
    }
    yield* io.mkdir(piano, { recursive: true, mode: 0o755 }).pipe(
      Effect.mapError((cause) => failed(destination, cause)),
    );
    const created = yield* io.createExclusive(destination, template).pipe(
      Effect.mapError((cause) => failed(destination, cause)),
    );
    if (created) yield* report(`[PASS] ${name}: installed (${destination})`);
    else yield* report(`[WARN] ${name}: conflict (${destination} appeared concurrently); left untouched`);
  });
}

export function installSkillCommand(args: readonly string[]): Effect.Effect<void, CliArgumentError | SkillInstallError> {
  return Effect.gen(function* () {
    const options = yield* parseArgs(args);
    const template = yield* io.readText(TEMPLATE_PATH).pipe(
      Effect.mapError((cause) => failed(TEMPLATE_PATH, cause)),
    );
    // One home failing must not stop the others, same as install-mcp.
    const failures: SkillInstallError[] = [];
    for (const name of options.targets) {
      const outcome = yield* Effect.either(installOne(name, agentHome(name), template, options.dryRun));
      if (outcome._tag === "Left") {
        failures.push(outcome.left);
        yield* report(`[FAIL] ${name}: ${outcome.left.message}`);
      }
    }
    if (failures.length > 0) return yield* Effect.fail(failures[0]!);
  });
}
