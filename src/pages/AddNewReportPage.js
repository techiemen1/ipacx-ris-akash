import React, { useEffect, useState, useMemo } from "react";
import MainLayout from "../layout/MainLayout";
import api from "../api/axios";
import StudiesTable from "../components/StudiesTable";
import { useNavigate } from "react-router-dom";
import CustomDatePicker from "../components/CustomDatePicker";

export default function AddNewReportPage() {
  const navigate = useNavigate();

  // ------------------ STATE ------------------
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(false);

  const [filters, setFilters] = useState(() => {
    return JSON.parse(sessionStorage.getItem("pacsDateFilters")) || {
      startDate: "",
      endDate: "",
      patientId: "",
      patientName: "",
      accession: "",
      modality: "",
      gender: "",
    };
  });

  const [activePacs, setActivePacs] = useState(() => {
    return JSON.parse(sessionStorage.getItem("activePacs"));
  });

  const rowsPerPage = 20;
  const [currentPage, setCurrentPage] = useState(1);

  // ------------------ LOAD STUDIES ------------------
  useEffect(() => {
    if (!activePacs?.id) return;

    async function loadStudies() {
      try {
        setLoading(true);

        const res = await api.get("/api/pacs/studies", {
  params: {
    pacs_id: activePacs.id,
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
  },
});

        setStudies(res.data || []);
        setCurrentPage(1);
      } catch (err) {
        console.error("Failed to load studies", err);
        setStudies([]);
      } finally {
        setLoading(false);
      }
    }

    loadStudies();
  }, [activePacs?.id, filters.startDate, filters.endDate]);

  useEffect(() => {
  if (!activePacs) {
    const saved = sessionStorage.getItem("activePacs");
    if (saved) setActivePacs(JSON.parse(saved));
  }
}, []);

  // ------------------ FILTER LOGIC ------------------
  const filteredStudies = useMemo(() => {
    return studies.filter((s) => {
      const matchId = (s.PatientID || "")
        .toLowerCase()
        .startsWith((filters.patientId || "").toLowerCase());
      const matchName = (s.PatientName || "")
        .toLowerCase()
        .startsWith((filters.patientName || "").toLowerCase());
      const matchAcc = (s.AccessionNumber || "")
        .toLowerCase()
        .startsWith((filters.accession || "").toLowerCase());
      const matchMod = !filters.modality || s.Modality === filters.modality;
      const matchGender = !filters.gender || s.PatientSex === filters.gender;

      let matchDate = true;
      if (filters.startDate) {
        const sDate = String(s.StudyDate).replace(/-/g, "");
        if (sDate < filters.startDate) matchDate = false;
        if (filters.endDate && sDate > filters.endDate) matchDate = false;
      }

      return matchId && matchName && matchAcc && matchMod && matchGender && matchDate;
    });
  }, [studies, filters]);

  const pagedStudies = filteredStudies.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  const uniqueModalities = useMemo(() => {
    return [...new Set(studies.map((s) => s.Modality))].filter(Boolean);
  }, [studies]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
    setCurrentPage(1);
  };

  const handleDateChange = (newFilters) => {
    setFilters(newFilters);
    sessionStorage.setItem("pacsDateFilters", JSON.stringify(newFilters));
  };

  // ------------------ UI ------------------
  return (
    <MainLayout>
   <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '0px', paddingTop: '0px' }}>
  <button 
    className="back-arrow-btn" 
    onClick={() => navigate('/pacspage')}
    style={{
      padding: '4px 8px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}
  >
    ←
  </button>
  <h4 style={{ margin: 0, lineHeight: '1' }}>Add New Report</h4>
</div>
      

      <div className="patient-table-scroll">
        <table className="patient-table">
          <thead>
            <tr>
              <th>#</th>
              <th>
                <div className="th-title">Patient ID</div>
                <input
                  name="patientId"
                  className="header-filter"
                  value={filters.patientId}
                  onChange={handleFilterChange}
                  placeholder="ID..."
                />
              </th>
              <th>
                <div className="th-title">Patient Name</div>
                <input
                  name="patientName"
                  className="header-filter"
                  value={filters.patientName}
                  onChange={handleFilterChange}
                  placeholder="Name..."
                />
              </th>
              <th>
                <div className="th-title">Accession</div>
                <input
                  name="accession"
                  className="header-filter"
                  value={filters.accession}
                  onChange={handleFilterChange}
                  placeholder="Acc..."
                />
              </th>
              <th>Description</th>
              <th>
                <CustomDatePicker filters={filters} setFilters={handleDateChange} />
              </th>
              <th>
                <div className="th-title">Modality</div>
                <select
                  name="modality"
                  className="header-filter"
                  value={filters.modality}
                  onChange={handleFilterChange}
                >
                  <option value="">All</option>
                  {uniqueModalities.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </th>
              <th>
                <div className="th-title">Gender</div>
                <select
                  name="gender"
                  className="header-filter"
                  value={filters.gender}
                  onChange={handleFilterChange}
                >
                  <option value="">All</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </th>
              <th>Age</th>
              <th>Action</th>
            </tr>
          </thead>

          <StudiesTable
            studies={pagedStudies}
            filters={filters}
            mode="report"
            navigate={navigate}
            currentPage={currentPage}
  rowsPerPage={rowsPerPage}
          />
        </table>
      </div>

      {/* PAGINATION */}
      {filteredStudies.length > rowsPerPage && (
        <div className="pagination-corner">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            ◀ Prev
          </button>
          <span className="page-number">
            Page {currentPage} / {Math.ceil(filteredStudies.length / rowsPerPage)}
          </span>
          <button
            disabled={currentPage === Math.ceil(filteredStudies.length / rowsPerPage)}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            Next ▶
          </button>
        </div>
      )}
    </MainLayout>
  );
}
