import bcrypt from "bcryptjs";
import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(200)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), "Include upper-case, lower-case and a number");

const COST = process.env.NODE_ENV === "test" ? 4 : 12;

export const hashPassword = (pw: string) => bcrypt.hash(pw, COST);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

let dummy: string | null = null;
/** A real hash used to equalize timing when the email does not exist. */
export const dummyHash = () => (dummy ??= bcrypt.hashSync("timing-equalizer", COST));
