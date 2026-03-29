import { IncidentAction, IncidentStatus } from "@prisma/client";

const transitions: Record<IncidentStatus, IncidentStatus[]> = {
  open: ["acknowledged", "dismissed", "record_only", "resolved"],
  acknowledged: ["resolved", "dismissed"],
  resolved: [],
  dismissed: [],
  record_only: [],
};

export function nextStatus(current: IncidentStatus, target: IncidentStatus) {
  if (current === target) return true;
  return transitions[current].includes(target);
}

export function mapStatusToAction(status: IncidentStatus): IncidentAction {
  if (status === "acknowledged") return "acknowledged";
  if (status === "resolved") return "resolved";
  if (status === "dismissed") return "dismissed";
  return "updated";
}
