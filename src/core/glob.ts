import { RE2JS } from "re2js";

export const compileGlob = (pattern: string): RE2JS =>
  RE2JS.compile("^" + pattern.split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("(?s:.*)") + "$");
