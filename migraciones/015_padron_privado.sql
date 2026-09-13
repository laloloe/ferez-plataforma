-- ORDEN 14: padrón privado — depósito notarial en el sellado.

-- Datos del depósito ante notario, capturados al momento de sellar
-- (opcionales en simulacros). El acta PDF asienta el renglón siempre.
ALTER TABLE sellos ADD COLUMN notario VARCHAR(150) NULL;
ALTER TABLE sellos ADD COLUMN acta_notarial VARCHAR(100) NULL COMMENT 'Número de acta / fe de hechos';

-- Reversa (documentada):
--   ALTER TABLE sellos DROP COLUMN acta_notarial; DROP COLUMN notario;
