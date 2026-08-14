import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { TouchableOpacity } from 'react-native';

function DashboardTab() {
  return (
    <View style={styles.tabContainer}>
      <Text style={styles.tabTitle}>Dashboard</Text>
      <Text style={styles.tabPlaceholder}>Welcome to CampusFlow!</Text>
    </View>
  );
}

function ScheduleTab() {
  return (
    <View style={styles.tabContainer}>
      <Text style={styles.tabTitle}>Schedule</Text>
      <Text style={styles.tabPlaceholder}>Your class schedule will appear here</Text>
    </View>
  );
}

function NotificationsTab() {
  return (
    <View style={styles.tabContainer}>
      <Text style={styles.tabTitle}>Notifications</Text>
      <Text style={styles.tabPlaceholder}>No new notifications</Text>
    </View>
  );
}

function ProfileTab() {
  const { user, logout } = useAuthStore();
  return (
    <View style={styles.tabContainer}>
      <Text style={styles.tabTitle}>Profile</Text>
      <Text style={styles.tabPlaceholder}>{user?.name || 'User'}</Text>
      <Text style={styles.tabPlaceholder}>{user?.email || ''}</Text>
      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#3B82F6',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          paddingBottom: 4,
          paddingTop: 4,
          height: 60,
        },
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap;
          switch (route.name) {
            case 'Home':
              iconName = focused ? 'home' : 'home-outline';
              break;
            case 'Schedule':
              iconName = focused ? 'calendar' : 'calendar-outline';
              break;
            case 'Notifications':
              iconName = focused ? 'notifications' : 'notifications-outline';
              break;
            case 'Profile':
              iconName = focused ? 'person' : 'person-outline';
              break;
            default:
              iconName = 'ellipse';
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={DashboardTab} />
      <Tab.Screen name="Schedule" component={ScheduleTab} />
      <Tab.Screen name="Notifications" component={NotificationsTab} />
      <Tab.Screen name="Profile" component={ProfileTab} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 24,
  },
  tabTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
  },
  tabPlaceholder: {
    fontSize: 16,
    color: '#6B7280',
  },
  logoutButton: {
    marginTop: 24,
    backgroundColor: '#EF4444',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  logoutText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
});
