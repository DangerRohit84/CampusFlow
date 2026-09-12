import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import { dashboardAPI } from '../services/api';

// #12 mobile parity start: dashboard via existing GET /user/dashboard.
// Same endpoint as web dashboardAPI — role-specific shape (STUDENT /
// TEACHER / COLLEGE_ADMIN / SUPER_ADMIN). Pull-to-refresh, retry on error.
export default function DashboardScreen() {
  const { user } = useAuthStore();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await dashboardAPI.get();
      setData(res);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1ed760" />
        <Text style={styles.muted}>Loading dashboard…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.muted}>{error}</Text>
        <TouchableOpacity style={styles.button} onPress={() => load()}>
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const role = data?.role || user?.role || 'STUDENT';

  const stats: { label: string; value: string }[] =
    role === 'TEACHER'
      ? [
          { label: 'Courses', value: String(data?.totalCourses ?? 0) },
          { label: 'Students', value: String(data?.totalStudents ?? 0) },
          { label: 'Hackathons', value: String(data?.hackathons ?? 0) },
          { label: 'Forms', value: String(data?.forms ?? 0) },
        ]
      : role === 'COLLEGE_ADMIN' || role === 'SUPER_ADMIN'
        ? [
            { label: 'Users', value: String(data?.totalUsers ?? 0) },
            { label: 'Teachers', value: String(data?.totalTeachers ?? 0) },
            { label: 'Students', value: String(data?.totalStudents ?? 0) },
            { label: 'Hackathons', value: String(data?.hackathons ?? 0) },
          ]
        : [
            { label: 'CGPA', value: String(data?.cgpa ?? '—') },
            { label: 'Pending', value: String(data?.pendingAssignments ?? 0) },
            { label: 'Due soon', value: String(data?.upcomingDeadlines ?? 0) },
            { label: 'Unread', value: String(data?.unreadNotifications ?? 0) },
          ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
    >
      <Text style={styles.greeting}>Hi {user?.name?.split(' ')[0] || 'there'} 👋</Text>
      <Text style={styles.subtitle}>{role} · CampusFlow overview</Text>
      <View style={styles.grid}>
        {stats.map((s) => (
          <View key={s.label} style={styles.card}>
            <Text style={styles.cardValue}>{s.value}</Text>
            <Text style={styles.cardLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
      {Array.isArray(data?.todaySchedule) && data.todaySchedule.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today&apos;s classes ({data.todaySchedule.length})</Text>
          {data.todaySchedule.slice(0, 5).map((s: any) => (
            <View key={s.id} style={styles.row}>
              <Text style={styles.rowTitle}>{s.title}</Text>
              <Text style={styles.muted}>
                {[s.startTime, s.endTime].filter(Boolean).join(' – ') || ''}
                {s.location ? ` · ${s.location}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 24 },
  greeting: { fontSize: 24, fontWeight: 'bold', color: '#121212' },
  subtitle: { fontSize: 14, color: '#62666d', marginTop: 4, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
  muted: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: '#f6f6f6',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  cardValue: { fontSize: 22, fontWeight: 'bold', color: '#121212' },
  cardLabel: { fontSize: 12, color: '#62666d', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#121212', marginBottom: 8 },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#121212' },
  button: { marginTop: 16, backgroundColor: '#1ed760', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '600' },
});
