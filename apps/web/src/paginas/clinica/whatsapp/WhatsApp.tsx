// WhatsApp da clínica: conexão do número (QR code), lembretes, avisos da recepção e histórico.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BellRing,
  Check,
  Loader2,
  LogOut,
  MessageCircle,
  QrCode,
  Send,
  Smartphone,
} from 'lucide-react';
import { mensagemDeErro } from '@/api/cliente';
import { usePodeUsar } from '@/api/me';
import {
  ROTULOS_STATUS_MENSAGEM,
  ROTULOS_STATUS_SESSAO,
  ROTULOS_TIPO_MENSAGEM,
  useAvisosWhatsapp,
  useConectarWhatsapp,
  useDesconectarWhatsapp,
  useExecutarLembretes,
  useMarcarAvisoLido,
  useMensagensWhatsapp,
  useStatusWhatsapp,
  type MensagemWhatsapp,
  type StatusMensagemWhatsapp,
  type StatusSessaoWhatsapp,
} from '@/api/whatsapp';
import { AvisoLimite, CabecalhoPagina, Carregando, EstadoVazio, UsoRecurso } from '@/componentes/comum';
import { Alert, AlertDescription, AlertTitle } from '@/componentes/ui/alert';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarDataHora, mascararTelefone } from '@/lib/formatos';
import { cn } from '@/lib/utils';

/** 5511999998888 → +55 (11) 99999-8888 */
function formatarWhatsapp(numero: string | null | undefined): string {
  if (!numero) return '—';
  const d = numero.replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return `+55 ${mascararTelefone(d.slice(2))}`;
  return `+${d}`;
}

const CLASSES_STATUS_SESSAO: Record<StatusSessaoWhatsapp, string> = {
  conectada: 'bg-success text-white',
  aguardando_qr: 'bg-warning text-black',
  iniciando: 'bg-warning text-black',
  erro: 'bg-destructive text-white',
  desconectada: 'bg-muted text-muted-foreground',
};

const CLASSES_STATUS_MENSAGEM: Record<StatusMensagemWhatsapp, string> = {
  enviada: 'bg-success/15 text-success border-success/30',
  recebida: 'bg-primary/10 text-primary border-primary/20',
  pendente: 'bg-warning/15 text-foreground border-warning/40',
  falhou: 'bg-destructive/10 text-destructive border-destructive/30',
};

const DESCRICAO_ERROS: Record<string, string> = {
  limite_atingido: 'Limite de mensagens do plano atingido',
  recurso_indisponivel: 'WhatsApp não incluso no plano',
  sem_consentimento: 'Paciente sem consentimento',
  telefone_invalido: 'Telefone inválido',
  agendamento_alterado: 'Agendamento alterado antes do envio',
  envio_incerto: 'Envio interrompido (não reenviado para evitar duplicidade)',
};

