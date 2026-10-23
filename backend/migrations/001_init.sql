-- Padel Lobby — schema inicial.
-- Invariantes críticas vivem no banco: sem sobreposição de reservas por quadra
-- (EXCLUDE gist), sem reserva sobre bloqueio de manutenção, máximo de jogadores
-- e transições de status válidas (triggers).

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id            bigserial PRIMARY KEY,
    name          text        NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
    email         citext      NOT NULL UNIQUE,
    phone         text,
    password_hash text        NOT NULL,
    role          text        NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE courts (
    id          smallserial PRIMARY KEY,
    number      smallint NOT NULL UNIQUE,
    name        text     NOT NULL,
    description text     NOT NULL DEFAULT 'coberta',
    surface     text     NOT NULL DEFAULT 'sintético',
    active      boolean  NOT NULL DEFAULT true
);

-- weekday: ISO 1 = segunda … 7 = domingo. Vários intervalos por dia (ex.: pausa 13–14h).
CREATE TABLE business_hours (
    id      serial PRIMARY KEY,
    weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    opens   time     NOT NULL,
    closes  time     NOT NULL,
    CHECK (closes > opens)
);

CREATE TABLE holidays (
    day  date    PRIMARY KEY,
    name text    NOT NULL,
    open boolean NOT NULL DEFAULT true,
    -- quando aberto num feriado, horário especial (null = usa o de sábado)
    opens  time,
    closes time
);

-- Preço por hora, avaliado em fatias de 30 min; vence a regra de maior prioridade.
CREATE TABLE price_rules (
    id              serial PRIMARY KEY,
    label           text       NOT NULL,
    weekdays        smallint[] NOT NULL DEFAULT '{}',
    holidays        boolean    NOT NULL DEFAULT false,
    starts          time       NOT NULL DEFAULT '00:00',
    ends            time       NOT NULL DEFAULT '23:59:59',
    cents_per_hour  integer    NOT NULL CHECK (cents_per_hour > 0),
    priority        integer    NOT NULL DEFAULT 0,
    is_promo        boolean    NOT NULL DEFAULT false,
    CHECK (ends > starts)
);

CREATE TABLE settings (
    key   text  PRIMARY KEY,
    value jsonb NOT NULL
);

CREATE TABLE reservations (
    id              bigserial PRIMARY KEY,
    code            text        NOT NULL UNIQUE,
    court_id        smallint    NOT NULL REFERENCES courts(id),
    user_id         bigint      NOT NULL REFERENCES users(id),
    period          tstzrange   NOT NULL CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period)),
    duration_min    smallint    NOT NULL CHECK (duration_min IN (60, 90, 120)),
    status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'expired')),
    payment_method  text        NOT NULL CHECK (payment_method IN ('pix', 'card', 'onsite')),
    payment_status  text        NOT NULL DEFAULT 'pending'
                    CHECK (payment_status IN ('pending', 'paid', 'onsite', 'refunded', 'void')),
    price_cents     integer     NOT NULL CHECK (price_cents >= 0),
    hold_expires_at timestamptz,
    invite_token    uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    reminder_sent   boolean     NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    cancelled_at    timestamptz,
    cancel_reason   text,
    checked_in_at   timestamptz,
    CHECK (upper(period) - lower(period) = make_interval(mins => duration_min)),
    CONSTRAINT reservations_no_overlap EXCLUDE USING gist (court_id WITH =, period WITH &&)
        WHERE (status IN ('pending', 'confirmed', 'checked_in', 'completed'))
);
CREATE INDEX reservations_user_idx   ON reservations (user_id, lower(period) DESC);
CREATE INDEX reservations_start_idx  ON reservations (lower(period));
CREATE INDEX reservations_status_idx ON reservations (status) WHERE status IN ('pending', 'confirmed', 'checked_in');

