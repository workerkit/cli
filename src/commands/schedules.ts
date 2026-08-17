import type { Command } from "commander";
import { mountTool } from "../bind.js";
import { renderTable } from "../output/table.js";

interface ScheduleRow {
  scheduleId?: number;
  id?: number;
  title?: string | null;
  scheduleType?: string;
  isEnabled?: boolean;
  nextRunUtc?: string | null;
}

export function mountSchedules(program: Command): void {
  const schedules = program.command("schedules").description("A worker's schedules (when it runs on its own)");

  mountTool(schedules, "list", {
    tool: "schedules_list",
    positionals: ["tokenId"],
    summary: "List a worker's schedules with next fire times",
    render: (data) => {
      const body = data as { schedules?: ScheduleRow[] } | ScheduleRow[];
      const rows = Array.isArray(body) ? body : body.schedules;
      if (!Array.isArray(rows)) return null;
      if (rows.length === 0) return "No schedules.";
      return renderTable(rows, [
        { header: "ID", value: (s) => String(s.scheduleId ?? s.id ?? "") },
        { header: "TITLE", value: (s) => s.title ?? "", maxWidth: 32 },
        { header: "TYPE", value: (s) => s.scheduleType ?? "" },
        { header: "ENABLED", value: (s) => (s.isEnabled === false ? "no" : "yes") },
        { header: "NEXT RUN", value: (s) => s.nextRunUtc ?? "" },
      ]);
    },
  });

  mountTool(schedules, "create", {
    tool: "schedule_create",
    positionals: ["tokenId"],
    summary: "Create a schedule (see --help for the type-specific fields)",
  });

  mountTool(schedules, "update", {
    tool: "schedule_update",
    positionals: ["tokenId", "scheduleId"],
    summary: "Edit a schedule (partial: only the flags you pass change)",
  });

  mountTool(schedules, "delete", {
    tool: "schedule_delete",
    positionals: ["tokenId", "scheduleId"],
    confirm: (p) => `Delete schedule ${p.scheduleId} from worker ${p.tokenId}?`,
    summary: "Delete a schedule",
  });
}
