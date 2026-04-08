import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { registerPushTokenWithCmp } from '@/lib/push';
import { useTheme } from '@/lib/theme';

const isAndroidExpoGo = Platform.OS === 'android' && Constants.appOwnership === 'expo';

const RISKS = ['low', 'medium', 'high', 'critical'] as const;

type Pref = {
  minRiskLevel: string;
  criticalTypesOnly: boolean;
  alertsEnabled: boolean;
  projectIds: unknown;
};

type Project = { id: string; name: string };

const ADMIN_ROLE = 'admin';

export default function SettingsScreen() {
  const { logout, user } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const router = useRouter();
  const c = useTheme();
  const isAdmin = user?.role === ADMIN_ROLE;
  const [pref, setPref] = useState<Pref | null>(null);
  const [projectScope, setProjectScope] = useState<Project[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const applyPreferencePayload = useCallback((data: { preference: Pref; projectScope?: Project[] }) => {
    setPref(data.preference);
    const raw = data.preference.projectIds;
    const ids = Array.isArray(raw) ? (raw as string[]) : [];
    setSelectedProjects(new Set(ids));
    if (Array.isArray(data.projectScope)) setProjectScope(data.projectScope);
  }, []);

  const load = useCallback(async () => {
    const pRes = await apiFetch<{ preference: Pref; projectScope?: Project[] }>(
      '/api/mobile/alert-preferences'
    );
    if (pRes.ok) applyPreferencePayload(pRes.data);

    if (isAdmin) {
      const projRes = await apiFetch<{ projects: Project[] }>('/api/mobile/projects');
      if (projRes.ok) setProjects(projRes.data.projects);
    } else {
      setProjects([]);
    }
    setLoading(false);
  }, [applyPreferencePayload, isAdmin]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  async function savePatch(body: Record<string, unknown>) {
    if (!isAdmin) return;
    setSaving(true);
    setMessage(null);
    const res = await apiFetch<{ preference: Pref; projectScope?: Project[] }>('/api/mobile/alert-preferences', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      applyPreferencePayload(res.data);
      setMessage(t('settings.saved'));
    } else setMessage(res.error.message);
  }

  async function onRegisterPush() {
    if (isAndroidExpoGo) {
      setMessage(`${t('settings.pushNotifications')} are not supported in Expo Go on Android. Build a standalone APK to enable them.`);
      return;
    }
    setPushBusy(true);
    setMessage(null);
    const token = await registerPushTokenWithCmp();
    setPushBusy(false);
    setMessage(token ? t('settings.pushRegistered') : t('settings.pushDenied'));
  }

  async function onTestPush() {
    setTestBusy(true);
    setMessage(null);
    const res = await apiFetch<{ ok?: boolean; message?: string }>('/api/mobile/push/test', {
      method: 'POST',
      body: '{}',
    });
    setTestBusy(false);
    if (res.ok) setMessage(t('settings.testSent', { count: (res.data as { sent?: number }).sent ?? 0 }));
    else setMessage(res.error.message);
  }

  function toggleProject(id: string) {
    if (!isAdmin) return;
    const next = new Set(selectedProjects);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedProjects(next);
    void savePatch({ projectIds: [...next] });
  }

  if (loading || !pref) {
    return (
      <View style={[styles.centered, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const displayProjects = isAdmin ? projects : projectScope;
  const alertParamsReadOnly = !isAdmin;

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.section, { color: c.text }]}>{t('settings.signedIn')}</Text>
      <Text style={[styles.email, { color: c.text }]}>{user?.email}</Text>
      <Text style={[styles.role, { color: c.textMuted }]}>{user?.role}</Text>

      <Text style={[styles.section, { color: c.text }]}>{t('settings.language')}</Text>
      <View style={styles.languageRow}>
        <Pressable
          style={[styles.languageButton, locale === 'en' && styles.languageButtonActive]}
          onPress={() => void setLocale('en')}
        >
          <Text style={[styles.languageButtonText, locale === 'en' && styles.languageButtonTextActive]}>{t('settings.english')}</Text>
        </Pressable>
        <Pressable
          style={[styles.languageButton, locale === 'zh-Hant' && styles.languageButtonActive]}
          onPress={() => void setLocale('zh-Hant')}
        >
          <Text style={[styles.languageButtonText, locale === 'zh-Hant' && styles.languageButtonTextActive]}>{t('settings.traditionalChinese')}</Text>
        </Pressable>
      </View>

      {alertParamsReadOnly ? (
        <Text style={[styles.readOnlyBanner, { color: c.textSub, backgroundColor: c.surface }]}>
          {t('settings.adminNote')}
        </Text>
      ) : null}

      <Text style={[styles.section, { color: c.text }]}>{t('settings.alertThreshold')}</Text>
      <Text style={[styles.hint, { color: c.textMuted }]}>{t('settings.notifyAbove')}</Text>
      <View style={styles.riskRow}>
        {RISKS.map((r) => (
          <Pressable
            key={r}
            style={[
              styles.riskChip,
              { backgroundColor: c.surface },
              pref.minRiskLevel === r && styles.riskChipActive,
            ]}
            onPress={() => void savePatch({ minRiskLevel: r })}
            disabled={saving || alertParamsReadOnly}
          >
            <Text style={[styles.riskChipText, { color: c.text }, pref.minRiskLevel === r && styles.riskChipTextActive]}>
              {r}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.rowBetween, { borderBottomColor: c.border }]}>
        <Text style={{ color: c.text }}>{t('settings.alertsEnabled')}</Text>
        <Switch
          value={pref.alertsEnabled}
          onValueChange={(v) => void savePatch({ alertsEnabled: v })}
          disabled={saving || alertParamsReadOnly}
        />
      </View>

      <View style={[styles.rowBetween, { borderBottomColor: c.border }]}>
        <Text style={{ color: c.text }}>{t('settings.criticalOnly')}</Text>
        <Switch
          value={pref.criticalTypesOnly}
          onValueChange={(v) => void savePatch({ criticalTypesOnly: v })}
          disabled={saving || alertParamsReadOnly}
        />
      </View>

      <Text style={[styles.section, { color: c.text }]}>{t('settings.projectFilter')}</Text>
      <Text style={[styles.hint, { color: c.textMuted }]}>
        {isAdmin ? t('settings.leaveNone') : t('settings.projectsYouReceive')}
      </Text>
      {displayProjects.length === 0 && !isAdmin && selectedProjects.size === 0 ? (
        <Text style={[styles.hint, { color: c.textMuted }]}>{t('settings.allProjects')}</Text>
      ) : null}
      {displayProjects.map((p) => (
        <Pressable
          key={p.id}
          style={[styles.rowBetween, { borderBottomColor: c.border }]}
          onPress={() => toggleProject(p.id)}
          disabled={alertParamsReadOnly}
        >
          <Text style={{ color: c.text }}>{p.name}</Text>
          <Text style={[styles.checkCol, { color: c.text }]}>{selectedProjects.has(p.id) ? '✓' : ''}</Text>
        </Pressable>
      ))}
      {isAdmin && displayProjects.length === 0 ? (
        <Text style={[styles.hint, { color: c.textMuted }]}>{t('settings.loadingProjects')}</Text>
      ) : null}

      <Text style={[styles.section, { color: c.text }]}>{t('settings.pushNotifications')}</Text>
      <Pressable style={styles.button} onPress={() => void onRegisterPush()} disabled={pushBusy}>
        <Text style={styles.buttonText}>{pushBusy ? '…' : t('settings.registerPush')}</Text>
      </Pressable>
      <Pressable style={[styles.buttonSecondary, { borderColor: '#2563eb' }]} onPress={() => void onTestPush()} disabled={testBusy}>
        <Text style={styles.buttonSecondaryText}>{testBusy ? '…' : t('settings.sendTest')}</Text>
      </Pressable>

      {message ? <Text style={[styles.message, { color: c.text }]}>{message}</Text> : null}

      <Pressable
        style={styles.logout}
        onPress={async () => {
          await logout();
          router.replace('/login');
        }}
      >
        <Text style={styles.logoutText}>{t('settings.signOut')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { padding: 16, paddingBottom: 48 },
  section: { fontSize: 18, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  email: { fontSize: 15 },
  role: { fontSize: 13, color: '#71717a', marginBottom: 8 },
  readOnlyBanner: {
    fontSize: 13,
    color: '#52525b',
    backgroundColor: '#f4f4f5',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  hint: { fontSize: 13, color: '#71717a', marginBottom: 8 },
  riskRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  riskChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#e4e4e7',
  },
  riskChipActive: { backgroundColor: '#2563eb' },
  riskChipText: { textTransform: 'capitalize', color: '#18181b' },
  riskChipTextActive: { color: '#fff', fontWeight: '600' },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e4e4e7',
  },
  checkCol: { minWidth: 24, textAlign: 'right' },
  button: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#2563eb',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonSecondaryText: { color: '#2563eb', fontWeight: '600' },
  message: { marginTop: 12, fontSize: 14, color: '#16a34a' },
  logout: { marginTop: 32, padding: 14, alignItems: 'center' },
  logoutText: { color: '#dc2626', fontWeight: '600', fontSize: 16 },
  languageRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  languageButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#e4e4e7' },
  languageButtonActive: { backgroundColor: '#2563eb' },
  languageButtonText: { color: '#18181b', fontWeight: '500' },
  languageButtonTextActive: { color: '#fff' },
});
