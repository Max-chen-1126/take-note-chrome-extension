import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Sparkles } from "lucide-react";
import { ExtractCard } from "./components/ExtractCard";
import { SettingsForm, type SettingsFormValue } from "./components/SettingsForm";
import { StepProgress } from "./components/StepProgress";
import { MarkdownView } from "./components/MarkdownView";
import { CopyButton } from "./components/CopyButton";
import { ErrorState } from "./components/ErrorState";
import { Spinner } from "./components/ui/Spinner";
import { Button } from "./components/ui/Button";
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

  function runExtract() {
    setState({ phase: "extracting" });
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
  }

  useEffect(() => {
    runExtract();

    deps
      .loadMethodologies()
      .then((list) => setMethodologies(list))
      .catch(() => setMethodologies([]));
    // deps is provided once by the caller (App is re-mounted, not re-rendered, when deps change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStart() {
    // Callable both from the ready-phase primary CTA and from the stream_error
    // retry button; both phases carry a `result` to restart the stream from.
    if (state.phase !== "ready" && state.phase !== "stream_error") return;
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
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            minHeight: 200,
          }}
        >
          <Spinner size={24} />
          <p style={{ margin: 0, fontSize: 14, color: "var(--tn-text-muted)" }}>擷取中…</p>
        </div>
      </div>
    );
  }

  if (state.phase === "extract_error") {
    return (
      <div className="tn-app" style={pageStyle}>
        <ErrorState
          title="擷取失敗"
          message={state.error.message}
          hint="請重新整理頁面或換一個頁面後再試。"
          onRetry={runExtract}
        />
      </div>
    );
  }

  if (state.phase === "ready") {
    return (
      <div className="tn-app" style={pageStyle}>
        <ExtractCard result={state.result} />
        <SettingsForm methodologies={methodologies} value={settings} onChange={setSettings} />
        <Button variant="primary" icon={Sparkles} fullWidth onClick={handleStart}>
          開始處理
        </Button>
      </div>
    );
  }

  // Result page: streaming | done | stream_error
  const markdownToShow = finalMarkdown ?? streamedMarkdown;

  return (
    <div className="tn-app" style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={handleBack}>
          返回
        </Button>
        {state.phase === "done" && <CopyButton text={markdownToShow} />}
      </div>

      <StepProgress active={activeStep} doneSteps={doneSteps} />

      {state.phase === "stream_error" && (
        <ErrorState title="串流發生錯誤" message={state.error.message} onRetry={handleStart} />
      )}

      <MarkdownView markdown={markdownToShow} />
    </div>
  );
}

export default App;