export default function PaginaWhatsApp() {
  const recurso = usePodeUsar('whatsapp');
  const mensagens = usePodeUsar('max_mensagens');

  if (recurso.carregando) return <Carregando />;

  if (!recurso.habilitado) {
    return (
      <div>
        <CabecalhoPagina titulo="WhatsApp" descricao="Lembretes automáticos e confirmação de consultas pelo WhatsApp." />
        <AvisoLimite codigo="whatsapp" className="mb-6" />
        <EstadoVazio
          icone={<MessageCircle className="size-5" />}
          titulo="WhatsApp não está no seu plano"
          descricao="Faça upgrade para conectar o número da clínica e enviar lembretes automáticos com confirmação por resposta."
        />
      </div>
    );
  }

  return (
    <div>
      <CabecalhoPagina
        titulo="WhatsApp"
        descricao="Conecte o número da clínica para enviar lembretes 1 dia antes e receber confirmações."
        acoes={
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            Mensagens do plano <UsoRecurso codigo="max_mensagens" />
          </div>
        }
      />

      <div className="space-y-6">
        {!mensagens.pode && <AvisoLimite codigo="max_mensagens" />}

        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Integração não oficial</AlertTitle>
          <AlertDescription>
            A conexão usa o WhatsApp Web do celular da clínica (não é a API oficial da Meta). Mantenha o celular com
            internet. As mensagens são enviadas com intervalo de 20 a 40 segundos e{' '}
            <strong>só para pacientes que consentiram</strong> em receber mensagens no cadastro.
          </AlertDescription>
        </Alert>

        <div className="grid gap-6 lg:grid-cols-5">
          <CardConexao className="lg:col-span-3" />
          <CardAvisos className="lg:col-span-2" />
        </div>

        <CardHistorico />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Conexão
// ----------------------------------------------------------------------------

function CardConexao({ className }: { className?: string }) {
  const [polling, setPolling] = useState(false);
  const { data, isLoading, error } = useStatusWhatsapp({ pollingMs: polling ? 3000 : false });
  const conectar = useConectarWhatsapp();
  const desconectar = useDesconectarWhatsapp();
  const lembretes = useExecutarLembretes();
  const podeMensagens = usePodeUsar('max_mensagens');
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const statusAnterior = useRef<StatusSessaoWhatsapp | null>(null);

  const status = data?.status ?? 'desconectada';
  const aguardando = status === 'aguardando_qr' || status === 'iniciando';

  // Polling a cada 3 s enquanto aguarda a leitura do QR code.
  useEffect(() => {
    setPolling(aguardando || conectar.isPending);
  }, [aguardando, conectar.isPending]);

  useEffect(() => {
    if (statusAnterior.current && statusAnterior.current !== 'conectada' && status === 'conectada') {
      toast.success('WhatsApp conectado!');
    }
    statusAnterior.current = status;
  }, [status]);

  async function aoConectar() {
    try {
      const r = await conectar.mutateAsync();
      if (r.status === 'conectada') toast.success('WhatsApp já está conectado.');
    } catch (e) {
      toast.error('Não foi possível iniciar a conexão', { description: mensagemDeErro(e) });
    }
  }

  async function aoDesconectar() {
    try {
      await desconectar.mutateAsync();
      toast.success('WhatsApp desconectado.');
      setConfirmarSaida(false);
    } catch (e) {
      toast.error('Não foi possível desconectar', { description: mensagemDeErro(e) });
    }
  }

  async function aoEnviarLembretes() {
    try {
      const r = await lembretes.mutateAsync();
      if (r.selecionados === 0) {
        toast.info('Nenhum lembrete pendente para amanhã.');
      } else {
        toast.success(`${r.enfileirados} lembrete(s) colocados na fila de envio.`, {
          description:
            r.falharam > 0
              ? `${r.falharam} não puderam ser enviados (${Object.keys(r.erros)
                  .map((c) => DESCRICAO_ERROS[c] ?? c)
                  .join(', ')}).`
              : 'Os envios saem com intervalo de 20 a 40 segundos.',
        });
      }
    } catch (e) {
      toast.error('Não foi possível enviar os lembretes', { description: mensagemDeErro(e) });
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="size-4" /> Conexão
            </CardTitle>
            <CardDescription>Número de WhatsApp usado para os lembretes da clínica.</CardDescription>
          </div>
          {data && <Badge className={cn('border-0', CLASSES_STATUS_SESSAO[status])}>{ROTULOS_STATUS_SESSAO[status]}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Carregando texto="Consultando a conexão…" />
        ) : error ? (
          <p className="text-sm text-destructive">{mensagemDeErro(error)}</p>
        ) : (
          <>
            {data?.erro_provedor && <p className="text-sm text-muted-foreground">{data.erro_provedor}</p>}

            {status === 'conectada' && (
              <div className="flex items-center gap-3 rounded-lg border bg-success/5 p-4">
                <div className="grid size-10 place-items-center rounded-full bg-success/15 text-success">
                  <Check className="size-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Número conectado</p>
                  <p className="font-medium">{formatarWhatsapp(data?.telefone)}</p>
                </div>
              </div>
            )}

            {aguardando && (
              <div className="flex flex-col items-center gap-3 rounded-lg border p-4 sm:flex-row sm:items-start">
                <div className="grid size-56 shrink-0 place-items-center rounded-md bg-white p-2">
                  {data?.qr_code ? (
                    <img src={data.qr_code} alt="QR code para conectar o WhatsApp" className="size-full object-contain" />
                  ) : (
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  )}
                </div>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                  <li>Abra o WhatsApp no celular da clínica.</li>
                  <li>
                    Toque em <strong>Mais opções</strong> (ou <strong>Configurações</strong>) →{' '}
                    <strong>Aparelhos conectados</strong>.
                  </li>
                  <li>
                    Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para o QR code.
                  </li>
                  <li>Esta tela atualiza sozinha quando a conexão for concluída.</li>
                </ol>
              </div>
            )}

            {(status === 'desconectada' || status === 'erro') && (
              <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <QrCode className="size-5 shrink-0" />
                {status === 'erro'
                  ? 'A conexão falhou. Tente conectar novamente.'
                  : 'Nenhum número conectado. Clique em Conectar para gerar o QR code.'}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {status !== 'conectada' && (
                <Button onClick={aoConectar} disabled={conectar.isPending}>
                  {conectar.isPending ? <Loader2 className="animate-spin" /> : <QrCode />}
                  {aguardando ? 'Gerar novo QR code' : 'Conectar'}
                </Button>
              )}
              {status === 'conectada' && (
                <Button
                  onClick={aoEnviarLembretes}
                  disabled={lembretes.isPending || !podeMensagens.pode}
                  title={podeMensagens.mensagem ?? undefined}
                >
                  {lembretes.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                  Enviar lembretes de amanhã agora
                </Button>
              )}
              {status !== 'desconectada' && (
                <Button variant="outline" onClick={() => setConfirmarSaida(true)} disabled={desconectar.isPending}>
                  <LogOut /> Desconectar
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Os lembretes também são enviados automaticamente todos os dias às 9h para as consultas do dia seguinte.
            </p>
          </>
        )}
      </CardContent>

      <Dialog open={confirmarSaida} onOpenChange={setConfirmarSaida}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar o WhatsApp?</DialogTitle>
            <DialogDescription>
              Os lembretes automáticos deixam de ser enviados até você conectar um número de novo. As mensagens já na fila
              vão falhar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button variant="destructive" onClick={aoDesconectar} disabled={desconectar.isPending}>
              {desconectar.isPending && <Loader2 className="animate-spin" />}
              Desconectar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Avisos da recepção
// ----------------------------------------------------------------------------

function CardAvisos({ className }: { className?: string }) {
  const { data, isLoading } = useAvisosWhatsapp();
  const marcar = useMarcarAvisoLido();

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="size-4" /> Avisos da recepção
            </CardTitle>
            <CardDescription>Cancelamentos feitos pelos pacientes respondendo ao lembrete.</CardDescription>
          </div>
          {!!data?.nao_lidos && <Badge variant="destructive">{data.nao_lidos} novo(s)</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Carregando />
        ) : !data?.itens.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum cancelamento recebido.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {data.itens.map((a) => (
              <li key={a.id} className={cn('flex items-start gap-3 py-3', a.lido && 'opacity-60')}>
                <span
                  className={cn('mt-1.5 size-2 shrink-0 rounded-full', a.lido ? 'bg-muted-foreground/40' : 'bg-destructive')}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{a.conteudo}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatarDataHora(a.criado_em)}</p>
                </div>
                {!a.lido && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      marcar.mutate(a.id, { onError: (e) => toast.error('Não foi possível marcar', { description: mensagemDeErro(e) }) })
                    }
                    disabled={marcar.isPending}
                  >
                    Marcar como lido
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Histórico
// ----------------------------------------------------------------------------

function CardHistorico() {
  const [pagina, setPagina] = useState(1);
  const { data, isLoading, isFetching } = useMensagensWhatsapp(pagina);
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.porPagina)) : 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="size-4" /> Histórico de mensagens
          {isFetching && !isLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </CardTitle>
        <CardDescription>Lembretes enviados, respostas dos pacientes e respostas automáticas.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Carregando />
        ) : !data?.itens.length ? (
          <EstadoVazio titulo="Nenhuma mensagem ainda" descricao="Os lembretes e as respostas aparecem aqui." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Paciente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="min-w-64">Mensagem</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.itens.map((m) => (
                    <LinhaMensagem key={m.id} m={m} />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {data.total} mensagem(ns) · página {pagina} de {totalPaginas}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagina >= totalPaginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LinhaMensagem({ m }: { m: MensagemWhatsapp }) {
  const entrada = m.direcao === 'entrada';
  return (
    <TableRow>
      <TableCell>
        <span
          title={entrada ? 'Recebida do paciente' : 'Enviada pela clínica'}
          className={cn(
            'grid size-7 place-items-center rounded-full',
            entrada ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {entrada ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
        </span>
      </TableCell>
      <TableCell>
        <div className="font-medium">{m.paciente?.nome ?? 'Não identificado'}</div>
        <div className="text-xs text-muted-foreground">{formatarWhatsapp(m.telefone)}</div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {m.tipo ? ROTULOS_TIPO_MENSAGEM[m.tipo] : entrada ? 'Resposta do paciente' : '—'}
      </TableCell>
      <TableCell>
        <p className="line-clamp-2 max-w-md whitespace-pre-line text-sm" title={m.conteudo}>
          {m.conteudo}
        </p>
        {m.agendamento && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Consulta {formatarDataHora(m.agendamento.inicio)} · {m.agendamento.profissional.nome}
          </p>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={CLASSES_STATUS_MENSAGEM[m.status]}>
          {ROTULOS_STATUS_MENSAGEM[m.status]}
        </Badge>
        {m.status === 'falhou' && m.erro && (
          <p className="mt-1 max-w-48 text-xs text-destructive">{DESCRICAO_ERROS[m.erro] ?? m.erro}</p>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatarDataHora(m.enviada_em ?? m.criado_em)}
      </TableCell>
    </TableRow>
  );
}
