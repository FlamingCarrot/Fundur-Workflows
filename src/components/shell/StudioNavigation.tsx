"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Guard = () => Promise<boolean>;
const NavigationContext = createContext<{
  register: (guard: Guard) => () => void;
  current: () => Guard | undefined;
} | null>(null);
export function StudioNavigation({ children }: { children: ReactNode }) {
  const guard = useRef<Guard | undefined>(undefined);
  const navigation = useMemo(
    () => ({
      register: (next: Guard) => {
        guard.current = next;
        return () => {
          if (guard.current === next) guard.current = undefined;
        };
      },
      current: () => guard.current,
    }),
    [],
  );
  return (
    <NavigationContext.Provider value={navigation}>
      {children}
    </NavigationContext.Provider>
  );
}
export function useStudioNavigationGuard(beforeNavigate?: Guard) {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (!navigation || !beforeNavigate) return;
    return navigation.register(beforeNavigate);
  }, [navigation, beforeNavigate]);
}
/** The persistent sidebar observes the same save guard as project section links. */
export function StudioLink(props: ComponentProps<typeof Link>) {
  const navigation = useContext(NavigationContext);
  const router = useRouter();
  return (
    <Link
      {...props}
      onNavigate={async (event) => {
        props.onNavigate?.(event);
        const guard = navigation?.current();
        if (!guard) return;
        event.preventDefault();
        if (await guard())
          router.push(
            typeof props.href === "string"
              ? props.href
              : String(props.href.pathname),
          );
      }}
    />
  );
}
