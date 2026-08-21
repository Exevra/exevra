import * as actionsCore from "@actions/core";
import { readFile } from "node:fs/promises";
import { runAction } from "./index.js";
import { check as runtimeCheck } from "../runtime/index.js";

const eventPayload = async (): Promise<unknown> => {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return {};
  return JSON.parse(await readFile(path, "utf8"));
};

void runAction({
  core: actionsCore,
  eventName: process.env.GITHUB_EVENT_NAME,
  eventPayload: await eventPayload(),
  check: runtimeCheck,
});
