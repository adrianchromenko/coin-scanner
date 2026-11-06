import { z } from "zod";

/** Where the coin is in a photo, as fractions of the image size (0..1). */
export const CoinBoxSchema = z.object({
  found: z.boolean().describe("true if exactly one coin is clearly visible"),
  left: z.number().describe("x of the coin's leftmost edge as a fraction of image width, 0..1"),
  top: z.number().describe("y of the coin's topmost edge as a fraction of image height, 0..1"),
  right: z.number().describe("x of the coin's rightmost edge as a fraction of image width, 0..1"),
  bottom: z.number().describe("y of the coin's bottommost edge as a fraction of image height, 0..1"),
  issues: z
    .array(z.enum(["blurry", "glare", "too_dark", "cut_off", "obstructed", "busy_background"]))
    .describe(
      "photo problems that would hurt a marketplace listing. blurry = fine detail such as lettering, the date or hair lines is not crisp (out of focus or motion blur). Empty if the photo is good.",
    ),
  notes: z.string().describe("one short sentence on what you saw, or why the coin was not found"),
});

export type PhotoIssue = z.infer<typeof CoinBoxSchema>["issues"][number];

export const ISSUE_LABEL: Record<PhotoIssue, string> = {
  blurry: "Blurry",
  glare: "Glare on the coin",
  too_dark: "Too dark",
  cut_off: "Coin is cut off",
  obstructed: "Something covers the coin",
  busy_background: "Busy background",
};

export const LocateSchema = z.object({
  front: CoinBoxSchema,
  back: CoinBoxSchema,
});

export type CoinBox = z.infer<typeof CoinBoxSchema>;
export type LocateResult = z.infer<typeof LocateSchema>;
