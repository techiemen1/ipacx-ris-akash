# iPACX Enterprise RIS 1.1 - Next-Gen Revamp & Implementation Plan

## 📌 Executive Summary
This updated revamp plan incorporates **Next-Gen Enterprise RIS/PACS Capabilities**, drawing inspiration from leading radiology software standards (Sectra RIS, Visage 7, Ambra Health). It adds **AI-Powered Reporting & Auto-Templating**, **Multi-Hospital & Multi-PACS Federated Routing**, **DICOMweb Standards**, and **Dynamic Multi-Clinic PDF Generation**.

---

## 1. Core Feature Matrix

| Enterprise Feature | Priority | Description | Key Components |
|---|---|---|---|
| **🤖 AI Reporting & Auto-Fill** | High | DICOM measurement extraction, auto-template matching, AI impression generator | `aiReportingService.js`, `aiReporting.js`, `AIReportingToolbar.jsx` |
| **🏢 Multi-Hospital & Clinic Routing** | High | 2-tier tenancy (Hospitals -> Clinics), tenant-scoped queries, referring doctor portal | `tenantAuth.js`, `hospitals.js`, `clinics.js`, `DoctorPortal.jsx` |
| **🛰️ Multi-PACS Federation** | High | Federated queries across Orthanc / DCM4CHEE nodes, C-STORE real-time webhook, DICOMweb (QIDO/WADO/STOW) | `multiPacsRouter.js`, `dicomWebService.js`, `dicomWeb.js` |
| **📄 Dynamic PDF & QR Portal** | High | Dynamic clinic header/logo branding, TipTap rich HTML PDF parsing, digital verification QR code | `generateFinalReportPDF.js`, `publicReportSheet.js` |
| **⚡ Real-Time Sockets** | Medium | Live worklist and reporting status updates across radiologists & techs | `socketService.js` |

---

## 2. Technical Implementation Roadmap

### Phase 1: Database Schema Expansion & Multi-Tenancy
- Seed `hospitals`, `clinics`, `referring_doctors` tables.
- Add `hospital_id` and `clinic_id` columns to `users`, `patients`, `studies`, `reports`, `invoices`, `mwl`, `pacs`.
- Backfill existing data to default Hospital & Clinic for 100% backward compatibility.
- Implement `tenantAuth.js` middleware for automatic query scoping.

### Phase 2: Multi-PACS Federation & DICOMweb Proxy
- Implement `multiPacsRouter.js` to search and aggregate studies across multiple active PACS nodes in parallel.
- Implement `dicomWebService.js` for QIDO-RS, WADO-RS, and STOW-RS endpoints.
- Add C-STORE ingestion webhook (`/api/pacs/webhook/c-store`).

### Phase 3: AI-Powered Reporting & Auto-Templating
- Build `aiReportingService.js` supporting:
  - Smart Template Matcher (matches DICOM Modality/BodyPart/Description to template).
  - DICOM SR Measurement Auto-Fill (Populates Ultrasound fetal biometry & CT parameters directly into report findings).
  - AI Impression Generator (synthesizes structured findings into concise impressions).
- Create `AIReportingToolbar.jsx` component for radiologist workspace.

### Phase 4: Dynamic PDF Generator & Verification Portal
- Refactor `generateFinalReportPDF.js` with dynamic hospital/clinic branding, logo embedding, and TipTap HTML parsing.
- Generate digital verification QR code linking to `/secure-report-sheet?uid=...`.

---

## 3. Verification Checklist

- [ ] Execute multi-tenant database migration SQL script
- [ ] Test multi-tenant isolation across Hospital A and Hospital B users
- [ ] Test multi-PACS federated search across multiple Orthanc instances
- [ ] Test DICOM measurement auto-fill and AI Impression generation
- [ ] Test PDF generation with dynamic clinic logo and QR code verification link
