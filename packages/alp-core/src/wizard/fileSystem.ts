// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import { listGenerationTargetSupport } from "../loader/service";
import {
  WizardFileChange,
  WizardGeneratedOutputPreview,
  WizardPlannedFile,
  WizardWriteResult,
} from "./models";

export function collectWizardFileChanges(
  workspaceRoot: string,
  files: WizardPlannedFile[],
): WizardFileChange[] {
  return files.map((file) => {
    const absolutePath = path.join(workspaceRoot, file.relativePath);
    if (!fs.existsSync(absolutePath)) {
      return {
        relativePath: file.relativePath,
        kind: "new",
      };
    }

    const current = fs.readFileSync(absolutePath, "utf-8");
    return {
      relativePath: file.relativePath,
      kind: current === file.content ? "unchanged" : "update",
    };
  });
}

export function writeWizardFiles(
  workspaceRoot: string,
  files: WizardPlannedFile[],
): WizardWriteResult {
  const result: WizardWriteResult = {
    written: [],
    unchanged: [],
  };

  for (const file of files) {
    const absolutePath = path.join(workspaceRoot, file.relativePath);
    const exists = fs.existsSync(absolutePath);
    if (exists) {
      const current = fs.readFileSync(absolutePath, "utf-8");
      if (current === file.content) {
        result.unchanged.push(file.relativePath);
        continue;
      }
    }

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, file.content, "utf-8");
    result.written.push(file.relativePath);
  }

  return result;
}

export function collectGeneratedOutputPreviews(
  workspaceRoot: string,
): WizardGeneratedOutputPreview[] {
  const targets = listGenerationTargetSupport();

  return targets.map((target) => {
    const absolutePath = path.join(workspaceRoot, target.outputRelativePath);
    if (!fs.existsSync(absolutePath)) {
      return {
        emit: target.emit,
        displayName: target.displayName,
        outputRelativePath: target.outputRelativePath,
        languageId: target.preview.languageId,
        state: "missing",
        contentPreview:
          "(Not generated yet. Run Alp: Generate all to create this output.)",
      };
    }

    const content = fs.readFileSync(absolutePath, "utf-8");
    const preview = content.split(/\r?\n/).slice(0, 18).join("\n").trim();
    return {
      emit: target.emit,
      displayName: target.displayName,
      outputRelativePath: target.outputRelativePath,
      languageId: target.preview.languageId,
      state: "existing",
      contentPreview:
        preview.length > 0 ? preview : "(File exists but is empty.)",
    };
  });
}
