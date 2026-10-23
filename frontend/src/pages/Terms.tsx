import type { ReactNode } from "react";
import { BottomNav, MobileHeader, SiteFooter, SiteHeader } from "../components/Layout";
import { useClub } from "../hooks";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 22 }}>
      <h2 className="italic-title" style={{ fontSize: 19 }}>{title}</h2>
      <div style={{ marginTop: 8, fontSize: 14, fontWeight: 500, lineHeight: 1.6, color: "var(--ink)", display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </section>
  );
}

/** Termos de uso e política de privacidade — descreve o que o sistema realmente coleta e faz. */
export default function Terms() {
  const club = useClub().data;
  const name = club?.club_name ?? "Padel Lobby";
  return (
    <div className="has-bottom-nav">
      <SiteHeader />
      <MobileHeader title={<>Termos e <span className="accent">privacidade</span></>} />
      <main className="container page" style={{ maxWidth: 760 }}>
        <article className="card card-pad" style={{ boxShadow: "none" }}>
          <h1 className="italic-title hide-mobile" style={{ fontSize: 30 }}>Termos de uso e <span className="accent">privacidade</span></h1>
          <p className="muted" style={{ marginTop: 6, fontSize: 13, fontWeight: 600 }}>{name} · {club?.address} · {club?.district}</p>

          <Block title="1. O serviço">
            <p>Este site e aplicativo servem para reservar e pagar quadras do {name}, convidar jogadores e acompanhar suas reservas.
              As regras de horário, preço, cancelamento e estorno aparecem no momento da reserva e no seu perfil, em "Política de reserva".</p>
          </Block>
          <Block title="2. Sua conta">
            <p>Você é responsável pelos dados informados e pelo sigilo da sua senha. A conta é pessoal. Se esquecer a senha, a recepção
              gera uma senha temporária, que você troca no primeiro acesso.</p>
          </Block>
          <Block title="3. Dados que coletamos e por quê">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li><strong>Cadastro</strong>: nome, e-mail, WhatsApp (opcional) e senha (guardada só como hash). Para identificar você e falar sobre suas reservas.</li>
              <li><strong>Perfil de jogador</strong> (opcional): categoria, lado, mão dominante e cidade. Para organizar jogos e mostrar seu perfil.</li>
              <li><strong>Reservas e pagamentos</strong>: quadra, horário, jogadores convidados, forma e situação do pagamento. Para prestar o serviço e cumprir obrigações fiscais.</li>
              <li><strong>Registros técnicos</strong>: endereço IP e data dos acessos, para segurança e prevenção de fraude.</li>
            </ul>
            <p>Bases legais (LGPD, art. 7º): execução do contrato de locação, cumprimento de obrigação legal e legítimo interesse em segurança.
              Promoções por mensagem só com o seu consentimento, que você pode retirar no perfil.</p>
          </Block>
          <Block title="4. Compartilhamento">
            <p>Não vendemos seus dados. Eles são tratados pelo {name} e por fornecedores que operam o serviço (hospedagem e, quando houver,
              o processador de pagamentos). O link para o GPlanSiS|iaVision leva a outro site, com política própria; nenhum dado seu é enviado a ele por este sistema.</p>
          </Block>
          <Block title="5. Por quanto tempo">
            <p>Dados de conta ficam enquanto ela existir. Ao excluir a conta, nome, e-mail, telefone e perfil são apagados; reservas e pagamentos
              permanecem sem identificação pelo prazo exigido pela legislação fiscal e contábil.</p>
          </Block>
          <Block title="6. Seus direitos">
            <p>No seu perfil você pode corrigir dados, <strong>baixar uma cópia</strong> de tudo o que temos sobre você e <strong>excluir a conta</strong>.
              Para outros pedidos (LGPD, art. 18), fale com a gente{club?.email ? <> em <a href={`mailto:${club.email}`}>{club.email}</a></> : ""}.</p>
          </Block>
          <Block title="7. Segurança">
            <p>Conexão sempre cifrada (HTTPS), senhas com hash bcrypt, bloqueio temporário após tentativas de senha repetidas e encerramento
              de todas as sessões quando a senha é trocada.</p>
          </Block>
          <p className="muted" style={{ marginTop: 24, fontSize: 12, fontWeight: 600 }}>Última atualização: outubro de 2026.</p>
        </article>
      </main>
      <SiteFooter />
      <BottomNav />
    </div>
  );
}
