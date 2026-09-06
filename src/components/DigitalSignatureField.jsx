import { useState, useEffect } from "react";
import api from "../api/axios";
import { getSignatureUrl } from "../api/urls";


function DigitalSignatureField({ type, value, onSelect = () => {} }) {
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(value || null);

  useEffect(() => {
    if (!value || value === "null") {
      setData(null);
      return;
    }
    setData(value);
  }, [value]);

  const signedOnText = () => {
    const ts = data?.dateTime;
    if (!ts) return "";
    const dt = new Date(ts);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleString();
  };

  const handleKeyDown = async (e) => {
    if (e.key !== "Enter" || loading || !inputText.trim()) return;

    setLoading(true);
    try {
      const apiurl =
  type === "approved"
    ? `/api/users/approved-by/${encodeURIComponent(inputText.trim())}`
    : `/api/reported-by/by-name/${encodeURIComponent(inputText.trim())}`;


      const res = await api.get(apiurl);

      const {
        full_name,
        qualification,
        designation,
        registration_number,
        signature_url,
        dateTime
      } = res.data;

      if (!full_name) throw new Error("Invalid user");

      const payload = {
        full_name,
        qualification,
        designation,
        registration_number,
        signature_url,
        dateTime
      };

      setData(payload);
      onSelect(payload);
      setInputText("");
    } catch (err) {
      alert("User not found or inactive");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 4 }}>
      {!data && (
        <input
          type="text"
          placeholder={
            type === "approved"
              ? "Type USERNAME & press Enter"
              : "Type FULL NAME & press Enter"
          }
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          style={{ 
            width: 220, 
            padding: "4px 0", 
            fontSize: "11px", 
            border: "none", 
            borderBottom: "1px solid #e2e8f0", 
            outline: "none", 
            background: "transparent",
            color: "#64748b"
          }}
        />
      )}

      {data && (
        <div style={{ fontSize: 11, marginTop: 4 }}>
          {data.signature_url && (
  <img
    src={getSignatureUrl(data.signature_url)}
    alt=""   // IMPORTANT: no alt text
    style={{ maxWidth: 160, marginBottom: 4 }}
  />
)}


          <div>{data.full_name}</div>
          {data.qualification && <div>{data.qualification}</div>}
          {data.registration_number && <div>Reg No: {data.registration_number}</div>}
          {type === "approved" && data.designation && (
            <div>{data.designation}</div>
          )}

          {signedOnText() && <div>Signed on {signedOnText()}</div>}
        </div>
      )}
    </div>
  );
}

export default DigitalSignatureField;
