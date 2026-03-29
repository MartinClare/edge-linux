import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Reports</h2>
      <Card>
        <CardHeader><CardTitle>Export & Compliance</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Generate weekly and monthly reports for incidents, response timelines, and PPE compliance.</p></CardContent>
      </Card>
    </div>
  );
}
