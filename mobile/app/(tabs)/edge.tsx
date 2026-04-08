import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { useLocale } from '@/context/LocaleContext';

type Device = {
  id: string;
  name: string;
  isOnline: boolean;
  status: string;
  lastReportAt: string | null;
  latestRiskLevel: string | null;
  project: { name: string } | null;
};

export default function EdgeDevicesScreen() {
  const c = useTheme();
  const { t } = useLocale();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ devices: Device[] }>('/api/mobile/edge-devices');
    if (res.ok) setDevices(res.data.devices);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  if (loading && devices.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      data={devices}
      keyExtractor={(d) => d.id}
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
      ListEmptyComponent={<Text style={[styles.empty, { color: c.textMuted }]}>{t('edge.empty')}</Text>}
      renderItem={({ item }) => (
        <View style={[styles.row, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <View style={styles.rowTop}>
            <Text style={[styles.name, { color: c.text }]}>{item.name}</Text>
            <Text
              style={[
                styles.badge,
                item.isOnline
                  ? { backgroundColor: c.onlineBg, color: c.onlineText }
                  : { backgroundColor: c.offlineBg, color: c.offlineText },
              ]}
            >
              {item.isOnline ? t('edge.online') : t('edge.offline')}
            </Text>
          </View>
          <Text style={[styles.meta, { color: c.textSub }]}>{item.project?.name ?? '—'}</Text>
          {item.latestRiskLevel ? (
            <Text style={[styles.meta, { color: c.textSub }]}>{t('edge.latestRisk', { value: item.latestRiskLevel })}</Text>
          ) : null}
          {item.lastReportAt ? (
            <Text style={[styles.date, { color: c.textMuted }]}>
              {t('edge.lastReport', { value: new Date(item.lastReportAt).toLocaleString() })}
            </Text>
          ) : null}
        </View>
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
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '600', flex: 1 },
  badge: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  meta: { fontSize: 13, marginTop: 4 },
  date: { fontSize: 12, marginTop: 6 },
});
