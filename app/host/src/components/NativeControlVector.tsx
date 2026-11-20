import { tr } from '../lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/client';
import { Btn, ErrorNotice, Pill, Select } from './ui';
import { InfoTip } from './InfoTip';

type Source = 'builtin' | 'huihui' | 'custom';
type State = { enabled: boolean; source: Source; path: string; scale: number; first: number; last: number; mode: 'project' | 'add'; dir: 'per-layer' | 'single'; single: number | null; multiple: boolean };
type Info = { model: string; supported: boolean; presets: { builtin: boolean; huihui: boolean }; defaults: { source: Source; single: number | null }; state: State };
type Form = { enabled: boolean; source: Source; path: string; scale: string; first: string; last: string; mode: 'project' | 'add'; dir: 'per-layer' | 'single'; single: string };

const toForm = (info: Info): Form => {
    const s = info.state;
    const source = s.enabled ? s.source : info.presets.builtin ? 'builtin' : info.presets.huihui ? 'huihui' : 'custom';
    return { enabled: s.enabled, source, path: s.source === 'custom' ? s.path : '', scale: String(s.scale), first: String(s.first), last: String(s.last), mode: s.mode, dir: s.dir, single: s.single === null ? '' : String(s.single) };
};
const number = (text: string) => text.trim() === '' ? NaN : Number(text);

/**
 * Expert settings: the control vector (this fork). The choices are saved as the engine's own options in the model's settings file
 * (server/control-vector.mjs), so they apply the next time the model starts, from the app and from the Terminal alike.
 * The explanation, the author's warning and the other authors' notes are in the "i" button; nothing is written under the fields.
 */
export function NativeControlVector({ model }: { model: string }) {
    const [info, setInfo] = useState<Info | null>(null), [form, setForm] = useState<Form | null>(null), [pending, setPending] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
    const load = useCallback(() => api.get<Info>(`/api/native/models/${model}/control-vector`).then(value => { setInfo(value); setForm(toForm(value)); setError(''); }).catch(() => setInfo(null)), [model]);
    useEffect(() => { setSaved(false); void load(); }, [load]);
    if (!info?.supported || !form)
        return null;
    const locked = info.state.multiple, set = (patch: Partial<Form>) => { setForm({ ...form, ...patch }); setSaved(false); };
    const dirty = JSON.stringify(form) !== JSON.stringify(toForm(info));
    async function save() {
        if (!form)
            return;
        setPending(true);
        setError('');
        try {
            const next = await api.patch<Info>(`/api/native/models/${model}/control-vector`, { enabled: form.enabled, source: form.source, path: form.path, scale: number(form.scale), first: number(form.first), last: number(form.last), mode: form.mode, dir: form.dir, single: form.dir === 'single' ? number(form.single) : null });
            setInfo(next);
            setForm(toForm(next));
            setSaved(true);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setPending(false);
        }
    }
    const sources = [...(info.presets.builtin || (info.state.enabled && info.state.source === 'builtin') ? [{ value: 'builtin' as Source, label: "Built-in (Strata)" }] : []), ...(info.presets.huihui || (info.state.enabled && info.state.source === 'huihui') ? [{ value: 'huihui' as Source, label: "Huihui (alesha-pro)" }] : []), { value: 'custom' as Source, label: "Your own file" }];
    return <div className="native-control-vector">
    <div className="native-toggle"><span className="native-control-vector__title"><strong>{tr("Control vector")}</strong><Pill>{tr("Experimental")}</Pill><InfoTip label={tr("More about the control vector")}><p>{tr("When on, Strata removes the vector's direction from the model's internal state after each chosen layer. Both ready-made vectors point along the refusal direction of Qwen3.8-Flash-Next, so the model refuses far fewer requests.")}</p><p><strong>{tr("Removing refusals removes a safety behaviour. You are responsible for what the model writes with it on.")}</strong></p><p>{tr("It also shifts the model's predictions slightly on ordinary text. The authors of the built-in vector measured 0.2–0.4% more time per token on the same text.")}</p><p>{tr("Made for the original Qwen3.8-Flash-Next. Both ready-made vectors fall under the Qwen Community License 1.0.")}</p><p>{tr("Takes effect the next time the model loads. In a chat, the sampling settings can switch it off for a single answer.")}</p><p>{tr("The author of the Huihui vector wrote: “I tested layers 4-44 and 1-47.” “I did not test Q2_0 or IQ3_XXS, harder refusal sets, real photos or documents in vision, more than one GPU, or AMD cards.” “Ten prompts is a small set.”")}</p></InfoTip></span>
      <button className="st-toggle" role="switch" aria-label={tr("Control vector")} aria-checked={form.enabled} disabled={locked || pending} onClick={() => set({ enabled: !form.enabled })}/></div>
    {locked ? <p className="small muted">{tr("The settings file names more than one control vector. Change it in the settings file.")}</p> : null}
    {form.enabled && !locked ? <div className="native-field-grid native-control-vector__fields">
      <label className="input-field"><span>{tr("Vector")}</span><Select ariaLabel={tr("Vector")} value={form.source} options={sources} onChange={source => set({ source })}/></label>
      {form.source === 'custom' ? <label className="input-field"><span>{tr("File path")}</span><input className="st-input" value={form.path} placeholder="C:\vectors\my-vector.gguf" spellCheck={false} onChange={e => set({ path: e.target.value })}/></label> : null}
      <label className="input-field"><span>{tr("Strength")}</span><input className="st-input" inputMode="decimal" value={form.scale} onChange={e => set({ scale: e.target.value })}/></label>
      <label className="input-field"><span>{tr("First layer")}</span><input className="st-input" inputMode="numeric" value={form.first} onChange={e => set({ first: e.target.value })}/></label>
      <label className="input-field"><span>{tr("Last layer")}</span><input className="st-input" inputMode="numeric" value={form.last} onChange={e => set({ last: e.target.value })}/></label>
      <label className="input-field"><span>{tr("Mode")}</span><Select ariaLabel={tr("Mode")} value={form.mode} options={[{ value: 'project', label: "Project" }, { value: 'add', label: "Add" }]} onChange={mode => set({ mode, ...(mode === 'add' ? { dir: 'per-layer' as const } : {}) })}/></label>
      <label className="input-field"><span>{tr("Direction")}</span><Select ariaLabel={tr("Direction")} value={form.dir} disabled={form.mode === 'add'} options={[{ value: 'per-layer', label: "Per layer" }, { value: 'single', label: "Single layer" }]} onChange={dir => set({ dir })}/></label>
      {form.dir === 'single' ? <label className="input-field"><span>{tr("Layer number")}</span><input className="st-input" inputMode="numeric" value={form.single} onChange={e => set({ single: e.target.value })}/></label> : null}
    </div> : null}
    {error ? <ErrorNotice message={error}/> : null}
    {!locked ? <div className="row"><Btn size="sm" disabled={pending || !dirty} onClick={() => void save()}>{tr("Save")}</Btn>{saved ? <span className="small muted" role="status">{tr("Changes you make in the file apply the next time the model starts.")}</span> : null}</div> : null}
  </div>;
}
