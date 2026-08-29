import { useEffect, useReducer, useRef, useState, type Dispatch } from "react";
import type {
  AuthState,
  BillingState,
  RuntimeState,
  StudioEvent,
  StudioProject,
} from "../types";
import { EMPTY_AUTH, EMPTY_BILLING, EMPTY_RUNTIME, mergeProject } from "../lib/studio";

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

export interface StudioState {
  projects: StudioProject[];
  activeId?: string;
  auth: AuthState;
  billing: BillingState;
  runtime: RuntimeState;
  loaded: boolean;
  connection: ConnectionStatus;
}

export type StudioAction =
  | { type: "event"; event: StudioEvent }
  | { type: "select"; id: string }
  | { type: "project"; project: StudioProject }
  | { type: "billing"; billing: BillingState }
  | { type: "connection"; status: ConnectionStatus };

const INITIAL_STATE: StudioState = {
  projects: [],
  auth: EMPTY_AUTH,
  billing: EMPTY_BILLING,
  runtime: EMPTY_RUNTIME,
  loaded: false,
  connection: "connecting",
};

function applyEvent(state: StudioState, event: StudioEvent): StudioState {
  switch (event.type) {
    case "snapshot":
      return {
        ...state,
        projects: event.projects,
        auth: event.auth,
        billing: event.billing,
        runtime: event.runtime,
        activeId: state.activeId || event.projects[0]?.id,
        loaded: true,
        connection: "open",
      };
    case "project":
      return { ...state, projects: mergeProject(state.projects, event.project) };
    case "assistant_delta":
      return {
        ...state,
        projects: state.projects.map((project) => {
          if (project.id !== event.projectId) return project;
          const messages = [...project.messages];
          const index = messages.findIndex((item) => item.id === event.messageId);
          if (index >= 0)
            messages[index] = {
              ...messages[index],
              text: messages[index].text + event.delta,
              streaming: true,
            };
          else
            messages.push({
              id: event.messageId,
              role: "assistant",
              text: event.delta,
              createdAt: new Date().toISOString(),
              streaming: true,
            });
          return { ...project, messages };
        }),
      };
    case "auth":
      return { ...state, auth: event.auth };
    case "runtime":
      return { ...state, runtime: event.runtime };
    default:
      return state;
  }
}

function reducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case "event":
      return applyEvent(state, action.event);
    case "select":
      return { ...state, activeId: action.id };
    case "project":
      return { ...state, projects: mergeProject(state.projects, action.project) };
    case "billing":
      return { ...state, billing: action.billing };
    case "connection":
      return state.connection === action.status
        ? state
        : { ...state, connection: action.status };
    default:
      return state;
  }
}

/**
 * The server sends a full `snapshot` event as the first SSE message, so the
 * stream is the single source of truth: there is no separate HTTP bootstrap
 * fetch to race against, and every reconnect re-syncs missed deltas because a
 * fresh snapshot arrives on each new connection.
 */
export function useStudioEvents(enabled: boolean): {
  state: StudioState;
  dispatch: Dispatch<StudioAction>;
  retry: () => void;
} {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [attempt, setAttempt] = useState(0);
  const backoffRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as StudioEvent;
        if (event.type === "snapshot") backoffRef.current = 0;
        dispatch({ type: "event", event });
      } catch {
        // Ignore a malformed event; the stream continues with the next one.
      }
    };
    source.onerror = () => {
      dispatch({ type: "connection", status: "reconnecting" });
      if (source.readyState === EventSource.CLOSED && timer === undefined) {
        const delay = Math.min(15_000, 1_000 * 2 ** backoffRef.current);
        backoffRef.current += 1;
        timer = window.setTimeout(() => setAttempt((value) => value + 1), delay);
      }
    };
    return () => {
      source.close();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, attempt]);

  return {
    state,
    dispatch,
    retry: () => {
      backoffRef.current = 0;
      setAttempt((value) => value + 1);
    },
  };
}
