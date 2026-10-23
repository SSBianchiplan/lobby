-- Padel Lobby — inativar usuários pela administração (reversível; histórico preservado).
ALTER TABLE users ADD COLUMN disabled_at timestamptz;
ALTER TABLE users ADD COLUMN disabled_by bigint REFERENCES users(id) ON DELETE SET NULL;
