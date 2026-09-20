#!/usr/bin/env node
/* global process */
import "tsx/esm";

const { runCli } = await import("../src/main.ts");
runCli(process.argv.slice(2));
