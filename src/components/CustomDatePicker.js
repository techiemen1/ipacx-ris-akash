import React, { useState, useRef, useEffect } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import "./CustomDatePicker.css";

export default function CustomDatePicker({ filters, setFilters, label = "Select Date" }) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef(null);

  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return "";
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${day}/${month}/${year}`;
  };

  const parseDICOMDate = (dateStr) => {
    if (!dateStr) return null;
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1;
    const day = parseInt(dateStr.substring(6, 8));
    return new Date(year, month, day);
  };

  const formatInternalDate = (d) => {
    if (!d) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  };

  // Convert filters to Date objects
  const startDate = parseDICOMDate(filters.startDate);
  const endDate = parseDICOMDate(filters.endDate);

  // Shortcut buttons
  const applyDateFilter = (type) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let start = new Date(today);
    const end = new Date(today);

    switch (type) {
      case "today": break;
      case "yesterday":
        start.setDate(today.getDate() - 1);
        end.setDate(today.getDate() - 1);
        break;
      case "this_week":
        start.setDate(today.getDate() - today.getDay() + 1);
        break;
      case "this_month":
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case "last_6":
        start.setMonth(today.getMonth() - 6);
        break;
      case "last_12":
        start.setFullYear(today.getFullYear() - 1);
        break;
      default: break;
    }

    setFilters({
      startDate: formatInternalDate(start),
      endDate: formatInternalDate(end),
    });
    setShowDatePicker(false);
  };

  // Handle manual calendar selection
  const handleCalendarChange = (dates) => {
    const [start, end] = dates;
    setFilters({
      startDate: start ? formatInternalDate(start) : "",
      endDate: end ? formatInternalDate(end) : "",
    });
  };

  // Outside click closes calendar
  useEffect(() => {
    function handleClickOutside(event) {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target)) {
        setShowDatePicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Display logic: single date if start === end
  const displayDate =
    filters.startDate && filters.endDate
      ? filters.startDate === filters.endDate
        ? formatDisplayDate(filters.startDate)
        : `${formatDisplayDate(filters.startDate)} - ${formatDisplayDate(filters.endDate)}`
      : "";

  return (
    <div className="date-header-cell" ref={datePickerRef}>
      {label && <div className="th-title">{label}</div>}
      <div className="date-trigger-input" onClick={() => setShowDatePicker(!showDatePicker)}>
        {displayDate || "Select Date 📅"}
      </div>

      {showDatePicker && (
        <div className="orthanc-style-picker">
          {/* SHORTCUTS */}
          <div className="picker-sidebar">
            <div className="shortcut-item" onClick={() => applyDateFilter("today")}>Today</div>
            <div className="shortcut-item" onClick={() => applyDateFilter("yesterday")}>Yesterday</div>
            <div className="shortcut-item" onClick={() => applyDateFilter("this_week")}>This week</div>
            <div className="shortcut-item" onClick={() => applyDateFilter("this_month")}>This month</div>
            <div className="shortcut-item" onClick={() => applyDateFilter("last_6")}>Last 6 months</div>
            <div className="shortcut-item" onClick={() => applyDateFilter("last_12")}>Last 12 months</div>
          </div>

          {/* CALENDAR */}
          <div className="picker-main">
            <div className="picker-header">{label}</div>
            <DatePicker
              selected={startDate}
              onChange={handleCalendarChange}
              startDate={startDate}
              endDate={endDate}
              selectsRange
              inline
              calendarStartDay={1}
            />

            <div className="picker-footer">
              <button className="cancel-btn" onClick={() => setFilters({ startDate: "", endDate: "" })}>Clear</button>
              <button className="select-btn" onClick={() => setShowDatePicker(false)}>Select</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
