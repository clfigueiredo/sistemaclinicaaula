// Configurações da clínica: dados cadastrais (editáveis pelo admin) e plano/uso dos recursos.
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useMe } from '@/api/me';
import { ROTULOS_STATUS_ASSINATURA } from '@/api/tipos';
import { CabecalhoPagina, Carregando } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { formatarData, formatarMoeda, mascararCpfCnpj, mascararTelefone } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import DialogoEditarClinica from './DialogoEditarClinica';
import ConfigAgendamentoOnline from './ConfigAgendamentoOnline';

function formatarCep(cep: string) {
  return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}

export default function PaginaConfiguracoes() {
  const { data: me } = useMe();
  const [editando, setEditando] = useState(false);
  if (!me) return <Carregando />;
  const { clinica, plano, assinatura, recursos } = me;
  const lista = Object.entries(recursos);

  return (
    <div>
      <CabecalhoPagina titulo="Configurações" descricao="Dados da clínica, plano contratado e uso dos recursos." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>Clínica</CardTitle>
                <CardDescription>Dados cadastrais</CardDescription>
              </div>
              {me.papel === 'admin' && (
                <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
                  <Pencil className="size-4" />
                  Editar
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              {[
                ['Nome', clinica.nome],
                ['CNPJ/CPF', mascararCpfCnpj(clinica.documento)],
                ['Responsável', clinica.responsavel ?? '—'],
                ['E-mail', clinica.email ?? '—'],
                ['Telefone', clinica.telefone ? mascararTelefone(clinica.telefone) : '—'],
                ['Endereço', clinica.endereco ?? '—'],
                [
                  'Cidade/UF',
                  clinica.cidade || clinica.uf ? [clinica.cidade, clinica.uf].filter(Boolean).join(' / ') : '—',
                ],
                ['CEP', clinica.cep ? formatarCep(clinica.cep) : '—'],
                ['Fuso horário', clinica.fuso_horario.replace('America/', '').replace('_', ' ')],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="grid grid-cols-3 gap-2">
                  <dt className="text-muted-foreground">{rotulo}</dt>
                  <dd className="col-span-2 break-words">{valor}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>Plano {plano?.nome}</CardTitle>
                <CardDescription>
                  {plano && Number(plano.preco) > 0 ? `${formatarMoeda(plano.preco)} por mês` : 'Gratuito'}
                  {assinatura?.expira_em && ` · expira em ${formatarData(assinatura.expira_em)}`}
                </CardDescription>
              </div>
              {assinatura?.status && (
                <Badge variant={assinatura.somente_leitura ? 'destructive' : 'secondary'}>
                  {ROTULOS_STATUS_ASSINATURA[assinatura.status]}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {lista.map(([codigo, r]) => {
                const pct = r.limite ? Math.min(100, Math.round(((r.uso ?? 0) / r.limite) * 100)) : 0;
                return (
                  <li key={codigo} className="py-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className={cn(!r.habilitado && 'text-muted-foreground')}>{r.nome}</span>
                      <span className="text-muted-foreground">
                        {!r.habilitado
                          ? 'Não incluso'
                          : r.tipo === 'booleano'
                            ? 'Incluso'
                            : r.limite === null
                              ? `${r.uso} · ilimitado`
                              : `${r.uso} de ${r.limite}${r.periodo === 'mensal' ? ' este mês' : ''}`}
                      </span>
                    </div>
                    {r.habilitado && r.tipo === 'limite' && r.limite !== null && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full', pct >= 100 ? 'bg-destructive' : 'bg-primary')}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">
              Precisa de mais? Fale com o suporte para fazer upgrade do seu plano.
            </p>
          </CardContent>
        </Card>
      </div>
      {/* Fase 2 (dono: agendamento-online): endereço público /agendar/:slug e opções do agendamento online. */}
      {me.papel === 'admin' && recursos.agendamento_online?.habilitado && (
        <div className="mt-6">
          <ConfigAgendamentoOnline />
        </div>
      )}
      {editando && <DialogoEditarClinica clinica={clinica} aoFechar={() => setEditando(false)} />}
    </div>
  );
}
