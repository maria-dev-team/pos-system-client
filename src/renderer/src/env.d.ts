/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  camera?: {
    setContext: (
      context: { accessToken: string; registerId: string | null } | null,
    ) => void;
  };
}
