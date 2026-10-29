/**
 * Main App Component
 * Routing dan protection berdasarkan role
 */

import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import DashboardMahasiswa from './pages/DashboardMahasiswa';
import DashboardDosen from './pages/DashboardDosen';
import DashboardAdmin from './pages/DashboardAdmin';
import './App.css';

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Memuat...</p>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  // Route berdasarkan role
  switch (user.role) {
    case 'mahasiswa':
      return <DashboardMahasiswa />;
    case 'dosen':
      return <DashboardDosen />;
    case 'admin':
      return <DashboardAdmin />;
    default:
      return (
        <div className="app-error">
          <h1>Role tidak dikenali</h1>
          <p>Role: {user.role}</p>
        </div>
      );
  }
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
