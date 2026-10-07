declare namespace JSX { interface IntrinsicElements { [elemName: string]: any } }
declare module 'react' {
  export type ReactNode = any
  export type FormEvent<T = Element> = any
  export type PointerEvent<T = Element> = any
  export type ChangeEvent<T = Element> = any
  export const StrictMode: any
  export interface ErrorInfo { componentStack: string }
  export class Component<P = {}, S = {}> {
    props: P
    state: S
    constructor(props: P)
    setState(state: Partial<S> | ((prevState: S, props: P) => Partial<S>), callback?: () => void): void
    forceUpdate(callback?: () => void): void
  }
  export function useState<S>(initialState: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void]
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void
  export function useMemo<T>(factory: () => T, deps: any[]): T
  export function useRef<T>(initialValue: T): { current: T }
}
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any }
declare module 'react-dom/client' { export function createRoot(element: Element | DocumentFragment): { render(node: any): void } }
