import { exportScene, Sidebar } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useChat } from "@ai-sdk/react";
import { LoginWithChatGPT } from "@opencoredev/loginwithchatgpt-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { z } from "zod/mini";
import { getJson } from "./queries.ts";
import {
  canvasChanges,
  hasCanvasChanges,
  observeCanvas,
  type CanvasObservation,
} from "./interview-changes.ts";
import {
  interviewerTransport,
  type InterviewMessage,
  type InterviewRequest,
} from "./interviewer-transport.ts";

interface InterviewerPanelProps {
  api: ExcalidrawImperativeAPI | null;
  id: string;
  diagramKey: string;
  loaded: boolean;
  offline: boolean;
}

interface SceneResponse {
  scene: string;
}

interface ModelsResponse {
  models: string[];
}

interface ChatgptAccount {
  accountId: string;
}

interface SessionResponse {
  status: string;
  user?: ChatgptAccount;
}

const sceneSchema = z.object({ scene: z.string() });

const modelsSchema = z.object({ models: z.array(z.string()) });

const sessionSchema = z.object({
  status: z.string(),
  user: z.optional(z.object({ accountId: z.string() })),
});

const IDLE_MS = 2500;

const MIN_QUESTION_INTERVAL_MS = 15_000;

function isScene(value: unknown): value is SceneResponse {
  return sceneSchema.safeParse(value).success;
}

function isModels(value: unknown): value is ModelsResponse {
  return modelsSchema.safeParse(value).success;
}

function isSession(value: unknown): value is SessionResponse {
  return sessionSchema.safeParse(value).success;
}

