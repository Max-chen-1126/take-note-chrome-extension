import { useEffect, useRef, useState } from "react";
import { ExtractCard } from "./components/ExtractCard";
import { SettingsForm, type SettingsFormValue } from "./components/SettingsForm";
import { StepProgress } from "./components/StepProgress";
import { MarkdownView } from "./components/MarkdownView";
import { CopyButton } from "./components/CopyButton";
import type { ExtractResult, NoteRequest, SseEvent, StepName } from "./lib/types";

export interface MethodologySummary {
  id: string;
  name: string;
  categories: string[];
}

export interface AppDeps {
  loadMethodologies(): Promise<MethodologySummary[]>;
  extract(): Promise<ExtractResult>;
  process(req: NoteRequest): AsyncIterable<SseEvent>;
}

type AppState =
  | { phase: "extracting" }
  | { phase: "extract_error"; error: { code: string; message: string } }
  | { phase: "ready"; result: ExtractResult }
  | { phase: "streaming"; result: ExtractResult }
  | { phase: "done"; result: ExtractResult }
  | { phase: "stream_error"; result: ExtractResult; error: { code: string; message: string } };

const STEP_ORDER: StepName[] = ["structure", "draft", "augment", "verify", "format"];

const DEFAULT_SETTINGS: SettingsFormValue = {
  methodology_id: "",
  mode: "concise",
  direction: "",
  web_search: false,
};

const pageStyle: React.CSSProperties = {
  fontFamily: "var(--tn-font)",
  color: "var(--tn-text)",
  background: "var(--tn-bg)",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: 16,
};

const primaryButtonStyle: React.CSSProperties = {
  fontFamily: "var(--tn-font)",
  fontSize: 15,
  fontWeight: 700,
  padding: "12px 16px",
  borderRadius: "var(--tn-r-control)",
  border: "none",
  background: "var(--tn-primary)",
  color: "var(--tn-on-primary)",
  cursor: "pointer",
  width: "100%",
};

const ghostButtonStyle: React.CSSProperties = {
  fontFamily: "var(--tn-font)",
  fontSize: 13,
  fontWeight: 600,
  padding: "6px 4px",
  border: "none",
  background: "transparent",
  color: "var(--tn-text)",
  cursor: "pointer",
  alignSelf: "flex-start",
};

const errorBoxStyle: React.CSSProperties = {
  border: "1px solid var(--tn-border)",
  borderRadius: "var(--tn-r-card)",
  padding: 16,
  background: "var(--tn-surface)",
  color: "var(--tn-text)",
  fontSize: 14,
};

