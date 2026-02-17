import { z } from "zod/mini";

import { RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { PermissionAction, PermissionsRecord } from "../../types/permissions.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  ToolPermissionsForDeletionParams,
  ToolPermissionsFromFileParams,
  ToolPermissionsFromRulesyncHooksParams,
} from "./tool-permissions.js";

// @TODO(rb) more tools go here
const permissionsProcessorToolTargetTuple = ["opencode"] as const;
export const PermissionsProcessorToolTargetSchema = z.enum(permissionsProcessorToolTargetTuple);
export type PermissionsProcessorToolTarget = z.infer<typeof PermissionsProcessorToolTargetSchema>;

type ToolPermissionsFactory = {
  class: {
    fromRulesyncPermissions(
      params: ToolPermissionsFromRulesyncHooksParams & { global?: boolean },
    ): ToolPermissions | Promise<ToolPermissions>;
    fromFile(params: ToolPermissionsFromFileParams): Promise<ToolPermissions>;
    forDeletion(params: ToolPermissionsForDeletionParams): ToolPermissions;
    getSettablePaths(options?: { global?: boolean }): {
      relativeDirPath: string;
      relativeFilePath: string;
    };
    isDeletable?: (instance: ToolPermissions) => boolean;
  };
  meta: { supportsProject: boolean; supportsGlobal: boolean };
  supportedActions: PermissionAction[];
};

const toolPermissionsFactories = new Map<PermissionsProcessorToolTarget, ToolPermissionsFactory>(
  [],
);

const permissionsProcessorToolTargets: ToolTarget[] = [...toolPermissionsFactories.keys()];
const permissionsProcessorToolTargetsGlobal: ToolTarget[] = [...toolPermissionsFactories.entries()]
  .filter(([, x]) => x.meta.supportsGlobal)
  .map(([x]) => x);

export class PermissionsProcessor extends FeatureProcessor {
  private readonly toolTarget: PermissionsProcessorToolTarget;
  private readonly global: boolean;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    dryRun = false,
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    dryRun?: boolean;
  }) {
    super({ baseDir, dryRun });
    const result = PermissionsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for PermissionsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
  }

  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      return [
        await RulesyncPermissions.fromFile({
          baseDir: this.baseDir,
          validate: true,
        }),
      ];
    } catch (error) {
      logger.error(
        `Failed to load Rulesync permissions file (${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      );
      return [];
    }
  }

  async loadToolFiles({ forDeletion = false }: { forDeletion?: boolean } = {}): Promise<
    ToolFile[]
  > {
    const factory = toolPermissionsFactories.get(this.toolTarget);
    if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    const paths = factory.class.getSettablePaths({ global: this.global });

    if (forDeletion) {
      const toolPermissions = factory.class.forDeletion({
        baseDir: this.baseDir,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: paths.relativeFilePath,
        global: this.global,
      });
      const list = toolPermissions.isDeletable?.() !== false ? [toolPermissions] : [];
      logger.debug(
        `Successfully loaded ${list.length} ${this.toolTarget} permissions files for deletion`,
      );
      return list;
    }

    const toolPermissions = await factory.class.fromFile({
      baseDir: this.baseDir,
      validate: true,
      global: this.global,
    });

    logger.debug(`Successfully loaded 1 ${this.toolTarget} permissions file`);
    return [toolPermissions];
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncPermissions = rulesyncFiles.find(
      (f): f is RulesyncPermissions => f instanceof RulesyncPermissions,
    );
    if (!rulesyncPermissions) {
      throw new Error(`No ${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH} found.`);
    }

    const factory = toolPermissionsFactories.get(this.toolTarget);
    if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);

    const config = rulesyncPermissions.getJson();
    const shared = config.permissions;
    const overrides = config[this.toolTarget]?.permissions ?? {};
    const effective: Record<string, PermissionsRecord> = {
      ...shared,
      ...overrides,
    };

    // Warn about unsupported actions
    {
      const supportedActions: Set<string> = new Set(factory.supportedActions);
      const configActions = new Set<string>(Object.keys(effective));
      const skipped = [...configActions].filter((x) => !supportedActions.has(x));
      if (skipped.length > 0) {
        logger.warn(
          `Skipped permissions action(s) for ${this.toolTarget} (not supported): ${skipped.join(", ")}`,
        );
      }
    }

    const result = await factory.class.fromRulesyncPermissions({
      baseDir: this.baseDir,
      rulesyncPermissions,
      validate: true,
      global: this.global,
    });

    return [result];
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const hooks = toolFiles.filter((f): f is ToolPermissions => f instanceof ToolPermissions);
    return hooks.map((h) => h.toRulesyncPermissions());
  }

  static getToolTargets({ global = false }: { global?: boolean }): ToolTarget[] {
    return global ? permissionsProcessorToolTargetsGlobal : permissionsProcessorToolTargets;
  }
}
