import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  classificationLabelId: z.string().uuid().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  classificationLabelId: z.string().uuid().nullable().optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// REQUIREMENTS.md §2.3: ACLs are granted by individual user, by Team, or
// org-wide — exactly one grantee field is expected depending on kind.
export const grantProjectAclSchema = z
  .object({
    granteeType: z.enum(["USER", "TEAM", "ORG"]),
    granteeUserId: z.string().uuid().optional(),
    granteeTeamId: z.string().uuid().optional(),
    accessLevel: z.enum(["READ", "EDIT"]),
  })
  .refine(
    (v) =>
      (v.granteeType === "USER" && !!v.granteeUserId) ||
      (v.granteeType === "TEAM" && !!v.granteeTeamId) ||
      (v.granteeType === "ORG" && !v.granteeUserId && !v.granteeTeamId),
    { message: "granteeUserId/granteeTeamId must match granteeType" },
  );
export type GrantProjectAclInput = z.infer<typeof grantProjectAclSchema>;
