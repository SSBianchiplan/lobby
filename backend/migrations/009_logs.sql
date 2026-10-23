-- Padel Lobby — log de acessos (segurança) e log de visitantes do site (estatística anônima).
CREATE TABLE access_log (
    id         bigserial PRIMARY KEY,
    at         timestamptz NOT NULL DEFAULT now(),
    event      text        NOT NULL CHECK (event IN ('login_ok', 'login_fail', 'login_locked', 'login_inactive', 'register',
                                                     'password_change', 'logout_all', 'password_reset', 'account_disabled',
                                                     'account_enabled', 'account_deleted', 'user_created')),
    user_id    bigint      REFERENCES users(id) ON DELETE SET NULL,
    email      text        CHECK (length(email) <= 160),
    actor_id   bigint      REFERENCES users(id) ON DELETE SET NULL,   -- quem fez (ações da administração)
    ip         text        CHECK (length(ip) <= 64),
    user_agent text        CHECK (length(user_agent) <= 300)
);
CREATE INDEX access_log_at ON access_log (at DESC);
CREATE INDEX access_log_event ON access_log (event, at DESC);

-- Visitas: visitante = id aleatório do navegador (não é pessoa), IP truncado, caminhos sem tokens.
CREATE TABLE page_views (
    id        bigserial PRIMARY KEY,
    at        timestamptz NOT NULL DEFAULT now(),
    visitor   uuid        NOT NULL,
    session   uuid        NOT NULL,
    user_id   bigint      REFERENCES users(id) ON DELETE SET NULL,
    path      text        NOT NULL CHECK (length(path) <= 200),
    referrer  text        CHECK (length(referrer) <= 120),
    ip_prefix text        CHECK (length(ip_prefix) <= 64),
    device    text        NOT NULL DEFAULT 'desktop' CHECK (device IN ('mobile', 'tablet', 'desktop')),
    browser   text        CHECK (length(browser) <= 30),
    os        text        CHECK (length(os) <= 30),
    is_bot    boolean     NOT NULL DEFAULT false
);
CREATE INDEX page_views_at ON page_views (at DESC);
CREATE INDEX page_views_visitor ON page_views (visitor, at);
