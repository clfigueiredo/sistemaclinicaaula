// Aba "Dados" da ficha: dados cadastrais (admin/recepção editam) + alergias e medicações
// (dados clínicos: admin/profissional veem e editam; recepção não vê).
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Pill, Plus, Trash2 } from 'lucide-react';
import { useMe } from '@/api/me';
import { mensagemDeErro } from '@/api/cliente';
import {
  useAdicionarAlergia,
  useAdicionarMedicacao,
  useEditarPaciente,
  useRemoverAlergia,
  useRemoverMedicacao,
  type Paciente,
} from '@/api/pacientes';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import { Switch } from '@/componentes/ui/switch';
import { Label } from '@/componentes/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { FormularioPaciente } from '../FormularioPaciente';

export default function AbaDados({ paciente }: { paciente: Paciente }) {
  const { data: me } = useMe();
  const podeEditar = me?.papel === 'admin' || me?.papel === 'recepcao';
  const verClinico = paciente.alergias !== null && paciente.medicacoes !== null;
  const editar = useEditarPaciente(paciente.id);

  async function alternarAtivo(ativo: boolean) {
    const { alergias: _a, medicacoes: _m, convenio: _c, id: _i, criado_em: _cr, atualizado_em: _at, ...dados } = paciente;
    try {
      await editar.mutateAsync({ ...dados, ativo });
      toast.success(ativo ? 'Paciente reativado.' : 'Paciente inativado.');
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className={verClinico ? 'xl:col-span-2' : 'xl:col-span-3'}>
        <CardHeader>
          <CardTitle>Dados cadastrais</CardTitle>
          <CardDescription>
            {podeEditar ? 'Mantenha os dados de contato sempre atualizados.' : 'Somente a recepção e o administrador editam estes dados.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioPaciente
            paciente={paciente}
            somenteLeitura={!podeEditar}
            salvando={editar.isPending}
            rotuloSalvar="Salvar alterações"
            acoesExtras={
              <div className="mr-auto flex items-center gap-2">
                <Switch
                  id="paciente-ativo"
                  checked={paciente.ativo}
                  disabled={editar.isPending}
                  onCheckedChange={alternarAtivo}
                />
                <Label htmlFor="paciente-ativo" className="text-sm font-normal">
                  {paciente.ativo ? 'Paciente ativo' : 'Paciente inativo'}
                </Label>
              </div>
            }
            onSalvar={async (dados) => {
              try {
                await editar.mutateAsync({ ...dados, ativo: paciente.ativo });
                toast.success('Dados do paciente atualizados.');
              } catch (e) {
                toast.error(mensagemDeErro(e));
                throw e;
              }
            }}
          />
        </CardContent>
      </Card>

      {verClinico && (
        <div className="space-y-6">
          <CardAlergias paciente={paciente} />
          <CardMedicacoes paciente={paciente} />
        </div>
      )}
    </div>
  );
}

function CardAlergias({ paciente }: { paciente: Paciente }) {
  const [descricao, setDescricao] = useState('');
  const [gravidade, setGravidade] = useState('');
  const adicionar = useAdicionarAlergia(paciente.id);
  const remover = useRemoverAlergia(paciente.id);
  const alergias = paciente.alergias ?? [];

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (descricao.trim().length < 2) return;
    try {
      await adicionar.mutateAsync({ descricao: descricao.trim(), gravidade: gravidade.trim() || null });
      setDescricao('');
      setGravidade('');
    } catch (err) {
      toast.error(mensagemDeErro(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-destructive" />
          Alergias
        </CardTitle>
        <CardDescription>Aparecem em destaque no topo da ficha.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {alergias.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma alergia registrada.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {alergias.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-destructive">{a.descricao}</span>
                  {a.gravidade && <span className="text-muted-foreground"> · {a.gravidade}</span>}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remover alergia ${a.descricao}`}
                  disabled={remover.isPending}
                  onClick={() =>
                    remover.mutate(a.id, { onError: (err) => toast.error(mensagemDeErro(err)) })
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={enviar} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
          <Input placeholder="Ex.: Dipirona" value={descricao} onChange={(e) => setDescricao(e.target.value)} aria-label="Alergia" />
          <Input placeholder="Gravidade" value={gravidade} onChange={(e) => setGravidade(e.target.value)} aria-label="Gravidade" />
          <Button type="submit" variant="outline" disabled={adicionar.isPending || descricao.trim().length < 2}>
            {adicionar.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            Adicionar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CardMedicacoes({ paciente }: { paciente: Paciente }) {
  const [nome, setNome] = useState('');
  const [dosagem, setDosagem] = useState('');
  const [frequencia, setFrequencia] = useState('');
  const adicionar = useAdicionarMedicacao(paciente.id);
  const remover = useRemoverMedicacao(paciente.id);
  const medicacoes = paciente.medicacoes ?? [];

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (nome.trim().length < 2) return;
    try {
      await adicionar.mutateAsync({
        nome: nome.trim(),
        dosagem: dosagem.trim() || null,
        frequencia: frequencia.trim() || null,
        observacoes: null,
      });
      setNome('');
      setDosagem('');
      setFrequencia('');
    } catch (err) {
      toast.error(mensagemDeErro(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Pill className="size-4 text-primary" />
          Medicações em uso
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {medicacoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma medicação registrada.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {medicacoes.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{m.nome}</span>
                  {(m.dosagem || m.frequencia) && (
                    <span className="text-muted-foreground"> · {[m.dosagem, m.frequencia].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remover medicação ${m.nome}`}
                  disabled={remover.isPending}
                  onClick={() =>
                    remover.mutate(m.id, { onError: (err) => toast.error(mensagemDeErro(err)) })
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={enviar} className="grid gap-2 sm:grid-cols-2">
          <Input
            className="sm:col-span-2"
            placeholder="Medicamento"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            aria-label="Medicamento"
          />
          <Input placeholder="Dosagem (ex.: 50 mg)" value={dosagem} onChange={(e) => setDosagem(e.target.value)} aria-label="Dosagem" />
          <Input
            placeholder="Frequência (ex.: 1x ao dia)"
            value={frequencia}
            onChange={(e) => setFrequencia(e.target.value)}
            aria-label="Frequência"
          />
          <Button type="submit" variant="outline" className="sm:col-span-2" disabled={adicionar.isPending || nome.trim().length < 2}>
            {adicionar.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            Adicionar medicação
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
