/**
 * Login Page
 * Form login dengan username, password, dan Device ID
 */

import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Login.css';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!username || !password || !deviceId) {
      setError('Semua field harus diisi');
      return;
    }

    setLoading(true);
    const result = await login(username, password, deviceId);
    setLoading(false);

    if (!result.success) {
      setError(result.error || 'Login gagal');
    }
  };

  const demoAccounts = [
    { role: 'Mahasiswa', username: 'mahasiswa1', password: 'Mhs@123', deviceId: 'dev-mhs-001' },
    { role: 'Dosen', username: 'dosen1', password: 'Dosen@123', deviceId: 'dev-dosen-001' },
    { role: 'Admin', username: 'admin1', password: 'Admin@123', deviceId: 'dev-admin-001' },
  ];

  const fillDemo = (account) => {
    setUsername(account.username);
    setPassword(account.password);
    setDeviceId(account.deviceId);
    setError('');
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>Zero Trust Security</h1>
        <h2>Sistem Informasi Akademik</h2>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Masukkan username"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Masukkan password"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="deviceId">Device ID</label>
            <input
              id="deviceId"
              type="text"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="Masukkan Device ID"
              disabled={loading}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="btn-login" disabled={loading}>
            {loading ? 'Memproses...' : 'Login'}
          </button>
        </form>

        <div className="demo-accounts">
          <h3>Akun Demo</h3>
          <div className="demo-buttons">
            {demoAccounts.map((account) => (
              <button
                key={account.username}
                onClick={() => fillDemo(account)}
                className="btn-demo"
                disabled={loading}
              >
                {account.role}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
