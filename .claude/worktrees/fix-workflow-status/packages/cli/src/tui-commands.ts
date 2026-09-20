import type { SlashCommand } from "@earendil-works/pi-tui";

/** Single source of truth for commands exposed by the interactive TUI. */
export const TUI_SLASH_COMMANDS = [
  { name: "exit", description: "Close the TUI (or /quit)" },
  // Listed after /exit so a bare `/` still pre-selects the exit row: entering a
  // side agent must never be what an accidental Enter does.
  { name: "btw", argumentHint: "[prompt]", description: "Open a side agent (edit and bash)" },
  { name: "rename", argumentHint: "<name>", description: "Rename the current run" },
  { name: "resume", description: "Resume a previous session" },
  { name: "side", description: "Toggle the trajectory panel" },
  { name: "workspace", description: "Choose the workspace directory" },
  { name: "workflow", description: "Choose a workflow file" },
] as const satisfies readonly SlashCommand[];

export function slashCommandsForAutocomplete(): SlashCommand[] {
  // /quit stays usable (tui.ts still accepts it) and is offered by
  // autocomplete, but the footer advertises it only inside /exit's row: they
  // are the same action and a second row would waste the column.
  return [...TUI_SLASH_COMMANDS, { name: "quit", description: "Close the TUI (alias of /exit)" }];
}
