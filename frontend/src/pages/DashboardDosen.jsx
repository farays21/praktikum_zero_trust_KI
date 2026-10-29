/**
 * Dashboard Dosen
 * - Melihat nilai dari kelas yang diajarnya
 * - Mengubah nilai (draft only, time constraint)
 * - Finalisasi kelas
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiService from '../services/api';
import './DashboardDosen.css';

export default function DashboardDosen() {
  const { user, logout } = useAuth();
  const [nilaiList, setNilaiList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editGrade, setEditGrade] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadNilai();
  }, []);

  const loadNilai = async () => {
    setLoading(true);
    setError('');
    
    try {
      const data = await apiService.getNilai();
      setNilaiList(data.nilai || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  const startEdit = (nilai) => {
    if (nilai.status !== 'draft') {
      setError('Nilai final tidak dapat diubah');
      return;
    }
    setEditingId(nilai.id);
    setEditGrade(nilai.nilai === null || nilai.nilai === undefined ? '' : String(nilai.nilai));
    setError('');
    setSuccessMessage('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditGrade('');
  };

  const saveEdit = async (nilaiId) => {
    const raw = String(editGrade).trim();

    if (raw.length === 0) {
      setError('Nilai tidak boleh kosong');
      return;
    }

    // Format nilai yang didukung backend: angka 0-100 (kolom nilai REAL)
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
      setError('Nilai harus berupa angka antara 0 sampai 100');
      return;
    }

    setActionLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      await apiService.updateNilai(nilaiId, numeric);
      setSuccessMessage('Nilai berhasil diperbarui');
      setEditingId(null);
      await loadNilai();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleFinalisasi = async (kelasId, kelasNama) => {
    const confirm = window.confirm(
      `Finalisasi kelas "${kelasNama}"?\n\n` +
      'Nilai akan menjadi final dan tidak dapat diubah lagi.\n' +
      'Transkrip mahasiswa akan otomatis diperbarui.'
    );

    if (!confirm) return;

    setActionLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const result = await apiService.finalisasiKelas(kelasId);
      const syncedCount = result.transcriptSync?.synchronizedStudents?.length || 0;
      setSuccessMessage(
        `Finalisasi berhasil! ${result.finalized || 0} nilai difinalisasi. ` +
        `${syncedCount} transkrip diperbarui.`
      );
      await loadNilai();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Group nilai by kelas
  const kelasList = nilaiList.reduce((acc, nilai) => {
    const kelasId = nilai.kelas_id;
    if (!acc[kelasId]) {
      acc[kelasId] = {
        id: kelasId,
        kode_mk: nilai.kode_kelas,
        nama_mk: nilai.nama_matakuliah,
        semester: nilai.semester,
        nilai: [],
      };
    }
    acc[kelasId].nilai.push(nilai);
    return acc;
  }, {});

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
          <h1>Dashboard Dosen</h1>
          <p className="user-info">
            {user.username} - <span className="role-badge dosen">Dosen</span>
          </p>
        </div>
        <button onClick={handleLogout} className="btn-logout">
          Logout
        </button>
      </header>

      <div className="content-section">
        <h2>Daftar Kelas dan Nilai</h2>

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

        {Object.keys(kelasList).length === 0 ? (
          <div className="empty-state">Tidak ada kelas yang diampu</div>
        ) : (
          Object.values(kelasList).map((kelas) => {
            const allFinal = kelas.nilai.every(n => n.status === 'final');
            const canFinalize = kelas.nilai.length > 0 && !allFinal;

            return (
              <div key={kelas.id} className="kelas-card">
                <div className="kelas-header">
                  <div>
                    <h3>{kelas.kode_mk} - {kelas.nama_mk}</h3>
                    <p className="kelas-info">Semester {kelas.semester}</p>
                  </div>
                  {canFinalize && (
                    <button
                      onClick={() => handleFinalisasi(kelas.id, kelas.nama_mk)}
                      className="btn-finalize"
                      disabled={actionLoading}
                    >
                      Finalisasi Kelas
                    </button>
                  )}
                  {allFinal && (
                    <span className="status-badge final">Sudah Difinalisasi</span>
                  )}
                </div>

                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>NIM</th>
                        <th>Nama Mahasiswa</th>
                        <th>Nilai</th>
                        <th>Status</th>
                        <th>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kelas.nilai.map((nilai) => (
                        <tr key={nilai.id}>
                          <td>{nilai.nim}</td>
                          <td>{nilai.nama_mahasiswa}</td>
                          <td>
                            {editingId === nilai.id ? (
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={editGrade}
                                onChange={(e) => setEditGrade(e.target.value)}
                                className="grade-input"
                                placeholder="0-100"
                                disabled={actionLoading}
                              />
                            ) : (
                              <span className="grade-badge">
                                {nilai.nilai === null || nilai.nilai === undefined ? '-' : nilai.nilai}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`status-badge ${nilai.status}`}>
                              {nilai.status === 'final' ? 'Final' : 'Draft'}
                            </span>
                          </td>
                          <td>
                            {editingId === nilai.id ? (
                              <div className="action-buttons">
                                <button
                                  onClick={() => saveEdit(nilai.id)}
                                  className="btn-save"
                                  disabled={actionLoading}
                                >
                                  Simpan
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="btn-cancel"
                                  disabled={actionLoading}
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEdit(nilai)}
                                className="btn-edit"
                                disabled={nilai.status === 'final' || actionLoading}
                              >
                                {nilai.status === 'final' ? 'Final' : 'Ubah'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}

        <div className="info-box">
          <h4>⚠️ Catatan Penting</h4>
          <ul>
            <li>Perubahan nilai dan finalisasi hanya dapat dilakukan pada jam 07:00-21:00</li>
            <li>Nilai yang sudah final tidak dapat diubah</li>
            <li>Finalisasi kelas akan otomatis memperbarui transkrip mahasiswa</li>
            <li>Nilai yang valid: angka 0 sampai 100</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
