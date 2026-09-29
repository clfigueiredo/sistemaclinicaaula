// Ficha do paciente (/pacientes/:id): cabeçalho + abas Dados, Consultas, Prontuário e Anexos.
// Prontuário e Anexos só aparecem para PAPEIS_ROTA.prontuario (recepção NÃO vê — o backend também bloqueia).
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, MessageCircle, ShieldCheck } from 'lucide-react';
import { useMe } from '@/api/me';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { usePaciente } from '@/api/pacientes';
import { PAPEIS_ROTA } from '@/rotas/navegacao';
import { CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/componentes/ui/tabs';
import AbaProntuario from './abas/AbaProntuario';
import AbaAnexos from './abas/AbaAnexos';
import AbaDados from './abas/AbaDados';
import AbaConsultas from './abas/AbaConsultas';
import { calcularIdade, exibirTelefone } from './utils';

const ABAS = ['dados', 'consultas', 'prontuario', 'anexos'] as const;
type Aba = (typeof ABAS)[number];

export default function PaginaFichaPaciente() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: me } = useMe();
  const { data: paciente, isLoading, error } = usePaciente(id);
  const podeProntuario = !!me && PAPEIS_ROTA.prontuario.includes(me.papel);

  const pedida = params.get('aba') as Aba | null;
  const aba: Aba =
    pedida && ABAS.includes(pedida) && (podeProntuario || (pedida !== 'prontuario' && pedida !== 'anexos'))
      ? pedida
      : 'dados';

  const voltar = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
      <Link to="/pacientes">
        <ArrowLeft className="size-4" />
        Pacientes
      </Link>
    </Button>
  );

  if (isLoading) return <Carregando />;
  if (error || !paciente) {
    const naoEncontrado = error instanceof ErroApi && error.status === 404;
    return (
      <div>
        {voltar}
        <EstadoVazio
          titulo={naoEncontrado ? 'Paciente não encontrado' : 'Não foi possível carregar o paciente'}
          descricao={naoEncontrado ? 'O paciente não existe ou pertence a outra clínica.' : mensagemDeErro(error)}
        />
      </div>
    );
  }

  const idade = calcularIdade(paciente.nascimento);
  const alergias = paciente.alergias ?? [];

  return (
    <div>
      {voltar}
      <CabecalhoPagina
        className="mb-4"
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {paciente.nome}
            {!paciente.ativo && <Badge variant="outline">Inativo</Badge>}
          </span>
        }
        descricao={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{idade !== null ? `${idade} ${idade === 1 ? 'ano' : 'anos'}` : 'Idade não informada'}</span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5" />
              {paciente.convenio ? paciente.convenio.nome : 'Particular'}
              {paciente.convenio && paciente.numero_carteirinha && ` · ${paciente.numero_carteirinha}`}
            </span>
            {(paciente.telefone || paciente.whatsapp) && (
              <span>{exibirTelefone(paciente.telefone ?? paciente.whatsapp)}</span>
            )}
          </span>
        }
        acoes={
          <div className="flex flex-wrap gap-2">
            {paciente.aceita_whatsapp ? (
              <Badge variant="secondary" className="gap-1">
                <MessageCircle className="size-3" /> Aceita WhatsApp
              </Badge>
            ) : (
              <Badge variant="outline">Sem consentimento de WhatsApp</Badge>
            )}
          </div>
        }
      />

      {paciente.alergias !== null && (
        <div className="mb-6">
          {alergias.length > 0 ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
            >
              <span className="inline-flex items-center gap-1.5 font-semibold text-destructive">
                <AlertTriangle className="size-4" />
                Alergias:
              </span>
              {alergias.map((a) => (
                <Badge key={a.id} variant="destructive">
                  {a.descricao}
                  {a.gravidade && ` (${a.gravidade})`}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma alergia registrada.</p>
          )}
        </div>
      )}

      <Tabs
        value={aba}
        onValueChange={(v) => {
          const novos = new URLSearchParams(params);
          novos.set('aba', v);
          setParams(novos, { replace: true });
        }}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="consultas">Consultas</TabsTrigger>
          {podeProntuario && <TabsTrigger value="prontuario">Prontuário</TabsTrigger>}
          {podeProntuario && <TabsTrigger value="anexos">Anexos</TabsTrigger>}
        </TabsList>
        <TabsContent value="dados">
          <AbaDados paciente={paciente} />
        </TabsContent>
        <TabsContent value="consultas">
          <AbaConsultas pacienteId={paciente.id} />
        </TabsContent>
        {podeProntuario && (
          <TabsContent value="prontuario">
            <AbaProntuario pacienteId={paciente.id} />
          </TabsContent>
        )}
        {podeProntuario && (
          <TabsContent value="anexos">
            <AbaAnexos pacienteId={paciente.id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
