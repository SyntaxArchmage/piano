#!/usr/bin/env node
/* global process */
// Builds the prebuilt CLI bundle ahead of time. `piano` rebuilds on its own
// whenever the sources no longer match the bundle, so this entry exists for the
// cases where waiting for that is not wanted: a fresh checkout, a measurement
// run, or CI.
import { buildBundle } from "./cli-bundle.mjs";

process.stdout.write(`${await buildBundle()}\n`);
