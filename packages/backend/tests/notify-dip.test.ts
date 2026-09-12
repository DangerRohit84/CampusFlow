/**
 * Track 4 — DIP exemplar test: notifyUsers depends on the NotificationStore
 * interface, not on Prisma. Fakes inject persistence + presence (no DB/socket).
 */
import { describe, it, expect } from 'vitest';
import { notifyUsers } from '../src/services/notificationService';
import { inMemoryNotificationStore } from '../src/lib/repository';

describe('notifyUsers (DIP: injected store + presence)', () => {
  it('persists one row per unique user and emits only to online users', async () => {
    const store = inMemoryNotificationStore();
    const emitted: string[] = [];
    const rows = await notifyUsers(['u1', 'u2', 'u1', ''], { title: 'T', message: 'M' }, {
      store,
      emit: (userId: string) => {
        emitted.push(userId);
      },
      isOnline: (userId: string) => userId === 'u1',
    });
    expect(rows.map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
    expect(rows.every((r) => r.id.length > 0)).toBe(true);
    expect(store.rows).toHaveLength(2);
    expect(emitted).toEqual(['u1']);
  });

  it('falls back to createMany when createManyAndReturn is unavailable', async () => {
    let fallback = 0;
    const created = await notifyUsers(['u9'], { title: 'T', message: 'M' }, {
      store: {
        createManyAndReturn: async () => {
          throw new Error('unsupported');
        },
        createMany: async () => {
          fallback++;
          return { count: 1 };
        },
      },
      emit: () => {},
      isOnline: () => true,
    });
    expect(fallback).toBe(1);
    expect(created).toEqual([{ id: '', userId: 'u9' }]);
  });

  it('returns [] without touching the store for empty input', async () => {
    const store = inMemoryNotificationStore();
    expect(await notifyUsers([], { title: 'T', message: 'M' }, { store })).toEqual([]);
    expect(store.rows).toHaveLength(0);
  });
});
