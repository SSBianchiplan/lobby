-- Padel Lobby — área do professor: login vinculado ao cadastro do professor e anotações da aula.
ALTER TABLE coaches ADD COLUMN user_id bigint UNIQUE REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE class_sessions ADD COLUMN notes text CHECK (length(notes) <= 2000);
