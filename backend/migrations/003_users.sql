-- Padel Lobby — módulo de usuário: perfil de jogador, termos (LGPD), segurança da sessão e exclusão de conta.

ALTER TABLE users
    ADD COLUMN city                 text        CHECK (length(city) <= 60),
    -- categoria de padel no Brasil: iniciante, 6ª (entrada) … 1ª (mais forte)
    ADD COLUMN level                text        CHECK (level IN ('iniciante', '6', '5', '4', '3', '2', '1')),
    ADD COLUMN side                 text        CHECK (side IN ('direita', 'esquerda', 'ambos')),
    ADD COLUMN hand                 text        CHECK (hand IN ('destro', 'canhoto')),
    ADD COLUMN marketing_opt_in     boolean     NOT NULL DEFAULT false,
    ADD COLUMN accepted_terms_at    timestamptz,
    -- senha temporária dada pela recepção: troca obrigatória no próximo acesso
    ADD COLUMN must_change_password boolean     NOT NULL DEFAULT false,
    -- vai no JWT; incrementar derruba todas as sessões (troca de senha, "sair de todos", exclusão)
    ADD COLUMN token_version        integer     NOT NULL DEFAULT 0,
    ADD COLUMN last_login_at        timestamptz,
    -- exclusão = anonimização: reservas e pagamentos ficam (caixa e relatórios), os dados pessoais não
    ADD COLUMN deleted_at           timestamptz,
    ADD COLUMN updated_at           timestamptz NOT NULL DEFAULT now();

-- Contas antigas aceitaram os termos ao se cadastrar no sistema anterior a esta coluna.
UPDATE users SET accepted_terms_at = created_at WHERE accepted_terms_at IS NULL;

ALTER TABLE users ADD CONSTRAINT users_deleted_anonymized
    CHECK (deleted_at IS NULL OR (phone IS NULL AND city IS NULL AND email::text LIKE 'excluido-%@invalid'));
