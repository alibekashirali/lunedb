import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";

function ThemeApplier() {
  const theme = useAppStore((s) => s.theme);
  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove("light");
    if (theme === "light") el.classList.add("light");
  }, [theme]);
  return null;
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <ThemeApplier />
      <Component {...pageProps} />
    </>
  );
}
