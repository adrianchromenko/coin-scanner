import { z } from "zod";

/** Where the coin is in a photo, as fractions of the image size (0..1). */
export const CoinBoxSchema = z.object({
  found: z.boolean().describe("true if exactly one coin is clearly visible"),
  left: z.number().describe("x of the coin's leftmost edge as a fraction of image width, 0..1"),
  top: z.number().describe("y of the coin's topmost edge as a fraction of image height, 0..1"),
  right: z.number().describe("x of the coin's rightmost edge as a fraction of image width, 0..1"),
  bottom: z.number().describe("y of the coin's bottommost edge as a fraction of image height, 0..1"),
  notes: z.string().describe("one short sentence on what you saw, or why the coin was not found"),
});

export const LocateSchema = z.object({
  front: CoinBoxSchema,
  back: CoinBoxSchema,
});

export type CoinBox = z.infer<typeof CoinBoxSchema>;
export type LocateResult = z.infer<typeof LocateSchema>;
