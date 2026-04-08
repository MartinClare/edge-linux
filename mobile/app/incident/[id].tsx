import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { resolveCmpAssetUrl } from '@/constants/Config';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { AuthImage } from '@/components/AuthImage';

type IncidentDetail = {
  id: string;
  type: string;
  riskLevel: string;
  status: string;
  recordOnly: boolean;
  reasoning: string | null;
  notes: string | null;
  detectedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  dismissedAt: string | null;
  camera: { name: string };
  zone: { name: string };
  project: { name: string };
  assignee: { name: string; email: string } | null;
  edgeReport: {
    id: string;
    overallRiskLevel: string;
    overallDescription: string | null;
    peopleCount: number | null;
    missingHardhats: number | null;
    missingVests: number | null;
    receivedAt: string;
    imageUrl: string;
  } | null;
  notificationLogs: Array<{
    id: string;
    status: string;
    sentAt: string;
    channel: { name: string; type: string };
  }>;
};

function riskStyle(level: string, c: ReturnType<typeof useTheme>) {
  switch (level) {
    case 'critical':
      return { backgroundColor: c.offlineBg, color: c.offlineText };
    case 'high':
      return { backgroundColor: '#7c2d12', color: '#fdba74' };
    case 'medium':
      return { backgroundColor: '#78350f', color: '#fcd34d' };
    default:
      return { backgroundColor: c.surface, color: c.textSub };
  }
}

function Row({
  label,
  value,
  c,
}: {
  label: string;
  value: string;
  c: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={[styles.detailRow, { borderBottomColor: c.border }]}>
      <Text style={[styles.detailLabel, { color: c.textMuted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: c.text }]}>{value}</Text>
    </View>
  );
}

