import { z } from "zod";

export const outputLocaleSchema = z.enum(["ru", "en"]);

export type OutputLocale = z.infer<typeof outputLocaleSchema>;

export const DEFAULT_OUTPUT_LOCALE: OutputLocale = "ru";
