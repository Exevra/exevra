import { writeFile } from "node:fs/promises";

await writeFile("aggregate-sentinel", "invoked\n");
