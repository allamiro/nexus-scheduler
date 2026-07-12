import { z } from "zod";

export const createTeamSchema = z.object({
  name: z.string().min(1).max(200),
  parentTeamId: z.string().uuid().optional(),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  parentTeamId: z.string().uuid().nullable().optional(),
});
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const addTeamMemberSchema = z.object({
  userId: z.string().uuid(),
});
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