export function InterviewerPanel({ api, id, diagramKey, loaded, offline }: InterviewerPanelProps) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("");
  const [pendingChange, setPendingChange] = useState(false);
  const baseline = useRef<CanvasObservation>(new Map());
  const lastChanges = useRef("Interview started. Read the current whiteboard.");
  const lastQuestionAt = useRef(0);
  const conversationEnd = useRef<HTMLDivElement>(null);

  const session = useQuery({
    queryKey: ["chatgpt-session"],
    queryFn: ({ signal }) => getJson<SessionResponse>("/api/chatgpt/session", signal, isSession),
    refetchInterval: 10_000,
    retry: false,
  });

  const connected = session.data?.status === "authenticated";

  const models = useQuery({
    queryKey: ["chatgpt-models", session.data?.user?.accountId, connected],
    queryFn: ({ signal }) => getJson<ModelsResponse>("/api/chatgpt/models", signal, isModels),
    enabled: connected,
    retry: false,
  });

  const selectedModel = models.data?.models.includes(model)
    ? model
    : (models.data?.models[0] ?? "");

  const transport = useMemo(
    () =>
      interviewerTransport({
        getScreenshot: async () => {
          const elements = api?.getSceneElements();

          if (!api || !elements?.length) {
            return;
          }

          const blob = await exportScene({
            type: "jpeg",
            data: { elements, files: api.getFiles() },
            config: {
              theme: "light",
              canvasBackgroundColor: "#ffffff",
              maxWidthOrHeight: 1024,
              quality: 0.6,
              padding: 24,
            },
          });

          if (blob.size > 80_000) {
            return;
          }

          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => {
              const result = z.string().safeParse(reader.result);

              if (result.success) {
                resolve(result.data);
              } else {
                reject(new Error("Could not read canvas preview"));
              }
            });
            reader.addEventListener("error", () =>
              reject(new Error("Could not render canvas preview")),
            );
            reader.readAsDataURL(blob);
          });
        },
        getScene: async (signal) => {
          const context = await queryClient.fetchQuery({
            queryKey: ["interview-context", id, diagramKey],
            queryFn: ({ signal: querySignal }) =>
              getJson<SceneResponse>(
                `/api/d/${id}/interview-context?k=${encodeURIComponent(diagramKey)}`,
                signal ? AbortSignal.any([signal, querySignal]) : querySignal,
                isScene,
              ),
            staleTime: 0,
          });

          return context.scene;
        },
      }),
    [id, diagramKey, queryClient, api],
  );

  const { messages, sendMessage, status, stop, error, regenerate } = useChat<InterviewMessage>({
    transport,
  });

  const loginFetch = useCallback<typeof fetch>(
    async (input, init) => {
      const response = await fetch(input, init);
      const result = sessionSchema.safeParse(await response.clone().json());

      if (response.ok && result.success) {
        queryClient.setQueryData<SessionResponse>(["chatgpt-session"], result.data);

        if (result.data.status !== "authenticated") {
          setRunning(false);
          await stop();
        }
      }

      return response;
    },
    [queryClient, stop],
  );

  const busy = status === "submitted" || status === "streaming";

  const automatic = useMutation({
    mutationFn: (changes: string) =>
      sendMessage(
        {
          text: messages.length
            ? "I updated the whiteboard."
            : "Start the system-design interview with me.",
          metadata: { automatic: true },
        },
        { body: { model: selectedModel, changes } satisfies InterviewRequest },
      ),
  });

  const askAfterChange = useEffectEvent((changes: string) => automatic.mutate(changes));
  const canAsk = useEffectEvent(() => !busy);

  useEffect(() => {
    if (!api || !running || !connected || !loaded || offline || error) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let observed = observeCanvas(api.getSceneElements());

    const evaluate = () => {
      if (
        !canAsk() ||
        document.hidden ||
        api.getAppState().editingTextElement ||
        api.getAppState().isResizing ||
        api.getAppState().isRotating
      ) {
        timer = setTimeout(evaluate, IDLE_MS);

        return;
      }

      const latest = observeCanvas(api.getSceneElements());
      const changes = canvasChanges(baseline.current, latest);

      if (!hasCanvasChanges(changes)) {
        setPendingChange(false);

        return;
      }

      const summary = JSON.stringify(changes);
      lastChanges.current =
        summary.length <= 32_000
          ? summary
          : "Many elements changed. Compare the current scene with the previous conversation.";
      baseline.current = latest;
      lastQuestionAt.current = Date.now();
      setPendingChange(false);
      askAfterChange(lastChanges.current);
    };

    const schedule = () => {
      const latest = observeCanvas(api.getSceneElements());

      if (!hasCanvasChanges(canvasChanges(observed, latest))) {
        return;
      }

      observed = latest;
      setPendingChange(true);
      clearTimeout(timer);
      timer = setTimeout(
        evaluate,
        Math.max(IDLE_MS, lastQuestionAt.current + MIN_QUESTION_INTERVAL_MS - Date.now()),
      );
    };

    const unsubscribe = api.onChange(schedule);

    if (hasCanvasChanges(canvasChanges(baseline.current, observed))) {
      setPendingChange(true);
      timer = setTimeout(
        evaluate,
        Math.max(IDLE_MS, lastQuestionAt.current + MIN_QUESTION_INTERVAL_MS - Date.now()),
      );
    }

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [api, running, connected, loaded, offline, error]);
  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messages, status]);
  useEffect(
    () => () => {
      stop().catch(() => {});
    },
    [stop],
  );

  const pause = () => {
    setRunning(false);
    setPendingChange(false);
    stop().catch(() => {});
  };

  const start = () => {
    if (!api) {
      return;
    }

    setRunning(true);

    if (messages.length === 0) {
      baseline.current = observeCanvas(api.getSceneElements());
      lastChanges.current = "Interview started. Read the current whiteboard.";
      lastQuestionAt.current = Date.now();
      automatic.mutate(lastChanges.current);
    }
  };

  return (
    <Sidebar
      name="interviewer"
      docked
      onStateChange={(state) => {
        if (!state) {
          pause();
        }
      }}
    >
      <Sidebar.Header>Interviewer</Sidebar.Header>
      <div className="sd-panel interviewer-panel">
        <div className="interviewer-intro">
          <span className="tag">Interview practice</span>
          <h3>A second pair of eyes.</h3>
          <p className="muted">
            Draw your system. I’ll follow your changes and ask about the decisions behind them.
          </p>
        </div>
        <LoginWithChatGPT
          key={connected ? "connected" : "signed-out"}
          fetch={loginFetch}
          label="Continue with ChatGPT"
          consent={{ appName: "System Design Companion" }}
          onAuthenticated={() => {
            session.refetch().catch(() => {});
          }}
        />
        {session.error && <p role="alert">{session.error.message}</p>}
        {connected && (
          <>
            <label htmlFor="interviewer-model">ChatGPT model</label>
            <select
              id="interviewer-model"
              value={selectedModel}
              disabled={running || busy || models.isLoading}
              onChange={(event) => setModel(event.target.value)}
            >
              {models.data?.models.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </select>
            {models.error && (
              <div role="alert">
                <p>{models.error.message}</p>
                <button type="button" onClick={() => void models.refetch()}>
                  Retry models
                </button>
              </div>
            )}
            {!models.isLoading && !models.error && !selectedModel && (
              <p>No models are available for this account.</p>
            )}
            <button
              type="button"
              onClick={running ? pause : start}
              disabled={!selectedModel || !loaded || offline}
            >
              {running
                ? "Pause interviewer"
                : messages.length
                  ? "Resume interview"
                  : "Start interview"}
            </button>
            <output className="muted" aria-live="polite">
              {offline
                ? "Waiting for canvas connection…"
                : busy
                  ? "Interviewer is thinking…"
                  : running
                    ? pendingChange
                      ? "Following your changes…"
                      : "Watching the whiteboard"
                    : "Paused · draw at your own pace"}
            </output>
          </>
        )}
        <div className="interviewer-conversation" role="log" aria-label="Interview conversation">
          {messages.map((message) =>
            message.metadata?.automatic ? null : (
              <article
                key={message.id}
                className={`interviewer-message interviewer-message-${message.role}`}
              >
                <strong>{message.role === "assistant" ? "Interviewer" : "You"}</strong>
                <p>
                  {message.parts
                    .flatMap((part) => (part.type === "text" ? [part.text] : []))
                    .join("")}
                </p>
              </article>
            ),
          )}
          <div ref={conversationEnd} />
        </div>
        {error && (
          <div role="alert">
            <p>{error.message}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                regenerate({
                  body: {
                    model: selectedModel,
                    changes: lastChanges.current,
                  } satisfies InterviewRequest,
                }).catch(() => {});
              }}
            >
              Retry response
            </button>
          </div>
        )}
        {connected && (
          <form
            className="interviewer-answer"
            onSubmit={(event) => {
              event.preventDefault();

              if (!draft.trim() || busy || !selectedModel) {
                return;
              }

              lastChanges.current =
                "Candidate answered. Read the current whiteboard before responding.";

              if (api) {
                const latest = observeCanvas(api.getSceneElements());
                const summary = JSON.stringify(canvasChanges(baseline.current, latest));
                lastChanges.current = summary.length <= 32_000 ? summary : lastChanges.current;
                baseline.current = latest;
                lastQuestionAt.current = Date.now();
                setPendingChange(false);
              }

              sendMessage(
                { text: draft.trim() },
                {
                  body: {
                    model: selectedModel,
                    changes: lastChanges.current,
                  } satisfies InterviewRequest,
                },
              ).catch(() => {});
              setDraft("");
            }}
          >
            <label htmlFor="interviewer-answer">Your answer</label>
            <textarea
              id="interviewer-answer"
              value={draft}
              maxLength={12_000}
              rows={3}
              placeholder="Explain your thinking, or ask for a hint…"
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy || offline}
            />
            <button type="submit" disabled={!draft.trim() || busy || offline || !selectedModel}>
              Send answer
            </button>
          </form>
        )}
        <p className="muted interviewer-note">
          Uses your ChatGPT plan. Start when you’re ready; drawing pauses give me a moment to ask a
          question.
        </p>
      </div>
    </Sidebar>
  );
}
