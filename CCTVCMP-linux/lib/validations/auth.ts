import { Role } from "@prisma/client";
import { z } from "zod";

const passwordRule = z.string().min(8, "Password must be at least 8 characters").max(72, "Password is too long");

export const signUpSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email is required"),
  password: passwordRule,
  role: z.nativeEnum(Role).optional(),
});

export const signInSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(1, "Password is required"),
});
