import axios from "axios";

const envBaseURL = (process.env.REACT_APP_API_BASE_URL || "").replace(/\/$/, "");
const inferredBaseURL = `${window.location.protocol}//${window.location.hostname}:5000/api`;
const baseURL = envBaseURL || inferredBaseURL;

const axiosInstance = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor to add token
axiosInstance.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token expiration
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const token = sessionStorage.getItem("token");
      const onLoginPage = window.location.pathname === "/";
      if (token && !onLoginPage) {
        // Token expired or invalid
        sessionStorage.removeItem("user");
        sessionStorage.removeItem("token");
        delete axiosInstance.defaults.headers.common["Authorization"];
        window.location.href = "/";
      }
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
