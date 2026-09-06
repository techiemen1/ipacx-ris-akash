import React, { createContext, useContext, useState } from "react";

const PatientContext = createContext();

export const PatientProvider = ({ children }) => {
  const [patients, setPatients] = useState([]);

  // Add new patient (default payment pending)
  const addPatient = (patient) => {
    setPatients((prev) => [
      ...prev,
      { ...patient, paymentStatus: "Pending" }
    ]);
  };

  // Mark payment completed
  const completePayment = (patientId) => {
    setPatients((prev) =>
      prev.map((p) =>
        p.patientId === patientId
          ? { ...p, paymentStatus: "Completed" }
          : p
      )
    );
  };

  return (
    <PatientContext.Provider
      value={{
        patients,
        addPatient,
        completePayment
      }}
    >
      {children}
    </PatientContext.Provider>
  );
};

export const usePatients = () => {
  const context = useContext(PatientContext);
  if (!context) {
    throw new Error("usePatients must be used inside PatientProvider");
  }
  return context;
};