export function App({ deps }: { deps: AppDeps }) {
  const [state, setState] = useState<AppState>({ phase: "extracting" });
  const [methodologies, setMethodologies] = useState<MethodologySummary[]>([]);
  const [settings, setSettings] = useState<SettingsFormValue>(DEFAULT_SETTINGS);
  const [activeStep, setActiveStep] = useState<StepName | null>(null);
  const [doneSteps, setDoneSteps] = useState<StepName[]>([]);
  const [streamedMarkdown, setStreamedMarkdown] = useState("");
  const [finalMarkdown, setFinalMarkdown] = useState<string | null>(null);

  // Guards against a stale async run (e.g. a second 開始 click) clobbering
  // state from a still-in-flight previous stream.
  const runIdRef = useRef(0);

  useEffect(() => {
    deps
      .extract()
      .then((result) => {
        if (result.ok) {
          setState({ phase: "ready", result });
        } else {
          setState({
            phase: "extract_error",
            error: result.error ?? { code: "extract_failed", message: "擷取失敗" },
          });
        }
      })
      .catch((err) => {
        setState({
          phase: "extract_error",
          error: { code: "extract_failed", message: err instanceof Error ? err.message : String(err) },
        });
      });

    deps
      .loadMethodologies()
      .then((list) => setMethodologies(list))
      .catch(() => setMethodologies([]));
    // deps is provided once by the caller (App is re-mounted, not re-rendered, when deps change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStart() {
    if (state.phase !== "ready") return;
    const result = state.result;
    const runId = ++runIdRef.current;

    const req: NoteRequest = {
      category: result.category,
      methodology_id: settings.methodology_id,
      mode: settings.mode,
      direction: settings.direction,
      provider: "gemini",
      web_search: settings.web_search,
      content: result.content,
    };

    setActiveStep(null);
    setDoneSteps([]);
    setStreamedMarkdown("");
    setFinalMarkdown(null);
    setState({ phase: "streaming", result });

    try {
      for await (const evt of deps.process(req)) {
        if (runIdRef.current !== runId) return; // superseded by a newer run

        switch (evt.event) {
          case "step": {
            if (evt.data.status === "start") {
              setActiveStep(evt.data.step);
            } else {
              setDoneSteps((prev) => (prev.includes(evt.data.step) ? prev : [...prev, evt.data.step]));
              setActiveStep((curr) => (curr === evt.data.step ? null : curr));
            }
            break;
          }
          case "delta": {
            setStreamedMarkdown((prev) => prev + evt.data.text);
            break;
          }
          case "citations": {
            // Citations are not rendered in this slice.
            break;
          }
          case "done": {
            setFinalMarkdown(evt.data.markdown);
            setDoneSteps(STEP_ORDER);
            setActiveStep(null);
            setState({ phase: "done", result });
            break;
          }
          case "error": {
            setState({ phase: "stream_error", result, error: evt.data });
            return;
          }
        }
      }
    } catch (err) {
      if (runIdRef.current !== runId) return;
      setState({
        phase: "stream_error",
        result,
        error: { code: "stream_failed", message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  function handleBack() {
    if (state.phase !== "done" && state.phase !== "stream_error" && state.phase !== "streaming") return;
    runIdRef.current += 1; // invalidate any in-flight stream
    setState({ phase: "ready", result: state.result });
  }

  if (state.phase === "extracting") {
    return (
      <div className="tn-app" style={pageStyle}>
        <p>擷取中…</p>
      </div>
    );
  }

  if (state.phase === "extract_error") {
    return (
      <div className="tn-app" style={pageStyle}>
        <div style={errorBoxStyle}>
          <p style={{ margin: 0, fontWeight: 600 }}>擷取失敗</p>
          <p style={{ margin: "8px 0 0", color: "var(--tn-muted)" }}>{state.error.message}</p>
          <p style={{ margin: "8px 0 0", color: "var(--tn-muted)" }}>請重新整理頁面或換一個頁面後再試。</p>
        </div>
      </div>
    );
  }

  if (state.phase === "ready") {
    return (
      <div className="tn-app" style={pageStyle}>
        <ExtractCard result={state.result} />
        <SettingsForm methodologies={methodologies} value={settings} onChange={setSettings} />
        <button type="button" style={primaryButtonStyle} onClick={handleStart}>
          ▶ 開始處理
        </button>
      </div>
    );
  }

  // Result page: streaming | done | stream_error
  const markdownToShow = finalMarkdown ?? streamedMarkdown;

  return (
    <div className="tn-app" style={pageStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <button type="button" style={ghostButtonStyle} onClick={handleBack}>
          ‹ 返回
        </button>
        {state.phase === "done" && <CopyButton text={markdownToShow} />}
      </div>

      <StepProgress active={activeStep} doneSteps={doneSteps} />

      {state.phase === "stream_error" && (
        <div style={errorBoxStyle}>
          <p style={{ margin: 0, fontWeight: 600 }}>串流發生錯誤</p>
          <p style={{ margin: "8px 0 0", color: "var(--tn-muted)" }}>{state.error.message}</p>
        </div>
      )}

      <MarkdownView markdown={markdownToShow} />
    </div>
  );
}

export default App;
