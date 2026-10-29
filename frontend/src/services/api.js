/**
 * API Service - Komunikasi dengan API Gateway
 * Semua request ke http://localhost:3000 dengan credentials: include
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

class ApiService {
  constructor() {
    this.accessToken = null;
    this.deviceId = null;
  }

  setAccessToken(token) {
    this.accessToken = token;
  }

  setDeviceId(deviceId) {
    this.deviceId = deviceId;
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    if (this.deviceId) {
      headers['X-Device-ID'] = this.deviceId;
    }

    return headers;
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const config = {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
      credentials: 'include', // HttpOnly cookie untuk refresh token
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      throw error;
    }
  }

  // Authentication
  async login(username, password, deviceId) {
    this.setDeviceId(deviceId);
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    
    if (data.accessToken) {
      this.setAccessToken(data.accessToken);
    }
    
    return data;
  }

  async refresh() {
    const data = await this.request('/auth/refresh', {
      method: 'POST',
    });
    
    if (data.accessToken) {
      this.setAccessToken(data.accessToken);
    }
    
    return data;
  }

  async logout() {
    const data = await this.request('/auth/logout', {
      method: 'POST',
    });
    this.accessToken = null;
    this.deviceId = null;
    return data;
  }

  // Nilai endpoints
  async getNilai() {
    return this.request('/nilai', {
      method: 'GET',
    });
  }

  async updateNilai(nilaiId, grade) {
    return this.request(`/nilai/${nilaiId}`, {
      method: 'PUT',
      body: JSON.stringify({ nilai: grade }),
    });
  }

  async finalisasiKelas(kelasId) {
    return this.request(`/kelas/${kelasId}/finalisasi`, {
      method: 'POST',
    });
  }

  async getAdminNilai() {
    return this.request('/admin/nilai', {
      method: 'GET',
    });
  }

  async revertNilai(nilaiId) {
    return this.request(`/nilai/${nilaiId}/revert`, {
      method: 'POST',
    });
  }

  // Transkrip endpoints
  async getTranskrip(nim) {
    return this.request(`/transkrip/${nim}`, {
      method: 'GET',
    });
  }
}

export default new ApiService();
