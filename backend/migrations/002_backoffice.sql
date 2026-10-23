-- Padel Lobby — retaguarda: canal de recebimento, autoria, estorno e fechamento diário de caixa.
--
-- Invariante no banco: depois que o caixa de um dia é fechado, nenhum recebimento
-- manual (lançado no balcão, received_by preenchido) entra, sai ou muda naquele dia.
-- Pagamentos online (webhook Pix, cartão) nunca são barrados — o dinheiro já entrou;
-- eles aparecem no fechamento como "movimento após o fechamento".

ALTER TABLE payments
    ADD COLUMN channel      text CHECK (channel IN ('pix_online', 'cartao_online', 'dinheiro', 'pix_balcao', 'debito', 'credito')),
    ADD COLUMN received_by  bigint REFERENCES users(id),
    ADD COLUMN refunded_at  timestamptz,
    ADD COLUMN note         text CHECK (length(note) <= 200);

UPDATE payments SET channel = CASE method WHEN 'pix' THEN 'pix_online' WHEN 'card' THEN 'cartao_online' ELSE 'dinheiro' END;
UPDATE payments p SET refunded_at = r.cancelled_at
FROM reservations r WHERE r.id = p.reservation_id AND p.status = 'refunded' AND p.refunded_at IS NULL;

-- Reservas pagas sem lançamento (dados antigos/demo): reconstitui o pagamento para o caixa fechar.
INSERT INTO payments (reservation_id, method, amount_cents, status, paid_at, refunded_at, channel)
SELECT r.id, r.payment_method, r.price_cents,
       CASE r.payment_status WHEN 'refunded' THEN 'refunded' ELSE 'paid' END,
       least(r.created_at, lower(r.period)),
       CASE WHEN r.payment_status = 'refunded' THEN r.cancelled_at END,
       CASE r.payment_method WHEN 'pix' THEN 'pix_online' WHEN 'card' THEN 'cartao_online' ELSE 'dinheiro' END
FROM reservations r
WHERE r.payment_status IN ('paid', 'refunded')
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.reservation_id = r.id AND p.status IN ('paid', 'refunded'));

ALTER TABLE payments ALTER COLUMN channel SET NOT NULL;
CREATE INDEX payments_paid_at_idx ON payments (paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX payments_refunded_at_idx ON payments (refunded_at) WHERE refunded_at IS NOT NULL;

CREATE TABLE daily_closings (
    day                  date        PRIMARY KEY,
    -- valores congelados no momento do fechamento (centavos)
    received_cents       integer     NOT NULL,
    refunded_cents       integer     NOT NULL,
    cash_expected_cents  integer     NOT NULL,
    cash_counted_cents   integer     NOT NULL CHECK (cash_counted_cents >= 0),
    snapshot             jsonb       NOT NULL,
    note                 text        CHECK (length(note) <= 500),
    closed_by            bigint      NOT NULL REFERENCES users(id),
    closed_at            timestamptz NOT NULL DEFAULT now(),
    -- reabertura: o caixa volta a aceitar lançamentos; o histórico fica em history
    reopened_at          timestamptz,
    reopened_by          bigint      REFERENCES users(id),
    history              jsonb       NOT NULL DEFAULT '[]'
);

CREATE FUNCTION closing_is_locked(d date) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM daily_closings WHERE day = d AND reopened_at IS NULL)
$$;

-- O dia de um lançamento é o do fuso da sessão (a API conecta com o fuso do clube).
CREATE FUNCTION payments_closing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    d date;
BEGIN
    -- só lançamentos de balcão são travados
    IF TG_OP = 'INSERT' THEN
        IF NEW.received_by IS NOT NULL AND NEW.paid_at IS NOT NULL THEN
            d := NEW.paid_at::date;
        END IF;
    ELSIF OLD.received_by IS NOT NULL AND OLD.paid_at IS NOT NULL AND (
          NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR NEW.channel IS DISTINCT FROM OLD.channel
          OR NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.received_by IS DISTINCT FROM OLD.received_by) THEN
        d := OLD.paid_at::date;
    ELSIF NEW.received_by IS NOT NULL AND NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL THEN
        d := NEW.paid_at::date;
    END IF;
    IF d IS NOT NULL AND closing_is_locked(d) THEN
        RAISE EXCEPTION 'caixa de % está fechado', to_char(d, 'DD/MM/YYYY')
            USING ERRCODE = '23514', CONSTRAINT = 'payments_closed_day';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER payments_closing_guard BEFORE INSERT OR UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION payments_closing_guard();
