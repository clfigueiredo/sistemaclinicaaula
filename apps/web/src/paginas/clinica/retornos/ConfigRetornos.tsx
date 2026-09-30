// Configuração do convite automático de retorno (admin): liga/desliga e "enviar quando faltarem N dias".
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { mensagemDeErro } from '@/api/cliente';
import { useConfigRetornos, useSalvarConfigRetornos } from '@/api/retornos';
import { Carregando } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/componentes/ui/dialog';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Switch } from '@/componentes/ui/switch';

export function ConfigRetornos({ aberto, onOpenChange }: { aberto: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: cfg, isLoading } = useConfigRetornos(aberto);
  const salvar = useSalvarConfigRetornos();
  const [ativo, setAtivo] = useState(true);
  const [dias, setDias] = useState('7');

  useEffect(() => {
    if (cfg && aberto) {
      setAtivo(cfg.convite_ativo);
      setDias(String(cfg.dias_antecedencia));
    }
  }, [cfg, aberto]);

  async function confirmar() {
    const n = Number(dias);
    if (!/^\d+$/.test(dias) || n > 60) {
      toast.error('Informe de 0 a 60 dias.');
      return;
    }
    try {
      await salvar.mutateAsync({ convite_ativo: ativo, dias_antecedencia: n });
      toast.success('Configuração salva.');
      onOpenChange(false);
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convite automático de retorno</DialogTitle>
          <DialogDescription>
            Todos os dias, às 09:30, o sistema envia pelo WhatsApp um convite para agendar o retorno aos pacientes que
            autorizaram mensagens. Cada retorno recebe no máximo um convite automático.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Carregando />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <Label htmlFor="retorno-convite-ativo" className="font-normal">
                Enviar convites automaticamente
              </Label>
              <Switch id="retorno-convite-ativo" checked={ativo} onCheckedChange={setAtivo} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="retorno-dias">Enviar quando faltarem quantos dias para a data prevista?</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="retorno-dias"
                  inputMode="numeric"
                  className="w-24"
                  value={dias}
                  disabled={!ativo}
                  onChange={(e) => setDias(e.target.value.replace(/\D/g, '').slice(0, 2))}
                />
                <span className="text-sm text-muted-foreground">dias (0 a 60)</span>
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={salvar.isPending || isLoading}>
            {salvar.isPending && <Loader2 className="size-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
