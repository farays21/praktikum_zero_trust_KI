/**
 * Dashboard Mahasiswa
 * - Melihat nilai sendiri
 * - Melihat transkrip sendiri
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiService from '../services/api';
import './DashboardMahasiswa.css';

export default function DashboardMahasiswa() {
  const { user, logout } = useAuth();
  const [nilaiList, setNilaiList] = useState([]);
  const [transkrip, setTranskrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('nilai');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError('');
    
    try {
      // Load nilai
      const nilaiData = await apiService.getNilai();
      setNilaiList(nilaiData.nilai || []);

      // Load transkrip (gunakan NIM dari user)
      if (user.nim) {
        const transkripData = await apiService.getTranskrip(user.nim);
        setTranskrip(transkripData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  if (loading) {
    return (
      <div className="dashboard">
        <div className="loading">Memuat data...</div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Dashboard Mahasiswa</h1>
          <p className="user-info">
            {user.username} ({user.nim}) - <span className="role-badge mahasiswa">Mahasiswa</span>
          </p>
        </div>
        <button onClick={handleLogout} className="btn-logout">
          Logout
        </button>
      </header>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'nilai' ? 'active' : ''}`}
          onClick={() => setActiveTab('nilai')}
        >
          Nilai Saya
        </button>
        <button
          className={`tab ${activeTab === 'transkrip' ? 'active' : ''}`}
          onClick={() => setActiveTab('transkrip')}
        >
          Transkrip
        </button>
      </div>

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      {activeTab === 'nilai' && (
        <div className="content-section">
          <h2>Nilai Mata Kuliah</h2>
          {nilaiList.length === 0 ? (
            <div className="empty-state">Tidak ada data nilai</div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Mata Kuliah</th>
                    <th>SKS</th>
                    <th>Semester</th>
                    <th>Nilai</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {nilaiList.map((item) => (
                    <tr key={item.id}>
                      <td>{item.kode_kelas}</td>
                      <td>{item.nama_matakuliah}</td>
                      <td>{item.sks}</td>
                      <td>{item.semester}</td>
                      <td>
                        <span className="grade-badge">
                          {item.nilai === null || item.nilai === undefined ? '-' : item.nilai}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${item.status}`}>
                          {item.status === 'final' ? 'Final' : 'Draft'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'transkrip' && (
        <div className="content-section">
          <h2>Transkrip Akademik</h2>
          {!transkrip ? (
            <div className="empty-state">Transkrip belum tersedia</div>
          ) : (
            <div>
              <div className="transkrip-summary">
                <div className="summary-card">
                  <div className="summary-label">NIM</div>
                  <div className="summary-value">{transkrip.nim}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Total SKS</div>
                  <div className="summary-value">{transkrip.total_sks || 0}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">IPK</div>
                  <div className="summary-value">{transkrip.ipk || 'N/A'}</div>
                </div>
              </div>

              {transkrip.courses && transkrip.courses.length > 0 && (
                <div className="table-container">
                  <h3>Detail Nilai</h3>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Kode</th>
                        <th>Mata Kuliah</th>
                        <th>SKS</th>
                        <th>Semester</th>
                        <th>Nilai</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transkrip.courses.map((item, idx) => (
                        <tr key={idx}>
                          <td>{item.kode_kelas}</td>
                          <td>{item.nama_matakuliah}</td>
                          <td>{item.sks}</td>
                          <td>{item.semester}</td>
                          <td>
                            <span className="grade-badge">
                              {item.nilai === null || item.nilai === undefined ? '-' : item.nilai}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
