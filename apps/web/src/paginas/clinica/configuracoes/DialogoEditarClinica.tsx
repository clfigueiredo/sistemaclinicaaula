/**
 * Dialog de edição dos dados cadastrais da clínica (somente admin — o backend também exige).
 * CNPJ/CPF e status não são editáveis aqui: só o super admin altera.
 */
import type { ComponentProps } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { mensagemDeErro } from '@/api/cliente';
import { useEditarClinica } from '@/api/me';
import type { Me } from '@/api/tipos';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { mascararCpfCnpj, mascararTelefone, somenteDigitos } from '@/lib/formatos';

const FUSOS: { valor: string; rotulo: string }[] = [
  { valor: 'America/Sao_Paulo', rotulo: 'Brasília (SP, RJ, MG, Sul, GO, DF)' },
  { valor: 'America/Bahia', rotulo: 'Bahia' },
  { valor: 'America/Fortaleza', rotulo: 'Fortaleza (CE, MA, PI, RN, PB)' },
  { valor: 'America/Recife', rotulo: 'Recife (PE, AL, SE)' },
  { valor: 'America/Belem', rotulo: 'Belém (PA, AP, TO)' },
  { valor: 'America/Manaus', rotulo: 'Manaus (AM)' },
  { valor: 'America/Cuiaba', rotulo: 'Cuiabá (MT)' },
  { valor: 'America/Campo_Grande', rotulo: 'Campo Grande (MS)' },
  { valor: 'America/Porto_Velho', rotulo: 'Porto Velho (RO)' },
  { valor: 'America/Boa_Vista', rotulo: 'Boa Vista (RR)' },
  { valor: 'America/Rio_Branco', rotulo: 'Rio Branco (AC)' },
  { valor: 'America/Noronha', rotulo: 'Fernando de Noronha' },
];

function mascararCep(v: string) {
  const d = somenteDigitos(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

const esquema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da clínica').max(150, 'Máximo de 150 caracteres'),
  responsavel: z.string().trim().max(150, 'Máximo de 150 caracteres'),
  email: z.string().trim().refine((v) => !v || z.email().safeParse(v).success, 'E-mail inválido'),
  telefone: z.string().refine((v) => [0, 10, 11].includes(somenteDigitos(v).length), 'Telefone inválido'),
  endereco: z.string().trim().max(200, 'Máximo de 200 caracteres'),
  cidade: z.string().trim().max(100, 'Máximo de 100 caracteres'),
  uf: z
    .string()
    .trim()
    .refine((v) => !v || /^[A-Za-z]{2}$/.test(v), 'UF inválida'),
  cep: z.string().refine((v) => [0, 8].includes(somenteDigitos(v).length), 'CEP inválido'),
  fuso_horario: z.string(),
});
type Campos = z.infer<typeof esquema>;

type Props = { clinica: Me['clinica']; aoFechar: () => void };

export default function DialogoEditarClinica({ clinica, aoFechar }: Props) {
  const editar = useEditarClinica();
  const form = useForm<Campos>({
    resolver: zodResolver(esquema),
    defaultValues: {
      nome: clinica.nome,
      responsavel: clinica.responsavel ?? '',
      email: clinica.email ?? '',
      telefone: clinica.telefone ? mascararTelefone(clinica.telefone) : '',
      endereco: clinica.endereco ?? '',
      cidade: clinica.cidade ?? '',
      uf: clinica.uf ?? '',
      cep: clinica.cep ? mascararCep(clinica.cep) : '',
      fuso_horario: clinica.fuso_horario,
    },
  });

  function salvar(v: Campos) {
    editar.mutate(
      {
        nome: v.nome,
        responsavel: v.responsavel,
        email: v.email,
        telefone: somenteDigitos(v.telefone),
        endereco: v.endereco,
        cidade: v.cidade,
        uf: v.uf.toUpperCase(),
        cep: somenteDigitos(v.cep),
        fuso_horario: v.fuso_horario,
      },
      {
        onSuccess: () => {
          toast.success('Dados da clínica atualizados.');
          aoFechar();
        },
        onError: (e) => toast.error(mensagemDeErro(e)),
      },
    );
  }

  const campo = (
    nome: keyof Campos,
    rotulo: string,
    props: ComponentProps<typeof Input> = {},
    mascara?: (v: string) => string,
  ) => (
    <FormField
      control={form.control}
      name={nome}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{rotulo}</FormLabel>
          <FormControl>
            <Input
              {...field}
              {...props}
              onChange={(e) => field.onChange(mascara ? mascara(e.target.value) : e.target.value)}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar dados da clínica</DialogTitle>
          <DialogDescription>
            CNPJ/CPF: {mascararCpfCnpj(clinica.documento)} — para alterar o documento, fale com o suporte.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(salvar)} className="grid gap-4 sm:grid-cols-6">
            <div className="sm:col-span-6">{campo('nome', 'Nome da clínica')}</div>
            <div className="sm:col-span-6">{campo('responsavel', 'Responsável')}</div>
            <div className="sm:col-span-3">{campo('email', 'E-mail', { type: 'email' })}</div>
            <div className="sm:col-span-3">{campo('telefone', 'Telefone', { inputMode: 'tel' }, mascararTelefone)}</div>
            <div className="sm:col-span-6">{campo('endereco', 'Endereço')}</div>
            <div className="sm:col-span-3">{campo('cidade', 'Cidade')}</div>
            <div className="sm:col-span-1">{campo('uf', 'UF', { maxLength: 2, className: 'uppercase' })}</div>
            <div className="sm:col-span-2">{campo('cep', 'CEP', { inputMode: 'numeric' }, mascararCep)}</div>
            <div className="sm:col-span-6">
              <FormField
                control={form.control}
                name="fuso_horario"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fuso horário</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {FUSOS.map((f) => (
                          <SelectItem key={f.valor} value={f.valor}>
                            {f.rotulo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter className="sm:col-span-6">
              <Button type="button" variant="outline" onClick={aoFechar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editar.isPending}>
                {editar.isPending && <Loader2 className="size-4 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
