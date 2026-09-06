-- Master Data for iPacx RIS modalities
INSERT INTO modalities (code, name) VALUES 
('CR', 'Computed Radiography'),
('CT', 'Computed Tomography'),
('MR', 'Magnetic Resonance'),
('US', 'Ultrasound'),
('DX', 'Digital Radiography'),
('MG', 'Mammography'),
('XA', 'X-Ray Angiography')
ON CONFLICT (code) DO NOTHING;

-- Basic Body Parts for CR/DX
WITH cr_mod AS (SELECT id FROM modalities WHERE code = 'CR')
INSERT INTO body_parts (modality_id, name)
SELECT cr_mod.id, name FROM cr_mod, (VALUES ('Chest'), ('Skull'), ('Knee'), ('Spine')) AS bp(name)
ON CONFLICT DO NOTHING;

-- Basic Body Parts for US
WITH us_mod AS (SELECT id FROM modalities WHERE code = 'US')
INSERT INTO body_parts (modality_id, name)
SELECT us_mod.id, name FROM us_mod, (VALUES ('Abdomen'), ('Pelvis'), ('Obstetrics'), ('Small Parts')) AS bp(name)
ON CONFLICT DO NOTHING;
