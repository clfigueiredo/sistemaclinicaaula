/**
 * Passo a passo (para leigo) de como configurar o envio pelo Resend: subdomínio de envio, DNS (DKIM, SPF,
 * DMARC), API key e teste de spam. Card colapsável; o estado aberto/fechado fica na memória do navegador.
 */
import { useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, ExternalLink, Lightbulb } from 'lucide-react';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { cn } from '@/lib/utils';

const CHAVE_ABERTO = 'admin.email.tutorialResend.aberto';

function lerAberto(padrao: boolean): boolean {
  try {
    const v = window.localStorage.getItem(CHAVE_ABERTO);
    return v === null ? padrao : v === '1';
  } catch {
    return padrao;
  }
}

function Codigo({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 text-xs break-all">{children}</code>;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline">
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

type Passo = { titulo: string; conteudo: ReactNode };

const PASSOS: Passo[] = [
  {
    titulo: 'Crie uma conta no Resend',
    conteudo: (
      <p>
        Acesse <Link href="https://resend.com">resend.com</Link> e crie a conta. O plano grátis permite{' '}
        <strong>3.000 e-mails por mês</strong> (até 100 por dia) — suficiente para começar.
      </p>
    ),
  },
  {
    titulo: 'Adicione um subdomínio só para envio',
    conteudo: (
      <>
        <p>
          No menu <strong>Domains</strong>, clique em <strong>Add Domain</strong> e use um <strong>subdomínio</strong>, por
          exemplo <Codigo>avisos.seudominio.com.br</Codigo>.
        </p>
        <p>
          Assim você não mexe no e-mail que a empresa já usa e protege a reputação do domínio principal. Na região, escolha a
          mais próxima (São Paulo, <Codigo>sa-east-1</Codigo>, se aparecer; senão <Codigo>us-east-1</Codigo>).
        </p>
      </>
    ),
  },
  {
    titulo: 'Copie os registros DNS para o provedor do domínio',
    conteudo: (
      <>
        <p>O Resend mostra alguns registros. Normalmente são:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            um <strong>TXT</strong> do DKIM com nome <Codigo>resend._domainkey.avisos</Codigo>;
          </li>
          <li>
            um <strong>MX</strong> e um <strong>TXT</strong> (SPF) com nome <Codigo>send.avisos</Codigo> (é o “MAIL FROM”).
          </li>
        </ul>
        <p>
          Copie cada um <strong>exatamente</strong> como aparece para o DNS de onde o domínio está registrado. Exemplo na
          Hostinger: hPanel → <strong>Domínios</strong> → <strong>DNS / Nameservers</strong> → <strong>Gerenciar registros DNS</strong>{' '}
          → <strong>Adicionar registro</strong>. No campo “Nome”, use só a parte antes do seu domínio (ex.:{' '}
          <Codigo>resend._domainkey.avisos</Codigo>).
        </p>
        <p className="text-amber-700 dark:text-amber-300">
          Não apague os registros SPF/MX que já existem no domínio principal — eles cuidam do e-mail da empresa.
        </p>
      </>
    ),
  },
  {
    titulo: 'Crie o DMARC (se ainda não existir)',
    conteudo: (
      <p>
        Se o domínio ainda não tem DMARC, adicione um registro <strong>TXT</strong> com nome <Codigo>_dmarc</Codigo> e valor{' '}
        <Codigo>v=DMARC1; p=none;</Codigo>. Depois de algumas semanas sem problemas, troque para <Codigo>p=quarantine</Codigo>.
      </p>
    ),
  },
  {
    titulo: 'Verifique o domínio',
    conteudo: (
      <p>
        Volte ao Resend e clique em <strong>Verify</strong>. A verificação pode levar de alguns minutos a algumas horas (é o
        tempo de o DNS se propagar). Espere aparecer <strong>Verified</strong>.
      </p>
    ),
  },
  {
    titulo: 'Gere a API key',
    conteudo: (
      <p>
        Em <strong>API Keys</strong> → <strong>Create API Key</strong>, escolha a permissão <strong>Sending access</strong>{' '}
        restrita ao seu domínio e copie a chave (começa com <Codigo>re_</Codigo>). Ela <strong>só aparece uma vez</strong>:
        guarde-a antes de fechar.
      </p>
    ),
  },
  {
    titulo: 'Preencha aqui no painel',
    conteudo: (
      <p>
        Clique em <strong>Preencher para o Resend</strong>, cole a API key no campo <strong>Senha / API key</strong>, use como
        remetente algo como <Codigo>nao-responda@avisos.seudominio.com.br</Codigo>, nome <strong>Sistema Clínica</strong> e, em{' '}
        <strong>Responder para</strong>, um e-mail de suporte que alguém realmente lê. <strong>Salve</strong> e clique em{' '}
        <strong>Enviar e-mail de teste</strong>.
      </p>
    ),
  },
  {
    titulo: 'Teste se cai no spam',
    conteudo: (
      <p>
        Abra <Link href="https://www.mail-tester.com">mail-tester.com</Link>, copie o endereço que ele mostra, envie o teste
        para esse endereço e clique em ver a nota. A meta é <strong>9/10 ou mais</strong>.
      </p>
    ),
  },
  {
    titulo: 'Ligue o envio',
    conteudo: (
      <p>
        Marque <strong>Envio ativo</strong> e salve. Enquanto estiver desligado, os e-mails não saem: ficam registrados como{' '}
        <strong>Ignorado</strong> na aba Envios.
      </p>
    ),
  },
];

export function TutorialResend({ abertoPorPadrao = true }: { abertoPorPadrao?: boolean }) {
  const [aberto, setAberto] = useState(() => lerAberto(abertoPorPadrao));

  function alternar() {
    setAberto((v) => {
      try {
        window.localStorage.setItem(CHAVE_ABERTO, v ? '0' : '1');
      } catch {
        /* armazenamento indisponível: só não lembra */
      }
      return !v;
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-4 text-muted-foreground" /> Como configurar com o Resend
            </CardTitle>
            <CardDescription>Passo a passo para os e-mails chegarem na caixa de entrada (e não no spam).</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={alternar} aria-expanded={aberto} aria-controls="tutorial-resend">
            {aberto ? 'Ocultar' : 'Mostrar'}
            <ChevronDown className={cn('transition-transform', aberto && 'rotate-180')} />
          </Button>
        </div>
      </CardHeader>
      {aberto && (
        <CardContent id="tutorial-resend" className="space-y-5">
          <ol className="space-y-4">
            {PASSOS.map((passo, i) => (
              <li key={passo.titulo} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 space-y-1.5 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">{passo.titulo}</p>
                  {passo.conteudo}
                </div>
              </li>
            ))}
          </ol>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <Lightbulb className="size-4 text-amber-500" /> Dicas
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Não use um Gmail pessoal como remetente — os provedores bloqueiam ou mandam para o spam.</li>
              <li>Não use encurtadores de link (bit.ly etc.) nos textos dos e-mails.</li>
              <li>
                E-mails caindo no spam? Confira se o domínio está <strong>Verified</strong> no Resend e se os registros DNS foram
                copiados sem espaços a mais.
              </li>
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
