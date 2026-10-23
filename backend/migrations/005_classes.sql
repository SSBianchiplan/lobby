-- Padel Lobby — aulas e alunos: professores, turmas recorrentes, aulas (sessões), matrículas, chamada e mensalidades.
--
-- Invariantes no banco:
--   * aula e reserva nunca ocupam a mesma quadra ao mesmo tempo (nos dois sentidos), nem aula sobre bloqueio;
--     as verificações cruzadas tomam um advisory lock por quadra, então requisições simultâneas não furam a regra;
--   * duas aulas não se sobrepõem na mesma quadra (EXCLUDE);
--   * turma não passa da capacidade (trigger com lock na turma);
--   * uma mensalidade por aluno, turma e mês; todo pagamento é de uma reserva OU de uma mensalidade.

CREATE TABLE coaches (
    id         bigserial PRIMARY KEY,
    name       text    NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
    phone      text    CHECK (length(phone) <= 30),
    email      text    CHECK (length(email) <= 120),
    color      text    NOT NULL DEFAULT '#7C3AED' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    active     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE class_groups (
    id                  bigserial PRIMARY KEY,
    name                text       NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
    coach_id            bigint     NOT NULL REFERENCES coaches(id),
    court_id            smallint   NOT NULL REFERENCES courts(id),
    weekdays            smallint[] NOT NULL CHECK (cardinality(weekdays) > 0 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
    starts              time       NOT NULL,
    duration_min        smallint   NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 30 AND 180 AND duration_min % 30 = 0),
    level               text       CHECK (level IN ('iniciante', '6', '5', '4', '3', '2', '1')),
    capacity            smallint   NOT NULL DEFAULT 4 CHECK (capacity BETWEEN 1 AND 12),
    monthly_price_cents integer    NOT NULL DEFAULT 0 CHECK (monthly_price_cents >= 0),
    dropin_price_cents  integer    NOT NULL DEFAULT 0 CHECK (dropin_price_cents >= 0),
    starts_on           date       NOT NULL DEFAULT current_date,
    ends_on             date       CHECK (ends_on IS NULL OR ends_on >= starts_on),
    active              boolean    NOT NULL DEFAULT true,
    notes               text       CHECK (length(notes) <= 500),
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE class_sessions (
    id         bigserial PRIMARY KEY,
    group_id   bigint      REFERENCES class_groups(id) ON DELETE CASCADE,   -- NULL = aula particular/avulsa
    coach_id   bigint      NOT NULL REFERENCES coaches(id),
    court_id   smallint    NOT NULL REFERENCES courts(id),
    period     tstzrange   NOT NULL CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period)),
    title      text        CHECK (length(title) <= 80),
    status     text        NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled')),
    cancel_reason text     CHECK (length(cancel_reason) <= 200),
    started_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT class_sessions_no_overlap EXCLUDE USING gist (court_id WITH =, period WITH &&) WHERE (status <> 'cancelled')
);
CREATE UNIQUE INDEX class_sessions_group_period ON class_sessions (group_id, lower(period)) WHERE group_id IS NOT NULL;
CREATE INDEX class_sessions_start_idx ON class_sessions (lower(period));

CREATE TABLE enrollments (
    id         bigserial PRIMARY KEY,
    group_id   bigint NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
    user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     text   NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
    started_on date   NOT NULL DEFAULT current_date,
    ended_on   date,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX enrollments_one_open ON enrollments (group_id, user_id) WHERE status <> 'cancelled';

CREATE TABLE attendance (
    id          bigserial PRIMARY KEY,
    session_id  bigint NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      text   NOT NULL CHECK (status IN ('present', 'absent', 'justified')),
    dropin      boolean NOT NULL DEFAULT false,      -- aluno avulso nessa aula (não matriculado)
    checked_in_at timestamptz,
    marked_by   bigint REFERENCES users(id),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, user_id)
);

