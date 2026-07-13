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

// Promotes/demotes an existing member to/from owner — a team can have
// more than one owner, and only owners (or an admin) can call this.
export const updateTeamMembershipSchema = z.object({
  isOwner: z.boolean(),
});
export type UpdateTeamMembershipInput = z.infer<typeof updateTeamMembershipSchema>;
