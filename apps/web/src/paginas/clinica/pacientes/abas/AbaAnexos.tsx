// Aba "Anexos" da ficha: exames/laudos do paciente com upload (arrastar e soltar) e download autenticado.
// Consome o limite `max_anexos` do plano. Recepção não vê esta aba (a API também responde 403).
import { useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { Download, FileImage, FileText, Loader2, Lock, Paperclip, UploadCloud } from 'lucide-react';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { usePodeUsar } from '@/api/me';
import { baixarAnexo, useAnexos, useEnviarAnexo, type Anexo } from '@/api/prontuario';
import { AvisoLimite, Carregando, EstadoVazio, UsoRecurso } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarDataHora } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { formatarTamanho } from '../utils';

const EXTENSOES = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'dcm'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.dcm,application/pdf,image/jpeg,image/png,image/webp,application/dicom';
const TAMANHO_MAX_MB = 10;

function validarArquivo(f: File): string | null {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (!EXTENSOES.includes(ext)) return `“${f.name}”: tipo não permitido. Envie PDF, JPG, PNG, WEBP ou DICOM.`;
  if (f.size > TAMANHO_MAX_MB * 1024 * 1024) return `“${f.name}”: o arquivo passa de ${TAMANHO_MAX_MB} MB.`;
  if (f.size === 0) return `“${f.name}”: o arquivo está vazio.`;
  return null;
}

function IconeArquivo({ mime }: { mime: string | null }) {
  return mime?.startsWith('image/') ? (
    <FileImage className="size-4 shrink-0 text-muted-foreground" />
  ) : (
    <FileText className="size-4 shrink-0 text-muted-foreground" />
  );
}

export default function AbaAnexos({ pacienteId }: { pacienteId: string }) {
  const { data: anexos, isLoading, error } = useAnexos(pacienteId);
  const enviar = useEnviarAnexo(pacienteId);
  const { pode, mensagem, restante } = usePodeUsar('max_anexos');
  const [arrastando, setArrastando] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function enviarArquivos(lista: FileList | File[]) {
    const arquivos = Array.from(lista);
    if (!arquivos.length) return;
    if (!pode) {
      toast.error(mensagem ?? 'O plano não permite enviar mais anexos.');
      return;
    }
    const limite = restante ?? Infinity;
    if (arquivos.length > limite) {
      toast.warning(`Seu plano permite enviar mais ${limite} ${limite === 1 ? 'anexo' : 'anexos'}; os demais foram ignorados.`);
    }
    for (const arquivo of arquivos.slice(0, limite)) {
      const erro = validarArquivo(arquivo);
      if (erro) {
        toast.error(erro);
        continue;
      }
      try {
        await enviar.mutateAsync({ arquivo });
        toast.success(`“${arquivo.name}” anexado.`);
      } catch (e) {
        // limite_atingido já gera toast automático no cliente HTTP
        if (!(e instanceof ErroApi && e.codigo === 'limite_atingido')) toast.error(mensagemDeErro(e));
        break;
      }
    }
  }

  async function baixar(a: Anexo) {
    setBaixando(a.id);
    try {
      await baixarAnexo(a);
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setBaixando(null);
    }
  }

  function aoSoltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastando(false);
    if (enviar.isPending) return;
    void enviarArquivos(e.dataTransfer.files);
  }

  if (isLoading) return <Carregando />;
  if (error) {
    const negado = error instanceof ErroApi && error.status === 403;
    return (
      <EstadoVazio
        icone={<Lock className="size-5" />}
        titulo={negado ? 'Acesso aos anexos restrito' : 'Não foi possível carregar os anexos'}
        descricao={mensagemDeErro(error)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Exames, laudos e imagens do paciente.</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Anexos do plano <UsoRecurso codigo="max_anexos" />
        </div>
      </div>
      <AvisoLimite codigo="max_anexos" />

      <div
        role="button"
        tabIndex={0}
        aria-disabled={!pode || enviar.isPending}
        onClick={() => pode && !enviar.isPending && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && pode && !enviar.isPending) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (pode) setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={aoSoltar}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
          pode ? 'cursor-pointer hover:border-primary/60 hover:bg-primary/5' : 'cursor-not-allowed opacity-60',
          arrastando && 'border-primary bg-primary/10',
        )}
      >
        {enviar.isPending ? (
          <Loader2 className="size-7 animate-spin text-primary" />
        ) : (
          <UploadCloud className="size-7 text-primary" />
        )}
        <p className="text-sm font-medium">
          {enviar.isPending ? 'Enviando…' : 'Arraste arquivos aqui ou clique para selecionar'}
        </p>
        <p className="text-xs text-muted-foreground">PDF, JPG, PNG, WEBP ou DICOM · até {TAMANHO_MAX_MB} MB por arquivo</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void enviarArquivos(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {!anexos || anexos.length === 0 ? (
        <EstadoVazio
          icone={<Paperclip className="size-5" />}
          titulo="Nenhum anexo"
          descricao="Os arquivos enviados ficam guardados com segurança e só podem ser baixados por usuários autorizados."
        />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead className="hidden sm:table-cell">Tamanho</TableHead>
                <TableHead className="hidden md:table-cell">Enviado em</TableHead>
                <TableHead className="hidden lg:table-cell">Enviado por</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Baixar</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {anexos.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <IconeArquivo mime={a.mime_tipo} />
                      <span className="truncate font-medium" title={a.nome_arquivo}>
                        {a.nome_arquivo}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground md:hidden">
                      {formatarTamanho(a.tamanho)} · {formatarDataHora(a.criado_em)}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{formatarTamanho(a.tamanho)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap md:table-cell">{formatarDataHora(a.criado_em)}</TableCell>
                  <TableCell className="hidden lg:table-cell">{a.usuario?.nome ?? '—'}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => baixar(a)}
                      disabled={baixando === a.id}
                      aria-label={`Baixar ${a.nome_arquivo}`}
                    >
                      {baixando === a.id ? <Loader2 className="animate-spin" /> : <Download />}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
