-- Migration: 008_enhance_key_images_enterprise.sql
-- Enhances public.study_key_images table for Enterprise DICOM Key Image Workflow

ALTER TABLE public.study_key_images
  ADD COLUMN IF NOT EXISTS report_id INTEGER REFERENCES public.reports(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS patient_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS sop_class_uid VARCHAR(128),
  ADD COLUMN IF NOT EXISTS modality VARCHAR(16) DEFAULT 'CT',
  ADD COLUMN IF NOT EXISTS series_number INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS instance_number INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS study_date VARCHAR(32),
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
  
  -- Viewport Presentation State Metrics
  ADD COLUMN IF NOT EXISTS window_center NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS window_width NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS zoom NUMERIC(10, 4) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS pan_x NUMERIC(10, 2) DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS pan_y NUMERIC(10, 2) DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS rotation INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flip_horizontal BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flip_vertical BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS viewport_type VARCHAR(32) DEFAULT 'STACK',
  ADD COLUMN IF NOT EXISTS frame_number INTEGER DEFAULT 1,

  -- Cornerstone / OHIF Annotation & Measurement Objects
  ADD COLUMN IF NOT EXISTS annotation_data JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS measurement_data JSONB DEFAULT '{}'::jsonb,
  
  -- Audit / Authoring Metadata
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL;

-- Performance & Query Indexes
CREATE INDEX IF NOT EXISTS idx_study_key_images_report_id ON public.study_key_images(report_id);
CREATE INDEX IF NOT EXISTS idx_study_key_images_sop_uid ON public.study_key_images(sop_instance_uid);
CREATE INDEX IF NOT EXISTS idx_study_key_images_series_uid ON public.study_key_images(series_uid);
CREATE INDEX IF NOT EXISTS idx_study_key_images_display_order ON public.study_key_images(report_id, display_order ASC);
