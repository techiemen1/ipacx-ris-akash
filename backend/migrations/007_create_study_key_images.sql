-- Migration: 007_create_study_key_images.sql
-- Creates multi-tenant study_key_images table for RIS/PACS report key image storage

CREATE TABLE IF NOT EXISTS public.study_key_images (
  id SERIAL PRIMARY KEY,
  study_id INTEGER REFERENCES public.studies(id) ON DELETE CASCADE,
  study_uid VARCHAR(128) NOT NULL,
  series_uid VARCHAR(128),
  sop_instance_uid VARCHAR(128),
  instance_id VARCHAR(128),
  clinic_id INTEGER DEFAULT 1,
  slice_number INTEGER DEFAULT 1,
  total_slices INTEGER DEFAULT 1,
  series_description VARCHAR(255),
  caption TEXT,
  image_path TEXT NOT NULL,
  preview_url TEXT NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_study_key_images_study_uid ON public.study_key_images(study_uid);
CREATE INDEX IF NOT EXISTS idx_study_key_images_study_id ON public.study_key_images(study_id);
CREATE INDEX IF NOT EXISTS idx_study_key_images_clinic_id ON public.study_key_images(clinic_id);
