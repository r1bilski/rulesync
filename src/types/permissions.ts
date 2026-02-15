import { z } from "zod/mini";

/**
 * All canonical permission actions.
 */
export const ALL_PERMISSION_ACTIONS = ["allow", "ask", "deny"] as const;
export const PermissionActionSchema = z.enum(ALL_PERMISSION_ACTIONS);
export type PermissionAction = z.infer<typeof PermissionActionSchema>;

/**
 * A permission entry is either a flat action or a record of pattern -> action.
 *
 * Flat: `"bash": "allow"`
 * Nested: `"bash": { "*": "deny", "git diff *": "allow" }`
 */
const permissionEntrySchema = z.union([
  PermissionActionSchema,
  z.record(z.string(), PermissionActionSchema),
]);

export type PermissionEntry = z.infer<typeof permissionEntrySchema>;

// @TODO(rb): We probably should support a core set of keys that we will translate for the user.
//   Things like webfetch -> websearch, terminal -> bash / Bash, etc.

/**
 * A permissions record maps tool/scope names to permission entries.
 *
 * Each tool adapter translates these keys to/from its native format.
 */
const permissionsRecordSchema = z.record(z.string(), permissionEntrySchema);
export type PermissionsRecord = z.infer<typeof permissionsRecordSchema>;

/**
 * Canonical permissions config.
 * Mapped to tool-specific formats.
 */
export const PermissionsConfigSchema = z.looseObject({
  permissions: permissionsRecordSchema,

  // @TODO(rb): Tool specific overrides go here.
});

export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;
