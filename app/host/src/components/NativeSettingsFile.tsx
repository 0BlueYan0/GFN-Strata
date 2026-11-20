import { tr } from '../lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/client';
import { Btn, Dialog, ErrorNotice } from './ui';
import { issueText, type RunConfigIssue, type SettingsFileInfo } from '../lib/run-config-issues';

/** The settings file with its text. `version` is what the host compares on a save, so a file that changed meanwhile is never overwritten. */
type SettingsFileText = SettingsFileInfo & { text: string; version: string };

/**
 * Expert settings: the model's settings live in one text file (its run configuration). A power user edits it in a window of the app
 * (no other program is started) and changes any engine option; the change applies the next time the model starts. The text is checked
 * on the host before it is written, and a mistake is shown in plain words with its line.
 */
export function NativeSettingsFile({ model }: { model: string }) {
    const [info, setInfo] = useState<SettingsFileInfo | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
    const [open, setOpen] = useState(false), [text, setText] = useState(''), [version, setVersion] = useState(''), [conflict, setConflict] = useState(false), [problems, setProblems] = useState<RunConfigIssue[]>([]), [saved, setSaved] = useState(false), [replacing, setReplacing] = useState(false);
    const check = useCallback(() => api.get<SettingsFileInfo>(`/api/native/models/${model}/settings-file`).then(value => { setInfo(value); setError(''); }).catch(() => setInfo(null)), [model]);
    useEffect(() => {
        void check();
        // Back from another program that changed the file: look at the file again.
        const again = () => void check();
        window.addEventListener('focus', again);
        return () => window.removeEventListener('focus', again);
    }, [check]);
    async function load(): Promise<boolean> {
        setPending(true);
        setError('');
        try {
            const value = await api.get<SettingsFileText>(`/api/native/models/${model}/settings-file/text`);
            setText(value.text);
            setVersion(value.version);
            setInfo(value);
            setConflict(false);
            setProblems([]);
            return true;
        }
        catch (e) {
            setError((e as Error).message);
            return false;
        }
        finally {
            setPending(false);
        }
    }
    async function openEditor() {
        setSaved(false);
        if (await load())
            setOpen(true);
    }
    async function save() {
        setPending(true);
        setError('');
        setProblems([]);
        setConflict(false);
        try {
            setInfo(await api.put<SettingsFileText>(`/api/native/models/${model}/settings-file/text`, { text, version }));
            setOpen(false);
            setSaved(true);
            void check();
        }
        catch (e) {
            const code = e instanceof ApiError ? (e.body as { code?: string } | undefined)?.code : undefined;
            if (code === 'settings-file-changed')
                setConflict(true);
            else if (code === 'settings-file-mistake')
                setProblems(((e as ApiError).body as { issues?: RunConfigIssue[] }).issues ?? []);
            setError((e as Error).message);
        }
        finally {
            setPending(false);
        }
    }
    function close() {
        setOpen(false);
        setReplacing(false);
        setError('');
        setConflict(false);
        setProblems([]);
    }
    const errors = info?.issues.filter(i => i.level === 'error') ?? [], warnings = info?.issues.filter(i => i.level === 'warning') ?? [];
    const refused = problems.filter(i => i.level === 'error');
    return <div className="native-settings-file">
    <h3 className="small strong">{tr("Settings file")}</h3>
    <div className="row"><Btn size="sm" disabled={pending || !info} onClick={() => void openEditor()}>{tr("Open settings file")}</Btn><span className="small muted">{tr("Changes you make in the file apply the next time the model starts.")}</span>{saved ? <span className="small">{tr("Saved")}</span> : null}</div>
    {tr(error && !open ? <ErrorNotice message={tr(error)} next={tr("Open the file from its folder instead, or try again.")}/> : null)}
    {tr(errors.length ? <><ErrorNotice message={tr("Your settings file has a mistake, so the model will not start until it is fixed.")} next={tr("Open the settings file, fix the lines below, and load the model again.")}/>{tr(errors.map((issue, i) => <p className="small" key={`e${i}`}>{tr(issueText(issue))}</p>))}</> : null)}
    {tr(warnings.map((issue, i) => <p className="small muted" key={`w${i}`}>{tr(issueText(issue))}</p>))}
    <Dialog open={open} title={tr("Settings file")} wide onClose={close} actions={<><Btn onClick={close}>{tr("Cancel")}</Btn><Btn variant="primary" disabled={pending || conflict} onClick={() => void save()}>{tr(pending ? "Saving…" : "Save")}</Btn></>}>
      <div className="stack">
        {tr(conflict ? <ErrorNotice message={tr(error)} action={tr("Load the file again")} onRetry={() => setReplacing(true)}/> : null)}
        {tr(!conflict && error ? <ErrorNotice message={tr(error)}/> : null)}
        {tr(refused.map((issue, i) => <p className="small" key={`r${i}`}>{tr(issueText(issue))}</p>))}
        <textarea className="st-input config-editor native-settings-file__text" spellCheck={false} aria-label={tr("Settings file")} value={text} onChange={e => { setText(e.target.value); setSaved(false); }}/>
      </div>
    </Dialog>
    <Dialog compact open={open && replacing} title={tr("Replace your changes?")} onClose={() => setReplacing(false)} actions={<><Btn onClick={() => setReplacing(false)}>{tr("Keep my changes")}</Btn><Btn variant="danger" disabled={pending} onClick={() => void load().then(() => setReplacing(false))}>{tr("Load the file again")}</Btn></>}>
      <p>{tr("Loading the file again replaces the changes you typed with the version on the disk.")}</p>
    </Dialog>
  </div>;
}
