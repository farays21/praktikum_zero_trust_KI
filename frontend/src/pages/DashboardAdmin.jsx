/**
 * Dashboard Admin
 * - Melihat transkrip mahasiswa berdasarkan NIM
 */

import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiService from '../services/api';
import './DashboardAdmin.css';

export default function DashboardAdmin() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('transkrip');
  const [nim, setNim] = useState('');
  const [transkrip, setTranskrip] = useState(null);
  const [nilaiList, setNilaiList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const handleLogout = async () => {
    await logout();
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    
    if (!nim) {
      setError('NIM harus diisi');
      return;
    }

    setLoading(true);
    setError('');
    setTranskrip(null);
    setSearched(false);
    setSuccessMessage('');

    try {
      const data = await apiService.getTranskrip(nim);
      setTranskrip(data);
      setSearched(true);
    } catch (err) {
      setError(err.message);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const loadAllNilai = async () => {
    setLoading(true);
    setError('');
    setSuccessMessage('');
    setNilaiList([]);

    try {
      const data = await apiService.getAdminNilai();
      setNilaiList(data.nilai || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fillDemoNim = (demoNim) => {
    setNim(demoNim);
    setError('');
    setSuccessMessage('');
  };

  const handleRevert = async (nilaiId, kodeKelas, namaMatakuliah) => {
    const confirm = window.confirm(
      `Kembalikan nilai dari ${kodeKelas} - ${namaMatakuliah} ke status DRAFT?\n\n` +
      'Nilai akan dapat diubah kembali oleh dosen. Transkrip mahasiswa akan diperbarui.'
    );

    if (!confirm) return;

    setActionLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      await apiService.revertNilai(nilaiId);
      setSuccessMessage('Nilai berhasil dikembalikan ke status DRAFT');
      await loadAllNilai();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Dashboard Admin</h1>
          <p className="user-info">
            {user.username} - <span className="role-badge admin">Admin</span>
          </p>
        </div>
        <button onClick={handleLogout} className="btn-logout">
          Logout
        </button>
      </header>

      <div className="content-section">
        <div className="tab-navigation" style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          <button
            onClick={() => { setActiveTab('transkrip'); setError(''); setSuccessMessage(''); }}
            className={`btn-tab ${activeTab === 'transkrip' ? 'active' : ''}`}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
              background: activeTab === 'transkrip' ? '#667eea' : '#e2e8f0',
              color: activeTab === 'transkrip' ? 'white' : '#4a5568',
            }}
          >
            Cari Transkrip
          </button>
          <button
            onClick={() => { setActiveTab('nilai'); loadAllNilai(); }}
            className={`btn-tab ${activeTab === 'nilai' ? 'active' : ''}`}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
              background: activeTab === 'nilai' ? '#667eea' : '#e2e8f0',
              color: activeTab === 'nilai' ? 'white' : '#4a5568',
            }}
          >
            Kelola Status Nilai (Revert)
          </button>
        </div>

        {error && (
          <div className="error-banner">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="success-banner">
            {successMessage}
          </div>
        )}

        {activeTab === 'transkrip' && (
          <>
            <h2>Cari Transkrip Mahasiswa</h2>

            <div className="search-box">
              <form onSubmit={handleSearch} className="search-form">
                <div className="form-group">
                  <label htmlFor="nim">NIM Mahasiswa</label>
                  <input
                    id="nim"
                    type="text"
                    value={nim}
                    onChange={(e) => setNim(e.target.value)}
                    placeholder="Masukkan NIM"
                    disabled={loading}
                    className="nim-input"
                  />
                </div>
                <button type="submit" className="btn-search" disabled={loading}>
                  {loading ? 'Mencari...' : 'Cari Transkrip'}
                </button>
              </form>

              <div className="demo-nims">
                <p>NIM Demo:</p>
                <div className="demo-buttons">
                  <button onClick={() => fillDemoNim('2024001')} className="btn-demo" disabled={loading}>
                    2024001
                  </button>
                  <button onClick={() => fillDemoNim('2024002')} className="btn-demo" disabled={loading}>
                    2024002
                  </button>
                  <button onClick={() => fillDemoNim('2024003')} className="btn-demo" disabled={loading}>
                    2024003
                  </button>
                </div>
              </div>
            </div>

            {searched && !transkrip && !error && (
              <div className="empty-state">Transkrip tidak ditemukan untuk NIM {nim}</div>
            )}

            {transkrip && (
              <div className="transkrip-result">
                <h3>Transkrip Mahasiswa</h3>
                
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

                {transkrip.courses && transkrip.courses.length > 0 ? (
                  <div className="table-container">
                    <h4>Detail Nilai</h4>
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
                ) : (
                  <div className="empty-state">Belum ada nilai yang difinalisasi</div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'nilai' && (
          <div className="transkrip-result">
            <h3>Daftar Semua Nilai Akademik</h3>
            <p style={{ color: '#666', marginBottom: '20px' }}>
              Admin dapat mengembalikan status nilai berstatus <strong>FINAL</strong> menjadi <strong>DRAFT</strong> agar dosen dapat mengeditnya kembali.
            </p>

            {loading ? (
              <div className="loading">Memuat data nilai...</div>
            ) : nilaiList.length === 0 ? (
              <div className="empty-state">Belum ada data nilai</div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>NIM</th>
                      <th>Nama Mahasiswa</th>
                      <th>Mata Kuliah</th>
                      <th>Nilai</th>
                      <th>Status</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nilaiList.map((item) => (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>{item.nim}</td>
                        <td>{item.nama_mahasiswa || item.mahasiswa}</td>
                        <td>{item.kode_kelas} - {item.nama_matakuliah}</td>
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
                        <td>
                          {item.status === 'final' ? (
                            <button
                              onClick={() => handleRevert(item.id, item.kode_kelas, item.nama_matakuliah)}
                              className="btn-revert"
                              disabled={actionLoading}
                              style={{
                                padding: '6px 12px',
                                background: '#e53e3e',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '13px',
                                fontWeight: 500,
                              }}
                            >
                              Kembalikan ke Draft
                            </button>
                          ) : (
                            <span style={{ color: '#888', fontSize: '13px' }}>Draft (Bisa diisi Dosen)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="info-box">
          <h4>ℹ️ Informasi Keamanan Admin</h4>
          <ul>
            <li>Admin dapat melihat transkrip semua mahasiswa.</li>
            <li>Admin dapat mengembalikan status nilai <strong>FINAL</strong> menjadi <strong>DRAFT</strong>.</li>
            <li>Pengembalian status akan otomatis memperbarui data transkrip (nilai draft dihapus dari transkrip).</li>
            <li>Dosen tidak dapat mengedit nilai selama statusnya masih FINAL.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
