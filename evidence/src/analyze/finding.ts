import type { FlagId } from "../types.ts";

/** An analyzer result before policy assigns it a severity (or drops it). */
export interface Finding {
  id: FlagId;
  title: string;
  detail: string;
  locations?: Array<{ path: string; line?: number; message: string }>;
}
