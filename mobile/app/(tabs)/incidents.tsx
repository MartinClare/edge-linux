import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { resolveCmpAssetUrl } from '@/constants/Config';
import { useAuth } from '@/context/AuthContext';
import { AuthImage } from '@/components/AuthImage';

type IncidentRow = {
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
  project: { name: string };
  zone: { name: string };
  assignee: { name: string } | null;
  edgeReport: {
    id: string;
    overallRiskLevel: string;
    overallDescription: string | null;
    receivedAt: string;
    imageUrl: string;
  } | null;
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

export default function IncidentsScreen() {
  const c = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ incidents: IncidentRow[] }>('/api/mobile/incidents?limit=40');
    if (res.ok) setItems(res.data.incidents);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  if (loading && items.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      data={items}
      keyExtractor={(i) => i.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={[styles.empty, { color: c.textMuted }]}>No incidents</Text>}
      renderItem={({ item }) => (
        <Pressable
          style={[styles.row, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
          onPress={() => router.push(`/incident/${item.id}`)}
        >
          <View style={styles.contentRow}>
            {item.edgeReport?.id ? (
              <AuthImage
                uri={resolveCmpAssetUrl(item.edgeReport.imageUrl) ?? item.edgeReport.imageUrl}
                token={token}
                style={[styles.thumb, { backgroundColor: c.surface }]}
                resizeMode="cover"
              />
            ) : null}
            <View style={styles.mainCol}>
              <View style={styles.rowTop}>
                <Text style={[styles.type, { color: c.text }]}>{item.type.replace(/_/g, ' ')}</Text>
                <View style={styles.badges}>
                  <Text style={[styles.badge, riskStyle(item.riskLevel, c)]}>{item.riskLevel}</Text>
                  <Text style={[styles.badge, { backgroundColor: c.surface, color: c.textSub }]}>
                    {item.status.replace(/_/g, ' ')}
                  </Text>
                  {item.recordOnly ? (
                    <Text style={[styles.badge, { backgroundColor: c.surface, color: c.textSub }]}>record</Text>
                  ) : null}
                </View>
              </View>
              <Text style={[styles.meta, { color: c.textSub }]}>
                {item.project.name} · {item.zone.name} · {item.camera.name}
              </Text>
              <Text style={[styles.meta, { color: c.textSub }]}>Assigned: {item.assignee?.name ?? 'Unassigned'}</Text>
              {item.reasoning ? (
                <Text numberOfLines={2} style={[styles.body, { color: c.textSub }]}>
                  {item.reasoning}
                </Text>
              ) : null}
              {item.notes ? (
                <Text numberOfLines={2} style={[styles.note, { color: c.textMuted }]}>
                  Notes: {item.notes}
                </Text>
              ) : null}
              {item.edgeReport?.overallDescription ? (
                <Text numberOfLines={2} style={[styles.note, { color: c.textMuted }]}>
                  Edge: {item.edgeReport.overallDescription}
                </Text>
              ) : null}
              <Text style={[styles.date, { color: c.textMuted }]}>{new Date(item.detectedAt).toLocaleString()}</Text>
            </View>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 12 },
  empty: { textAlign: 'center', marginTop: 48 },
  row: {
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  contentRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  mainCol: { flex: 1 },
  thumb: { width: 84, height: 84, borderRadius: 10 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: '45%' },
  badge: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  type: { fontSize: 16, fontWeight: '600', textTransform: 'capitalize' },
  meta: { fontSize: 13, marginTop: 4 },
  body: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  note: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  date: { fontSize: 12, marginTop: 6 },
});
