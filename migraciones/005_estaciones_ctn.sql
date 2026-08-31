-- Remates de la ORDEN 1: código CTN y razón social por estación.
-- Los nombres comerciales existentes se siguen mostrando al público.
-- "Km 12.9 Corredor Comercial" es la estación llamada "Campo" en las órdenes.

ALTER TABLE estaciones ADD COLUMN codigo_ctn VARCHAR(20) NULL;
ALTER TABLE estaciones ADD COLUMN razon_social VARCHAR(150) NULL;

UPDATE estaciones SET codigo_ctn = 'E06874', razon_social = 'Servicio Gasolinero del Campo, S.A. de C.V.'
  WHERE nombre = 'Km 12.9 Corredor Comercial';
UPDATE estaciones SET codigo_ctn = 'E01369', razon_social = 'Estación de Servicio Feres, S.A. de C.V.'
  WHERE nombre = 'Rubio';
UPDATE estaciones SET codigo_ctn = NULL, razon_social = 'Estación de Servicio Feres, S.A. de C.V.'
  WHERE nombre = 'Oasis';

-- Reversa (documentada):
--   ALTER TABLE estaciones DROP COLUMN razon_social;
--   ALTER TABLE estaciones DROP COLUMN codigo_ctn;
