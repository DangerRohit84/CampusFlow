import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { notificationAPI } from '../services/api';

// #12 mobile parity start: notifications via existing /notifications API.
// Legacy endpoint uses `read` boolean (web NotificationsPage maps isRead on
// the canonical route — here we read `read` with `isRead` fallback).
interface MobileNotification {
  id: string;
  title: string;
  message: string;
  read?: boolean;
  isRead?: boolean;
  createdAt?: string;
  type?: string;
}

function isUnread(n: MobileNotification): boolean {
  if (typeof n.read === 'boolean') return !n.read;
  if (typeof n.isRead === 'boolean') return !n.isRead;
  return false;
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationsScreen() {
  const [items, setItems] = useState<MobileNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await notificationAPI.getAll();
      const list: MobileNotification[] = Array.isArray(res) ? res : (res?.data ?? []);
      setItems(list);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not load notifications');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true, isRead: true } : n)));
    try {
      await notificationAPI.markRead(id);
    } catch {
      // Revert on failure so the badge never lies.
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: false, isRead: false } : n)));
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const prev = items;
    setItems((list) => list.map((n) => ({ ...n, read: true, isRead: true })));
    try {
      await notificationAPI.markAllRead();
    } catch {
      setItems(prev);
    }
  }, [items]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1ed760" />
        <Text style={styles.muted}>Loading notifications…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Notifications</Text>
        <Text style={styles.muted}>{error}</Text>
        <TouchableOpacity style={styles.button} onPress={() => load()}>
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const unread = items.filter(isUnread).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.muted}>{unread > 0 ? `${unread} unread` : 'All caught up'}</Text>
        </View>
        {unread > 0 && (
          <TouchableOpacity style={styles.linkButton} onPress={markAllRead}>
            <Text style={styles.linkText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={items.length === 0 ? styles.center : styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        ListEmptyComponent={<Text style={styles.muted}>No new notifications</Text>}
        renderItem={({ item }) => {
          const unreadRow = isUnread(item);
          return (
            <TouchableOpacity
              style={[styles.row, unreadRow && styles.rowUnread]}
              onPress={() => unreadRow && markRead(item.id)}
            >
              <View style={styles.rowDot}>{unreadRow && <View style={styles.dot} />}</View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.title || 'Notification'}</Text>
                {!!item.message && <Text style={styles.rowMessage}>{item.message}</Text>}
                {!!item.createdAt && <Text style={styles.rowTime}>{timeAgo(item.createdAt)}</Text>}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 24 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1F2937' },
  muted: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { flexDirection: 'row', padding: 14, borderRadius: 12, backgroundColor: '#f6f6f6', marginBottom: 8 },
  rowUnread: { backgroundColor: '#eef7f0', borderWidth: 1, borderColor: '#1ed76033' },
  rowDot: { width: 16, alignItems: 'center', paddingTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1ed760' },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: '#121212' },
  rowMessage: { fontSize: 14, color: '#374151', marginTop: 2 },
  rowTime: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
  button: { marginTop: 16, backgroundColor: '#1ed760', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '600' },
  linkButton: { paddingHorizontal: 12, paddingVertical: 8 },
  linkText: { color: '#1db954', fontWeight: '600', fontSize: 14 },
});
