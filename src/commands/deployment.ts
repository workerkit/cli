import type { Command } from "commander";
import { mountTool } from "../bind.js";

/**
 * The hosted-deployment lane: what makes an installed worker actually run. A worker with no
 * deployment fires no schedule and `wk run` refuses it with not_deployed, so `wk deploy` is the
 * verb an install is finished with — top level, next to `wk run`, because it is the step people
 * forget. The rest of the lane lives under `wk deployment`.
 */
export function mountDeploy(program: Command): void {
  mountTool(program, "deploy", {
    tool: "worker_deploy",
    positionals: ["tokenId"],
    confirm: (p) =>
      `Deploy worker ${p.tokenId} onto the hosted runtime? Its schedules start firing and its runs meter from the wallet.`,
  });

  const deployment = program
    .command("deployment")
    .description("Hosted deployments: the step that makes an installed worker actually run");

  mountTool(deployment, "list", {
    tool: "deployments_list",
  });

  mountTool(deployment, "get", {
    tool: "deployment_get",
    positionals: ["tokenId"],
  });

  mountTool(deployment, "update", {
    tool: "deployment_update",
    positionals: ["tokenId"],
  });

  mountTool(deployment, "remove", {
    tool: "worker_undeploy",
    positionals: ["tokenId"],
    confirm: (p) =>
      `Take worker ${p.tokenId} off the hosted runtime? Its schedules stop firing; the worker, its instruction, memory, schedules and key stay.`,
  });

  mountTool(deployment, "models", {
    tool: "models_list",
  });
}
