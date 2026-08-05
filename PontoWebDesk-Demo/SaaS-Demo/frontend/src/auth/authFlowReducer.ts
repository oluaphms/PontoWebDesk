export type AuthFlowStatus =
  | 'idle'
  | 'authenticating'
  | 'session_detected'
  | 'hydrating_user'
  | 'authenticated'
  | 'failed';

export type AuthFlowState = {
  status: AuthFlowStatus;
  loading: boolean;
  attemptId: number | null;
  pipelineId: number | null;
  error: string | null;
  updatedAt: number;
};

export type AuthFlowAction =
  | { type: 'LOGIN_START'; attemptId: number; at?: number }
  | { type: 'SESSION_DETECTED'; attemptId: number; at?: number }
  | { type: 'HYDRATION_START'; attemptId: number; pipelineId?: number | null; at?: number }
  | { type: 'AUTHENTICATED'; attemptId?: number | null; pipelineId?: number | null; at?: number }
  | { type: 'FAILED'; attemptId?: number | null; error: string; at?: number }
  | { type: 'RELEASE_LOADING'; at?: number }
  | { type: 'RESET'; at?: number };

export const initialAuthFlowState: AuthFlowState = {
  status: 'idle',
  loading: false,
  attemptId: null,
  pipelineId: null,
  error: null,
  updatedAt: Date.now(),
};

const now = (at?: number) => at ?? Date.now();

export function authFlowReducer(state: AuthFlowState, action: AuthFlowAction): AuthFlowState {
  switch (action.type) {
    case 'LOGIN_START':
      return {
        status: 'authenticating',
        loading: true,
        attemptId: action.attemptId,
        pipelineId: state.pipelineId,
        error: null,
        updatedAt: now(action.at),
      };
    case 'SESSION_DETECTED':
      return {
        ...state,
        status: 'session_detected',
        loading: true,
        attemptId: action.attemptId,
        updatedAt: now(action.at),
      };
    case 'HYDRATION_START':
      return {
        ...state,
        status: 'hydrating_user',
        loading: true,
        attemptId: action.attemptId,
        pipelineId: action.pipelineId ?? state.pipelineId,
        updatedAt: now(action.at),
      };
    case 'AUTHENTICATED':
      return {
        status: 'authenticated',
        loading: false,
        attemptId: action.attemptId ?? state.attemptId,
        pipelineId: action.pipelineId ?? state.pipelineId,
        error: null,
        updatedAt: now(action.at),
      };
    case 'FAILED':
      return {
        status: 'failed',
        loading: false,
        attemptId: action.attemptId ?? state.attemptId,
        pipelineId: state.pipelineId,
        error: action.error,
        updatedAt: now(action.at),
      };
    case 'RELEASE_LOADING':
      return {
        ...state,
        loading: false,
        updatedAt: now(action.at),
      };
    case 'RESET':
      return {
        ...initialAuthFlowState,
        updatedAt: now(action.at),
      };
    default:
      return state;
  }
}

export function isAuthFlowBusy(state: AuthFlowState): boolean {
  return state.loading || state.status === 'authenticating' || state.status === 'session_detected' || state.status === 'hydrating_user';
}
