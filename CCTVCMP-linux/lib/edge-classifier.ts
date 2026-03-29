import type { IncidentRiskLevel, IncidentType } from "@prisma/client";

type AnalysisInput = {
  overallRiskLevel: "Low" | "Medium" | "High";
  peopleCount?: number;
  missingHardhats?: number;
  missingVests?: number;
  constructionSafety: { issues: string[] };
  fireSafety: { issues: string[] };
  propertySecurity: { issues: string[] };
};

const FALL_KEYWORDS = ["fall", "height", "scaffold", "ladder", "tripping", "slip"];
const FIRE_KEYWORDS = ["fire", "flame", "burning"];
const SMOKE_KEYWORDS = ["smoke", "smoking"];
const INTRUSION_KEYWORDS = ["intrusion", "unauthorized", "restricted", "zone", "trespass"];
const MACHINERY_KEYWORDS = ["machinery", "equipment", "vehicle", "heavy equipment"];

function issuesContain(issues: string[], keywords: string[]): boolean {
  const text = issues.join(" ").toLowerCase();
  return keywords.some((k) => text.includes(k));
}

function mapRiskLevel(level: "Low" | "Medium" | "High"): IncidentRiskLevel {
  switch (level) {
    case "Low":
      return "low";
    case "Medium":
      return "medium";
    case "High":
      return "high";
    default:
      return "low";
  }
}

export function classifyAnalysis(analysis: AnalysisInput): Array<{ type: IncidentType; riskLevel: IncidentRiskLevel }> {
  const types: IncidentType[] = [];
  const riskLevel = mapRiskLevel(analysis.overallRiskLevel);

  if ((analysis.missingHardhats ?? 0) > 0 || (analysis.missingVests ?? 0) > 0) {
    types.push("ppe_violation");
  }
  if (issuesContain(analysis.constructionSafety.issues, FALL_KEYWORDS)) {
    types.push("fall_risk");
  }
  if (issuesContain(analysis.fireSafety.issues, FIRE_KEYWORDS)) {
    types.push("fire_detected");
  }
  if (issuesContain(analysis.fireSafety.issues, SMOKE_KEYWORDS)) {
    types.push("smoke_detected");
  }
  if (issuesContain(analysis.propertySecurity.issues, INTRUSION_KEYWORDS)) {
    types.push("restricted_zone_entry");
  }
  if (issuesContain(analysis.constructionSafety.issues, MACHINERY_KEYWORDS)) {
    types.push("machinery_hazard");
  }

  return types.map((type) => ({ type, riskLevel }));
}