-- Bloqueios (manutenção, evento). court_id NULL = todas as quadras.
CREATE TABLE blocks (
    id         bigserial PRIMARY KEY,
    court_id   smallint    REFERENCES courts(id),
    period     tstzrange   NOT NULL CHECK (NOT isempty(period)),
    reason     text        NOT NULL,
    created_by bigint      REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blocks_period_idx ON blocks USING gist (period);

CREATE TABLE reservation_players (
    id             bigserial PRIMARY KEY,
    reservation_id bigint      NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    user_id        bigint      REFERENCES users(id),
    name           text        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    is_owner       boolean     NOT NULL DEFAULT false,
    joined_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (reservation_id, user_id)
);

CREATE TABLE payments (
    id             bigserial PRIMARY KEY,
    reservation_id bigint      NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    method         text        NOT NULL CHECK (method IN ('pix', 'card', 'onsite')),
    amount_cents   integer     NOT NULL CHECK (amount_cents >= 0),
    status         text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded', 'void')),
    txid           text        UNIQUE,
    pix_payload    text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    paid_at        timestamptz
);

CREATE TABLE notifications (
    id         bigserial PRIMARY KEY,
    user_id    bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       text        NOT NULL,
    title      text        NOT NULL,
    body       text        NOT NULL DEFAULT '',
    link       text,
    read_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE reservation_events (
    id             bigserial PRIMARY KEY,
    reservation_id bigint      NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    at             timestamptz NOT NULL DEFAULT now(),
    event          text        NOT NULL,
    data           jsonb       NOT NULL DEFAULT '{}'
);

-- ── Triggers ────────────────────────────────────────────────────────────────

-- Reserva não pode cair sobre bloqueio.
CREATE FUNCTION reservations_check_blocks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IN ('pending', 'confirmed') AND EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.court_id IS NULL OR b.court_id = NEW.court_id) AND b.period && NEW.period
    ) THEN
        RAISE EXCEPTION 'horário bloqueado' USING ERRCODE = '23P01', CONSTRAINT = 'reservations_blocked';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER reservations_check_blocks BEFORE INSERT OR UPDATE OF period, court_id ON reservations
    FOR EACH ROW EXECUTE FUNCTION reservations_check_blocks();

-- Máquina de estados: estados finais não voltam atrás.
CREATE FUNCTION reservations_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'pending'    AND NEW.status IN ('confirmed', 'cancelled', 'expired')) OR
            (OLD.status = 'confirmed'  AND NEW.status IN ('checked_in', 'completed', 'cancelled')) OR
            (OLD.status = 'checked_in' AND NEW.status IN ('completed'))
        ) THEN
            RAISE EXCEPTION 'transição de status inválida: % -> %', OLD.status, NEW.status
                USING ERRCODE = '23514', CONSTRAINT = 'reservations_status_transition';
        END IF;
        INSERT INTO reservation_events (reservation_id, event, data)
        VALUES (NEW.id, 'status', jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
        INSERT INTO reservation_events (reservation_id, event, data)
        VALUES (NEW.id, 'payment', jsonb_build_object('from', OLD.payment_status, 'to', NEW.payment_status));
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER reservations_status_guard BEFORE UPDATE ON reservations
    FOR EACH ROW EXECUTE FUNCTION reservations_status_guard();

CREATE FUNCTION reservations_created_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO reservation_events (reservation_id, event, data)
    VALUES (NEW.id, 'created', jsonb_build_object('status', NEW.status, 'price_cents', NEW.price_cents));
    RETURN NEW;
END $$;
CREATE TRIGGER reservations_created_event AFTER INSERT ON reservations
    FOR EACH ROW EXECUTE FUNCTION reservations_created_event();

-- Máximo de jogadores por reserva (lido de settings, padrão 4).
CREATE FUNCTION reservation_players_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    max_players int := coalesce((SELECT (value)::text::int FROM settings WHERE key = 'max_players'), 4);
BEGIN
    PERFORM 1 FROM reservations WHERE id = NEW.reservation_id FOR UPDATE;
    IF (SELECT count(*) FROM reservation_players WHERE reservation_id = NEW.reservation_id) >= max_players THEN
        RAISE EXCEPTION 'reserva já tem % jogadores', max_players
            USING ERRCODE = '23514', CONSTRAINT = 'reservation_players_limit';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER reservation_players_limit BEFORE INSERT ON reservation_players
    FOR EACH ROW EXECUTE FUNCTION reservation_players_limit();
