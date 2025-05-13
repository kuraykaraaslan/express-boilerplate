import { z } from "zod";
export const EmptyRequest = z.object({});
export type EmptyRequest = z.infer<typeof EmptyRequest>;