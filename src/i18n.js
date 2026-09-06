import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      welcome: "Welcome to iPACX Healthcare Portal",
      myReports: "My Medical Reports",
      studyDate: "Study Date",
      modality: "Modality",
      status: "Status",
      viewReport: "View Diagnostic Report",
      downloadPdf: "Download Signed PDF",
      logout: "Log Out",
    },
  },
  es: {
    translation: {
      welcome: "Bienvenido al Portal Médico iPACX",
      myReports: "Mis Informes Médicos",
      studyDate: "Fecha del Estudio",
      modality: "Modalidad",
      status: "Estado",
      viewReport: "Ver Informe Diagnóstico",
      downloadPdf: "Descargar PDF Firmado",
      logout: "Cerrar Sesión",
    },
  },
  fr: {
    translation: {
      welcome: "Bienvenue sur le Portail Médical iPACX",
      myReports: "Mes Rapports Médicaux",
      studyDate: "Date de l'Examen",
      modality: "Modalité",
      status: "Statut",
      viewReport: "Voir le Rapport Diagnostic",
      downloadPdf: "Télécharger le PDF Signé",
      logout: "Déconnexion",
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
