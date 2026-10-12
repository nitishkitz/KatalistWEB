import { BriefcaseBusiness, House } from 'lucide-react';
import { toast } from 'sonner';
import { useAppContext } from '@/features/context/use-app-context';
import { cn } from '@/lib/utils';

export function MobileContextSwitch() {
  const { context, setContext } = useAppContext();
  return (
    <div className="flex h-12 items-center justify-between border-b border-border/70 px-4 md:hidden">
      <span className="text-xs font-semibold text-foreground">{context === 'home' ? 'Your personal space' : 'Your workspace'}</span>
      <div role="group" aria-label="Work and Home context" className="flex rounded-full border border-border bg-white p-0.5">
        {(['work', 'home'] as const).map(mode => {
          const Icon=mode === 'home' ? House : BriefcaseBusiness;
          return <button key={mode} type="button" aria-pressed={context===mode} onClick={() => void setContext(mode).catch(() => toast.error('Could not save the context. Try again.'))} className={cn('flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',context===mode?'bg-primary/10 text-primary':'text-muted-foreground')}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{mode==='home'?'Home':'Work'}</button>;
        })}
      </div>
    </div>
  );
}
