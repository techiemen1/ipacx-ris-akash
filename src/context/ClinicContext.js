import React, { createContext, useContext, useState, useEffect } from "react";
import api from "../api/axios";

const ClinicContext = createContext();

export const ClinicProvider = ({ children }) => {
  const [clinics, setClinics] = useState([]);
  const [activeClinic, setActiveClinic] = useState(null);

  useEffect(() => {
    fetchClinics();
  }, []);

  const fetchClinics = async () => {
    try {
      const res = await api.get("/api/clinics/user-clinics").catch(() => null) || await api.get("/api/clinics").catch(() => null);
      let list = [];
      if (res?.data?.availableClinics && Array.isArray(res.data.availableClinics)) {
        list = res.data.availableClinics;
      } else if (Array.isArray(res?.data)) {
        list = res.data;
      }

      if (list.length > 0) {
        setClinics(list);
        const storedCode = localStorage.getItem("activeClinicCode") || localStorage.getItem("activeClinicId");
        const match = list.find((c) => String(c.code) === String(storedCode) || String(c.id) === String(storedCode)) || list[0];
        setActiveClinic(match);
        if (api.defaults) {
          api.defaults.headers.common["X-Clinic-ID"] = match.id;
          api.defaults.headers.common["X-Clinic-Code"] = match.code;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch clinics context:", err.message);
    }
  };

  const switchClinic = (clinic) => {
    if (!clinic) return;
    setActiveClinic(clinic);
    localStorage.setItem("activeClinicCode", clinic.code || clinic.id);
    localStorage.setItem("activeClinicId", clinic.id);
    if (api.defaults) {
      api.defaults.headers.common["X-Clinic-ID"] = clinic.id;
      api.defaults.headers.common["X-Clinic-Code"] = clinic.code;
    }
  };

  return (
    <ClinicContext.Provider value={{ clinics, activeClinic, switchClinic, refreshClinics: fetchClinics }}>
      {children}
    </ClinicContext.Provider>
  );
};

export const useClinic = () => useContext(ClinicContext);
