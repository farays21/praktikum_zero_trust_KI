/**
 * AuthContext - State management untuk autentikasi
 * Access token disimpan di memory (tidak di localStorage untuk keamanan)
 * Refresh token di HttpOnly cookie (dikelola browser otomatis)
 */

import { createContext, useContext, useState, useEffect } from 'react';
import apiService from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Coba refresh token saat app dimuat (jika ada cookie)
  useEffect(() => {
    const tryRefresh = async () => {
      const savedDeviceId = localStorage.getItem('deviceId');
      if (savedDeviceId) {
        apiService.setDeviceId(savedDeviceId);
        try {
          const data = await apiService.refresh();
          setUser(data.user || { username: 'unknown', role: 'unknown' });
        } catch (err) {
          // Refresh gagal, user harus login lagi
          localStorage.removeItem('deviceId');
        }
      }
      setLoading(false);
    };

    tryRefresh();
  }, []);

  const login = async (username, password, deviceId) => {
    try {
      setError(null);
      const data = await apiService.login(username, password, deviceId);
      
      setUser(data.user);
      localStorage.setItem('deviceId', deviceId);
      
      return { success: true, user: data.user };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  const logout = async () => {
    try {
      await apiService.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      localStorage.removeItem('deviceId');
    }
  };

  const refreshToken = async () => {
    try {
      const data = await apiService.refresh();
      return { success: true };
    } catch (err) {
      // Token expired atau invalid, logout
      await logout();
      return { success: false, error: err.message };
    }
  };

  const value = {
    user,
    loading,
    error,
    login,
    logout,
    refreshToken,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