export default function IncidentDetailScreen() {
  const c = useTheme();
  const { token } = useAuth();
  const { t } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await apiFetch<{ incident: IncidentDetail }>(`/api/mobile/incidents/${id}`);
    if (res.ok) setIncident(res.data.incident);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  async function patchStatus(status: string) {
    if (!id) return;
    setActionBusy(status);
    const res = await apiFetch(`/api/mobile/incidents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setActionBusy(null);
    if (res.ok) void load();
  }

  if (loading || !incident) {
    return (
      <View style={[styles.centered, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const imageUri = resolveCmpAssetUrl(incident.edgeReport?.imageUrl);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
      <View style={styles.headerTop}>
        <Text style={[styles.title, { color: c.text }]}>{incident.type.replace(/_/g, ' ')}</Text>
        <View style={styles.badges}>
          <Text style={[styles.badge, riskStyle(incident.riskLevel, c)]}>{t(`common.risk.${incident.riskLevel}`)}</Text>
          <Text style={[styles.badge, { backgroundColor: c.surface, color: c.textSub }]}>
            {t(`common.status.${incident.status}`)}
          </Text>
          {incident.recordOnly ? (
            <Text style={[styles.badge, { backgroundColor: c.surface, color: c.textSub }]}>{t('incidents.record')}</Text>
          ) : null}
        </View>
      </View>
      <Text style={[styles.meta, { color: c.textSub }]}>
        {incident.project.name} · {incident.zone.name} · {incident.camera.name}
      </Text>
      <Text style={[styles.date, { color: c.textMuted }]}>{new Date(incident.detectedAt).toLocaleString()}</Text>

      <View style={[styles.card, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>{t('incidents.details')}</Text>
        <Row label={t('incidents.assignedTo')} value={incident.assignee?.name ?? t('incidents.unassigned')} c={c} />
        <Row label={t('incidents.detectedAt')} value={new Date(incident.detectedAt).toLocaleString()} c={c} />
        {incident.acknowledgedAt ? (
          <Row label={t('incidents.acknowledgedAt')} value={new Date(incident.acknowledgedAt).toLocaleString()} c={c} />
        ) : null}
        {incident.resolvedAt ? (
          <Row label={t('incidents.resolvedAt')} value={new Date(incident.resolvedAt).toLocaleString()} c={c} />
        ) : null}
        {incident.dismissedAt ? (
          <Row label={t('incidents.dismissedAt')} value={new Date(incident.dismissedAt).toLocaleString()} c={c} />
        ) : null}
      </View>

      {imageUri ? (
        <View style={[styles.card, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>{t('incidents.evidence')}</Text>
          <AuthImage
            uri={imageUri}
            token={token}
            style={[styles.image, { backgroundColor: c.surface }]}
            resizeMode="cover"
          />
          {incident.edgeReport?.receivedAt ? (
            <Text style={[styles.noteText, { color: c.textMuted }]}>
              {t('incidents.captured', { value: new Date(incident.edgeReport.receivedAt).toLocaleString() })}
            </Text>
          ) : null}
          {incident.edgeReport?.overallRiskLevel ? (
            <Text style={[styles.noteText, { color: c.textMuted }]}>{t('incidents.edgeRisk', { value: incident.edgeReport.overallRiskLevel })}</Text>
          ) : null}
          {incident.edgeReport?.peopleCount != null ? (
            <Text style={[styles.noteText, { color: c.textMuted }]}>
              People: {incident.edgeReport.peopleCount} · Missing hardhats: {incident.edgeReport.missingHardhats ?? 0}
              {' · '}Missing vests: {incident.edgeReport.missingVests ?? 0}
            </Text>
          ) : null}
        </View>
      ) : null}

      {incident.reasoning ? (
        <View style={[styles.card, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>{t('incidents.reasoning')}</Text>
          <Text style={[styles.body, { color: c.textSub }]}>{incident.reasoning}</Text>
        </View>
      ) : null}

      {incident.edgeReport?.overallDescription ? (
        <View style={[styles.card, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>{t('incidents.edgeSummary')}</Text>
          <Text style={[styles.body, { color: c.textSub }]}>{incident.edgeReport.overallDescription}</Text>
        </View>
      ) : null}

      {incident.notes ? (
        <View style={[styles.card, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>{t('incidents.notesTitle')}</Text>
          <Text style={[styles.body, { color: c.textSub }]}>{incident.notes}</Text>
        </View>
      ) : null}

      {incident.notificationLogs.length > 0 ? (
        <View style={[styles.card, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>{t('incidents.notifications')}</Text>
          {incident.notificationLogs.map((log) => (
            <View key={log.id} style={[styles.detailRow, { borderBottomColor: c.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.detailValue, { color: c.text }]}>
                  {log.channel.name} ({log.channel.type})
                </Text>
                <Text style={[styles.detailLabel, { color: c.textMuted }]}>
                  {new Date(log.sentAt).toLocaleString()}
                </Text>
              </View>
              <Text style={[styles.badge, { backgroundColor: c.surface, color: c.textSub }]}>
                {log.status}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={[styles.section, { color: c.text }]}>{t('incidents.actions')}</Text>
      {incident.status === 'open' ? (
        <Pressable
          style={styles.btn}
          onPress={() => void patchStatus('acknowledged')}
          disabled={actionBusy !== null}
        >
          <Text style={styles.btnText}>{actionBusy === 'acknowledged' ? '…' : t('incidents.acknowledge')}</Text>
        </Pressable>
      ) : null}
      {incident.status === 'open' || incident.status === 'acknowledged' ? (
        <>
          <Pressable
            style={styles.btn}
            onPress={() => void patchStatus('resolved')}
            disabled={actionBusy !== null}
          >
            <Text style={styles.btnText}>{actionBusy === 'resolved' ? '…' : t('incidents.resolve')}</Text>
          </Pressable>
          <Pressable
            style={[styles.btnOutline, { borderColor: c.border }]}
            onPress={() => void patchStatus('dismissed')}
            disabled={actionBusy !== null}
          >
            <Text style={[styles.btnOutlineText, { color: c.textSub }]}>
              {actionBusy === 'dismissed' ? '…' : t('incidents.dismiss')}
            </Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { padding: 16, paddingBottom: 40 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '45%' },
  badge: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  title: { fontSize: 22, fontWeight: '700', textTransform: 'capitalize' },
  meta: { fontSize: 14, marginTop: 6 },
  date: { fontSize: 12, marginTop: 4, marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailLabel: { fontSize: 12, flex: 1 },
  detailValue: { fontSize: 13, flex: 1.5, textAlign: 'right' },
  image: { width: '100%', height: 220, borderRadius: 12 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  body: { fontSize: 15, lineHeight: 22 },
  noteText: { fontSize: 12, marginTop: 8 },
  btn: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: { color: '#fff', fontWeight: '600' },
  btnOutline: {
    borderWidth: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  btnOutlineText: { fontWeight: '600' },
});
