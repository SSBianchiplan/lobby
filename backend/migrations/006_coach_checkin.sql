-- Padel Lobby — QR do professor: check-in na chegada inicia a aula do horário dele.
ALTER TABLE coaches ADD COLUMN checkin_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX coaches_checkin_token ON coaches (checkin_token);
ALTER TABLE class_sessions ADD COLUMN coach_checked_in_at timestamptz;
