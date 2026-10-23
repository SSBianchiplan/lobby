-- Padel Lobby — foto de cada quadra (arquivos em frontend/public/quadras, servidos pelo app).
ALTER TABLE courts ADD COLUMN photo text CHECK (photo ~ '^/quadras/[a-z0-9-]+\.webp$');

-- Distribuição inicial (trocável em Admin › Configurações › Fotos das quadras).
UPDATE courts SET photo = CASE number
    WHEN 1 THEN '/quadras/quadra-vidro-1600.webp'
    WHEN 2 THEN '/quadras/quadra-fundo-1600.webp'
    WHEN 3 THEN '/quadras/quadra-lateral-1600.webp'
END WHERE photo IS NULL;
