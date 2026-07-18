"use client";

import type { CSSProperties, JSX } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Matches the app content column's width (`max-w-[390px] mx-auto`) so the
// menu control stays anchored to the visible column's left edge instead of
// the physical browser viewport edge on wide screens.
const COLUMN_MAX_WIDTH_PX = 390;

const columnLeftInset = `max(0px, calc((100vw - ${COLUMN_MAX_WIDTH_PX}px) / 2))`;

export function AppMenu(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const drawerId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback((): void => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = isOpen ? "hidden" : previousOverflow;
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const handleSignOut = async (): Promise<void> => {
    setIsSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // still send user to login if env broken
    }
    router.push("/login");
    router.refresh();
  };

  const isHomeActive = pathname === "/";
  const isSettingsActive = pathname === "/settings";

  const buttonStyle: CSSProperties = {
    left: `calc(${columnLeftInset} + 1rem)`,
  };
  // Bounds the backdrop + drawer to the app's content column and clips
  // anything sliding past its left edge, so the drawer is masked by (rather
  // than visible over) the blank margin on wide screens.
  const frameStyle: CSSProperties = {
    left: columnLeftInset,
    width: `min(100vw, ${COLUMN_MAX_WIDTH_PX}px)`,
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Open menu"
        aria-expanded={isOpen}
        aria-controls={drawerId}
        style={buttonStyle}
        className="fixed top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-900 shadow transition hover:bg-gray-100"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18" />
          <path d="M3 12h18" />
          <path d="M3 18h18" />
        </svg>
      </button>

      <div
        style={frameStyle}
        className="pointer-events-none fixed inset-y-0 z-40 overflow-hidden"
      >
        <div
          aria-hidden={!isOpen}
          onClick={handleClose}
          className={`pointer-events-auto absolute inset-0 bg-black/30 transition-opacity duration-300 ${
            isOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />

        <aside
          id={drawerId}
          role="dialog"
          aria-label="Menu"
          aria-hidden={!isOpen}
          // Opacity fades in much faster than the slide so the panel becomes
          // visible almost immediately, then the slide itself plays out over
          // a slower duration and actually reads as motion.
          style={{ transition: "opacity 120ms ease-out, transform 550ms ease-out" }}
          className={`absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-2xl ${
            isOpen
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "pointer-events-none -translate-x-full opacity-0"
          }`}
        >
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-sm font-semibold text-gray-900">Menu</span>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={handleClose}
              aria-label="Close menu"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-1 px-3">
            <Link
              href="/"
              onClick={handleClose}
              className={`rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isHomeActive
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              Home
            </Link>
            <Link
              href="/settings"
              onClick={handleClose}
              className={`rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isSettingsActive
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              Settings
            </Link>
          </nav>

          <div className="border-t border-gray-100 px-3 py-4">
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
