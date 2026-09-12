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
    summary: "Put a worker on the hosted runtime so it can run (model and ceilings optional; the kit's recommendation otherwise)",
  });

  const deployment = program
    .command("deployment")
    .description("Hosted deployments: the step that makes an installed worker actually run");

  mountTool(deployment, "list", {
    tool: "deployments_list",
    summary: "Every deployed worker on the account (a worker in `wk workers list` but not here is inert)",
  });

  mountTool(deployment, "get", {
    tool: "deployment_get",
    positionals: ["tokenId"],
    summary: "A worker's deployment: model, reasoning, transcript retention, ceilings, status",
  });

  mountTool(deployment, "update", {
    tool: "deployment_update",
    positionals: ["tokenId"],
    summary: "Change a live deployment (model, ceilings, transcript retention), or --action pause|resume",
  });

  mountTool(deployment, "remove", {
    tool: "worker_undeploy",
    positionals: ["tokenId"],
    confirm: (p) =>
      `Take worker ${p.tokenId} off the hosted runtime? Its schedules stop firing; the worker, its instruction, memory, schedules and key stay.`,
    summary: "Take a worker off the hosted runtime (the worker and its configuration stay)",
  });

  mountTool(deployment, "models", {
    tool: "models_list",
    summary: "The models this account may deploy on, priced per million tokens, with each one's reasoning vocabulary",
  });
}
