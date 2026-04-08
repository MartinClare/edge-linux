import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/lib/theme';

type Summary = {
  openIncidents: number;
  highCriticalIncidents: number;
  edgeDevicesOnline: number;
  edgeDevicesTotal: number;
};

export default function SummaryScreen() {
  const c = useTheme();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<Summary>('/api/mobile/summary');
    if (res.ok) setData(res.data);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  function onRefresh() {
    setRefreshing(true);
    void load();
  }

  if (loading && !data) {
    return (
      <View style={[styles.centered, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={[styles.h1, { color: c.text }]}>Overview</Text>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.label, { color: c.textSub }]}>Open incidents</Text>
        <Text style={[styles.value, { color: c.text }]}>{data?.openIncidents ?? '—'}</Text>
      </View>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.label, { color: c.textSub }]}>Open high / critical</Text>
        <Text style={[styles.value, { color: c.text }]}>{data?.highCriticalIncidents ?? '—'}</Text>
      </View>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.label, { color: c.textSub }]}>Edge devices online</Text>
        <Text style={[styles.value, { color: c.text }]}>
          {data != null ? `${data.edgeDevicesOnline} / ${data.edgeDevicesTotal}` : '—'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { padding: 16, paddingBottom: 32 },
  h1: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  label: { fontSize: 14, marginBottom: 4 },
  value: { fontSize: 28, fontWeight: '600' },
});
