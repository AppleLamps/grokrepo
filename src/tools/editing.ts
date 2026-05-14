import { getString, getOptionalString } from "./args.js";
import { applyPatch, undoPatch } from "../editing/engine.js";
import { toolFailure, type Tool } from "./types.js";

export function createEditingTools(): Tool[] {
  return [applyPatchTool, undoPatchTool];
}

const applyPatchTool: Tool = {
  name: "apply_patch",
  description: "Apply a unified diff patch after showing a file-level preview and receiving explicit user approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      patch: {
        type: "string",
        description: "Unified diff patch text."
      },
      summary: {
        type: "string",
        description: "Short summary of the intended change."
      }
    },
    required: ["patch"],
    additionalProperties: false
  },
  async execute(args, context) {
    const patch = getString(args, "patch");

    if (!patch) {
      return toolFailure("apply_patch", "invalid_arguments", "apply_patch requires a patch string.");
    }

    return applyPatch(
      {
        patch,
        summary: getOptionalString(args, "summary")
      },
      context
    );
  }
};

const undoPatchTool: Tool = {
  name: "undo_patch",
  description: "Restore files from a previous patch backup after explicit user approval. Defaults to the latest backup.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      backupId: {
        type: "string",
        description: "Optional backup id to restore. Defaults to the latest patch backup."
      }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    return undoPatch(
      {
        backupId: getOptionalString(args, "backupId")
      },
      context
    );
  }
};