CREATE TABLE student_charges (
    id           bigserial PRIMARY KEY,
    user_id      bigint  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id     bigint  REFERENCES class_groups(id) ON DELETE SET NULL,
    kind         text    NOT NULL DEFAULT 'monthly' CHECK (kind IN ('monthly', 'dropin', 'private')),
    month        date    CHECK (month IS NULL OR extract(day FROM month) = 1),
    session_id   bigint  REFERENCES class_sessions(id) ON DELETE SET NULL,
    description  text    NOT NULL CHECK (length(description) <= 120),
    amount_cents integer NOT NULL CHECK (amount_cents >= 0),
    status       text    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (kind <> 'monthly' OR month IS NOT NULL)
);
CREATE UNIQUE INDEX student_charges_one_month ON student_charges (user_id, group_id, month) WHERE kind = 'monthly' AND status <> 'cancelled';

-- Pagamentos passam a poder ser de mensalidade: entram no mesmo caixa (fechamento diário).
ALTER TABLE payments ALTER COLUMN reservation_id DROP NOT NULL;
ALTER TABLE payments ADD COLUMN charge_id bigint REFERENCES student_charges(id) ON DELETE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_one_owner CHECK (num_nonnulls(reservation_id, charge_id) = 1);

-- QR pessoal do aluno (check-in na aula pelo leitor da recepção).
ALTER TABLE users ADD COLUMN checkin_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX users_checkin_token ON users (checkin_token);

-- ── Quadra: aula × reserva × bloqueio ──────────────────────────────────────

CREATE FUNCTION court_lock(c smallint) RETURNS void LANGUAGE sql AS $$
    SELECT pg_advisory_xact_lock(hashtext('court'), c)
$$;

-- Reserva: além de bloqueio, não pode cair sobre aula.
CREATE OR REPLACE FUNCTION reservations_check_blocks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IN ('pending', 'confirmed') THEN
        PERFORM court_lock(NEW.court_id);
        IF EXISTS (SELECT 1 FROM blocks b
                   WHERE (b.court_id IS NULL OR b.court_id = NEW.court_id) AND b.period && NEW.period) THEN
            RAISE EXCEPTION 'horário bloqueado' USING ERRCODE = '23P01', CONSTRAINT = 'reservations_blocked';
        END IF;
        IF EXISTS (SELECT 1 FROM class_sessions s
                   WHERE s.court_id = NEW.court_id AND s.status <> 'cancelled' AND s.period && NEW.period) THEN
            RAISE EXCEPTION 'horário de aula' USING ERRCODE = '23P01', CONSTRAINT = 'reservations_class';
        END IF;
    END IF;
    RETURN NEW;
END $$;

-- Aula: não pode cair sobre reserva ativa nem sobre bloqueio.
CREATE FUNCTION class_sessions_check_court() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'cancelled' THEN
        PERFORM court_lock(NEW.court_id);
        IF EXISTS (SELECT 1 FROM reservations r
                   WHERE r.court_id = NEW.court_id AND r.period && NEW.period
                     AND r.status IN ('pending', 'confirmed', 'checked_in', 'completed')
                     AND NOT (r.status = 'pending' AND r.hold_expires_at < now())) THEN
            RAISE EXCEPTION 'quadra reservada nesse horário' USING ERRCODE = '23P01', CONSTRAINT = 'class_sessions_reserved';
        END IF;
        IF EXISTS (SELECT 1 FROM blocks b
                   WHERE (b.court_id IS NULL OR b.court_id = NEW.court_id) AND b.period && NEW.period) THEN
            RAISE EXCEPTION 'horário bloqueado' USING ERRCODE = '23P01', CONSTRAINT = 'class_sessions_blocked';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER class_sessions_check_court BEFORE INSERT OR UPDATE OF period, court_id, status ON class_sessions
    FOR EACH ROW EXECUTE FUNCTION class_sessions_check_court();

-- Capacidade da turma.
CREATE FUNCTION enrollments_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    cap int;
BEGIN
    IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
        SELECT capacity INTO cap FROM class_groups WHERE id = NEW.group_id FOR UPDATE;
        IF (SELECT count(*) FROM enrollments WHERE group_id = NEW.group_id AND status = 'active' AND id <> NEW.id) >= cap THEN
            RAISE EXCEPTION 'turma cheia (% alunos)', cap USING ERRCODE = '23514', CONSTRAINT = 'enrollments_capacity';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER enrollments_capacity BEFORE INSERT OR UPDATE OF status ON enrollments
    FOR EACH ROW EXECUTE FUNCTION enrollments_capacity();
