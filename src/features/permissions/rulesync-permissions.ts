import { join } from "path";

import {
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { PermissionsConfig, PermissionsConfigSchema } from "../../types/permissions.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../../types/rulesync-file.js";
import { fileExists, readFileContent } from "../../utils/file.js";

export type RulesyncPermissionsParams = RulesyncFileParams;
export type RulesyncPermissionsFromFileParams = Pick<
  RulesyncFileFromFileParams,
  "baseDir" | "validate"
>;

export type RulesyncPermissionsSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export class RulesyncPermissions extends RulesyncFile {
  private readonly json: PermissionsConfig;

  constructor(params: RulesyncPermissionsParams) {
    super({ ...params });

    this.json = JSON.parse(this.fileContent);
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): RulesyncPermissionsSettablePaths {
    return {
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "permissions.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }): Promise<RulesyncPermissions> {
    const paths = RulesyncPermissions.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);

    // @TODO(rb): toctou issue -> this is a global problem
    if (!(await fileExists(filePath))) {
      throw new Error(`No ${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH} found.`);
    }

    const fileContent = await readFileContent(filePath);
    return new RulesyncPermissions({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    const result = PermissionsConfigSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  getJson(): PermissionsConfig {
    return this.json;
  }
}
