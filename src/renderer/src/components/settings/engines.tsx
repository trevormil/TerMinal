import { Cpu } from 'lucide-react'
import type { Engine } from '../../lib/types'
import {
  ENGINE_MODELS,
  ENGINE_VENDOR,
  engineAllowsCustomModel,
  engineEffortsOf,
  engineLabel,
} from '../../lib/engines'
import { EditDetails, Readiness, SecretInput, Section, inp, tilde } from './shared'
import type { SettingsCtx, SettingsSectionSpec } from './shared'

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save, env, selectedDaemon, selectedProbe, selectedIsRemote, saveDaemon, profile } = ctx

  // Which engines the local machine actually has (for readiness indicators).
  // OpenRouter and openai-compat (or-agent) ride on Codex being present.
  const localEngineFound = (e: Engine): boolean =>
    !env
      ? true
      : e === 'codex' || e === 'openrouter' || e === 'openai-compat'
        ? env.codex.found
        : e === 'cursor'
          ? env.cursor.found
          : e === 'hermes'
            ? env.hermes.found
            : env.claude.found

  const engineRow = (e: Engine) => {
    const vendor = ENGINE_VENDOR[e]
    const remoteDetected =
      selectedProbe && !('loading' in selectedProbe) && selectedProbe.ok
        ? selectedProbe.engines[e] || ''
        : ''
    const found = selectedIsRemote ? !!remoteDetected : localEngineFound(e)
    const detPath = selectedIsRemote
      ? remoteDetected
      : env
        ? e === 'codex' || e === 'openrouter' || e === 'openai-compat'
          ? env.codex.path
          : e === 'cursor'
            ? env.cursor.path
            : e === 'hermes'
              ? env.hermes.path
              : env.claude.path
        : ''
    const defModel = selectedDaemon.engines[e].defaultModel
    const overridePath = selectedDaemon.engines[e].path
    return (
      <div key={e} className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <Readiness
              ok={found}
              name={engineLabel(e)}
              hint={found ? detPath || vendor : 'not on PATH'}
            />
            <div className="mt-0.5 text-[10.5px] text-zinc-600">
              {overridePath ? (
                <>
                  override: <span className="font-mono text-zinc-500">{tilde(overridePath)}</span>
                </>
              ) : (
                'using detected binary'
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[10.5px] text-zinc-500">
            Default model
            {engineAllowsCustomModel(e) ? (
              // hermes/openrouter take any provider/model slug — free-text, like
              // the per-run EngineModelPicker, instead of a closed menu.
              <input
                key={`${profile}-${e}-model-${defModel}`}
                defaultValue={defModel}
                onBlur={(ev) =>
                  ev.target.value.trim() !== defModel &&
                  saveDaemon({ engines: { [e]: { defaultModel: ev.target.value.trim() } } })
                }
                placeholder="(engine default) — any slug"
                spellCheck={false}
                className="w-52 rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200 outline-none"
              />
            ) : (
              <select
                value={defModel}
                onChange={(ev) =>
                  saveDaemon({ engines: { [e]: { defaultModel: ev.target.value } } })
                }
                className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[11px] text-zinc-200 outline-none"
              >
                <option value="">(engine default)</option>
                {ENGINE_MODELS[e].map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
          </label>
          {engineEffortsOf(e).length > 0 && (
            <label className="flex items-center gap-2 text-[10.5px] text-zinc-500">
              Default effort
              <select
                value={selectedDaemon.engines[e].defaultEffort || ''}
                onChange={(ev) =>
                  saveDaemon({ engines: { [e]: { defaultEffort: ev.target.value } } })
                }
                className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[11px] text-zinc-200 outline-none"
              >
                <option value="">(engine default)</option>
                {engineEffortsOf(e).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {e === 'openai-compat' && (
          <label className="mt-2 block text-[10.5px] text-zinc-500">
            Base URL — an OpenAI-compatible /v1 endpoint (vLLM, Ollama, LM Studio, TGI, …)
            <input
              key={`${profile}-${e}-baseurl-${selectedDaemon.engines[e].baseUrl}`}
              defaultValue={selectedDaemon.engines[e].baseUrl}
              onBlur={(ev) =>
                ev.target.value.trim() !== selectedDaemon.engines[e].baseUrl &&
                saveDaemon({ engines: { [e]: { baseUrl: ev.target.value.trim() } } })
              }
              placeholder="http://10.0.0.5:8000/v1"
              spellCheck={false}
              className={`${inp} mt-1 font-mono`}
            />
          </label>
        )}
        <EditDetails label="Override binary path">
          <input
            key={`${profile}-${e}-path-${overridePath}`}
            defaultValue={overridePath}
            onBlur={(ev) =>
              ev.target.value !== overridePath &&
              saveDaemon({ engines: { [e]: { path: ev.target.value.trim() } } })
            }
            placeholder={`${e} or /absolute/path/to/${e}`}
            spellCheck={false}
            className={`${inp} font-mono`}
          />
        </EditDetails>
      </div>
    )
  }

  return (
    <Section
      id="engines"
      icon={Cpu}
      title="Engines"
      desc={
        selectedIsRemote
          ? 'Detected on the selected SSH host; override paths as remote paths.'
          : 'The agent backends. Detected on your PATH; override the binary path if needed.'
      }
    >
      <div className="space-y-2">
        {engineRow('codex')}
        {engineRow('claude')}
        {engineRow('cursor')}
        {!selectedIsRemote && engineRow('openrouter')}
        {!selectedIsRemote && engineRow('pi')}
        {!selectedIsRemote && engineRow('hermes')}
        {!selectedIsRemote && engineRow('openai-compat')}
      </div>
      {!selectedIsRemote && (
        <div className="mt-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-2.5">
          <label className="block text-[11px] font-medium text-zinc-300">OpenRouter API key</label>
          <div className="mt-0.5 text-[10.5px] text-zinc-600">
            Stored in your OS keychain. Used only for OpenRouter (or-agent) runs. Empty → falls back
            to the shell&apos;s OPENROUTER_API_KEY.
          </div>
          <div className="mt-1.5">
            <SecretInput
              set={!!s?.secretsSet?.openrouterApiKey}
              onSave={(v) => save({ openrouterApiKey: v })}
              placeholder="sk-or-v1-…"
            />
          </div>
        </div>
      )}
      {!selectedIsRemote && (
        <div className="mt-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-2.5">
          <label className="block text-[11px] font-medium text-zinc-300">Self-hosted API key</label>
          <div className="mt-0.5 text-[10.5px] text-zinc-600">
            Stored in your OS keychain. Sent to the self-hosted (openai-compat) endpoint. Empty →
            falls back to the shell&apos;s OPENAI_API_KEY; keyless local servers need no real value.
          </div>
          <div className="mt-1.5">
            <SecretInput
              set={!!s?.secretsSet?.openaiCompatApiKey}
              onSave={(v) => save({ openaiCompatApiKey: v })}
              placeholder="sk-… (or any placeholder for keyless servers)"
            />
          </div>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-zinc-500">Default:</span>
        {(['codex', 'claude', 'cursor', 'pi', 'hermes'] as Engine[]).map((e) => {
          // Grey engines the local machine doesn't have — the default
          // engine drives scheduled/agent runs, so an absent one silently
          // no-ops. (Remote profiles use the host probe, not local env.)
          const missing = !selectedIsRemote && !localEngineFound(e)
          return (
            <button
              key={e}
              onClick={() => saveDaemon({ defaultEngine: e })}
              title={missing ? `${engineLabel(e)} is not installed on this machine` : undefined}
              className={`rounded-md border px-2.5 py-1 text-[11px] ${
                selectedDaemon.defaultEngine === e
                  ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
                  : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
              } ${missing ? 'opacity-45' : ''}`}
            >
              {engineLabel(e)}
            </button>
          )
        })}
      </div>
      {!selectedIsRemote && env && !localEngineFound(selectedDaemon.defaultEngine) && (
        <div className="mt-1.5 text-[10.5px] text-amber-400">
          {engineLabel(selectedDaemon.defaultEngine)} isn&apos;t installed — scheduled, ticket, and
          background agent runs will fail. Install it or pick an installed engine.
        </div>
      )}
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'engines',
  title: 'Engines',
  icon: Cpu,
  order: 3,
  Component,
}
export default section
